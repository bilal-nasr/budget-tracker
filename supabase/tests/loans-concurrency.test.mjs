// Requires an explicitly supplied disposable local stack and synthetic-user JWT.
// Never reads .env files or prints credentials. Run: node --test <this file>.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOANS_TEST_URL;
const key = process.env.LOANS_TEST_PUBLISHABLE_KEY;
const token = process.env.LOANS_TEST_ACCESS_TOKEN;
const configured = Boolean(url && key && token);
if (configured && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Loan concurrency checks require a loopback disposable test stack");
function client() {
  return createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}
async function fixture() {
  const db = client();
  const wallet = await db.from("wallets").insert({ name: "Synthetic loan race", kind: "cash", currency: "USD" }).select("id").single();
  assert.equal(wallet.error, null);
  const category = await db.from("categories").select("id").eq("kind", "expense").is("archived_at", null).limit(1).single();
  assert.equal(category.error, null);
  const day = await db.rpc("loan_today"); assert.equal(day.error, null);
  const created = await db.rpc("create_loan", { p_input: { requestId: randomUUID(), name: "Synthetic concurrency loan", direction: "borrowed", principalMinor: 100, feeBps: 0,
    walletId: wallet.data.id, feeCategoryId: category.data.id, openedOn: day.data, creationMode: "existing", principalPaidBeforeMinor: 0, feePaidBeforeMinor: 0 } });
  assert.equal(created.error, null);
  return { db, id: created.data[0].id, wallet: wallet.data.id, day: day.data };
}
const options = { skip: configured ? false : "Unverified: supply LOANS_TEST_URL, LOANS_TEST_PUBLISHABLE_KEY and a synthetic LOANS_TEST_ACCESS_TOKEN for a disposable local stack" };
test("two distinct final payments cannot both consume the same remainder", options, async () => {
  const f = await fixture();
  const payload = () => ({ requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 100, occurredOn: f.day });
  const results = await Promise.all([f.db.rpc("record_loan_payment", { p_input: payload() }), client().rpc("record_loan_payment", { p_input: payload() })]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(results.find((r) => r.error)?.error.message, "loan.exceedsRemaining");
  const progress = await f.db.from("loan_progress").select("remaining_minor").eq("id", f.id).single();
  assert.equal(Number(progress.data.remaining_minor), 0);
});
test("an identical concurrent retry records exactly one payment", options, async () => {
  const f = await fixture();
  const input = { requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 100, occurredOn: f.day };
  const results = await Promise.all([f.db.rpc("record_loan_payment", { p_input: input }), client().rpc("record_loan_payment", { p_input: input })]);
  for (const result of results) assert.equal(result.error, null);
  assert.equal(results[0].data[0].id, results[1].data[0].id);
  const payments = await f.db.from("transactions").select("id").eq("loan_id", f.id).eq("loan_event", "repayment");
  assert.equal(payments.data.length, 1);
});
test("cancel versus payment leaves a coherent canceled or paid aggregate", options, async () => {
  const f = await fixture();
  const input = { requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 100, occurredOn: f.day };
  const results = await Promise.all([f.db.rpc("cancel_loan", { p_id: f.id }), client().rpc("record_loan_payment", { p_input: input })]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  const item = await f.db.from("loan_progress").select("deleted_at,remaining_minor").eq("id", f.id).single();
  assert.ok(item.data.deleted_at ? Number(item.data.remaining_minor) === 100 : Number(item.data.remaining_minor) === 0);
});
test("old Undo generation cannot reverse a restored payment", options, async () => {
  const f = await fixture();
  const created = await f.db.rpc("record_loan_payment", { p_input: { requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 100, occurredOn: f.day } });
  assert.equal(created.error, null);
  const original = created.data[0];
  const undone = await f.db.rpc("void_loan_payment", { p_transaction_id: original.id, p_expected_revision: original.revision });
  assert.equal(undone.error, null);
  const restored = await client().rpc("restore_loan_payment", { p_transaction_id: original.id, p_expected_revision: undone.data[0].revision });
  assert.equal(restored.error, null);
  const stale = await f.db.rpc("void_loan_payment", { p_transaction_id: original.id, p_expected_revision: original.revision });
  assert.equal(stale.error?.message, "loan.conflict");
});
test("payment versus latest void preserves the stored allocation and remainder", options, async () => {
  const f = await fixture();
  const first = await f.db.rpc("record_loan_payment", { p_input: { requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 50, occurredOn: f.day } });
  assert.equal(first.error, null);
  const results = await Promise.all([
    f.db.rpc("void_loan_payment", { p_transaction_id: first.data[0].id, p_expected_revision: first.data[0].revision }),
    client().rpc("record_loan_payment", { p_input: { requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 50, occurredOn: f.day } }),
  ]);
  for (const result of results) if (result.error) assert.equal(result.error.message, "loan.paymentOrder");
  const progress = await f.db.from("loan_progress").select("remaining_minor,principal_paid_minor").eq("id", f.id).single();
  assert.equal(Number(progress.data.remaining_minor) + Number(progress.data.principal_paid_minor), 100);
});
test("wallet archive and payment serialize without writing into an already archived wallet", options, async () => {
  const f = await fixture();
  const results = await Promise.all([
    f.db.from("wallets").update({ archived_at: new Date().toISOString() }).eq("id", f.wallet),
    client().rpc("record_loan_payment", { p_input: { requestId: randomUUID(), loanId: f.id, walletId: f.wallet, amountMinor: 100, occurredOn: f.day } }),
  ]);
  assert.equal(results[0].error, null);
  if (results[1].error) assert.equal(results[1].error.message, "loan.invalid");
  const progress = await f.db.from("loan_progress").select("remaining_minor").eq("id", f.id).single();
  assert.equal(Number(progress.data.remaining_minor), results[1].error ? 100 : 0);
});
