import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import en from "../src/messages/en.json";
import ar from "../src/messages/ar.json";
import { expectNoHorizontalOverflow } from "../e2e/support";

// This is actual authenticated persistence, isolated from the preview browser suite.
// A controller provisions this confirmed @example.test owner without sending mail.
const auth = JSON.parse(readFileSync(process.env.BUDGET_LIFECYCLE_AUTH_FILE!, "utf8")) as {url:string;key:string;accessToken:string;refreshToken:string};
if(new URL(auth.url).hostname!=="127.0.0.1") throw new Error("Disposable loopback API required");
const db = createClient(auth.url,auth.key,{global:{headers:{Authorization:`Bearer ${auth.accessToken}`}},auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name:string,args:Record<string,unknown>,units?:Record<string,number>){const request=units?createClient(auth.url,auth.key,{global:{headers:{Authorization:`Bearer ${auth.accessToken}`,"x-budget-units":JSON.stringify(units)}},auth:{persistSession:false,autoRefreshToken:false}}):db;const result=await request.rpc(name,args);expect(result.error,`${name} must succeed`).toBeNull();return result.data;}
async function rows(table:string){const result=await db.from(table).select("*");expect(result.error,table).toBeNull();return result.data!;}
// Let the action commit on the real server, then lose only its response.
async function commitThenLoseResponse(page:Page,saveLabel:string,expectedCount:number){
 let intercepted=false;
 await page.route("**/*",async route=>{
  const request=route.request();
  if(request.method()!=="POST"||!request.headers()["next-action"]){await route.continue();return;}
  intercepted=true;
  const response=await route.fetch();expect(response.ok()).toBe(true);
  expect((await rows("transactions")).filter(t=>t.kind==="transfer")).toHaveLength(expectedCount);
  await route.abort("failed");
 });
 await page.getByRole("dialog").getByRole("button",{name:saveLabel,exact:true}).click();
 await expect(page.getByRole("dialog")).toContainText(en.Breakdown.unknownOutcome);
 expect(intercepted).toBe(true);await page.unroute("**/*");
 await page.getByRole("dialog").getByRole("button",{name:en.Breakdown.retrySave,exact:true}).click();
 await expect(page.getByRole("dialog")).toHaveCount(0);
 expect((await rows("transactions")).filter(t=>t.kind==="transfer")).toHaveLength(expectedCount);
}
async function inspectBoth(page:Page,path:string){for(const [locale,messages] of [["en",en],["ar",ar]] as const){await page.goto(`/${locale}/${path}`);await expect(page.getByRole("main")).toBeVisible();await expect(page.locator("html")).toHaveAttribute("dir",locale==="ar"?"rtl":"ltr");await expectNoHorizontalOverflow(page);if(path==="wallets")await expect(page.getByRole("combobox",{name:messages.Wallets.displayCurrency})).toBeVisible();}}

test("global BTC lifecycle persists exact coverage, defaults, transfers, deletion and bilingual history at 320px",async({page,context})=>{
 const cookies:{name:string;value:string}[]=[];
 const session=createServerClient(auth.url,auth.key,{cookies:{getAll:()=>[],setAll:(values)=>{cookies.push(...values.map(({name,value})=>({name,value})));}}});
 const signed=await session.auth.setSession({access_token:auth.accessToken,refresh_token:auth.refreshToken});expect(signed.error).toBeNull();
 await context.addCookies(cookies.map((cookie)=>({name:cookie.name,value:cookie.value,domain:"localhost",path:"/",httpOnly:false,secure:false,sameSite:"Lax"})));
 const first=await rpc("create_wallet",{p_name:"Lifecycle Pocket",p_kind:"cash",p_default_currency:"USD",p_opening_minor:10000},{USD:2});
 const second=await rpc("create_wallet",{p_name:"Lifecycle Bank",p_kind:"bank",p_default_currency:"USD",p_opening_minor:0});
 await page.goto("/en/settings/currencies");
 await page.getByRole("button",{name:en.CurrencySettings.add,exact:true}).click();
 let dialog=page.getByRole("dialog");
 await dialog.getByLabel(en.CurrencySettings.code,{exact:true}).fill("BTC");await dialog.getByLabel(en.CurrencySettings.symbol,{exact:true}).fill("₿");await dialog.getByLabel(en.CurrencySettings.decimalPlaces,{exact:true}).fill("8");
 await dialog.getByRole("button",{name:en.CurrencySettings.save,exact:true}).click();await expect(dialog).toHaveCount(0);
 let balances=await rows("wallet_balances");expect(balances.filter((b)=>b.currency==="BTC").map((b)=>b.wallet_id).sort()).toEqual([first,second].sort());
 const btcIds=balances.filter((b)=>b.currency==="BTC").map((b)=>b.id).sort();
 await page.goto("/en/wallets");await page.getByRole("button",{name:en.Wallets.add,exact:true}).click();dialog=page.getByRole("dialog");
 await dialog.getByLabel(en.Wallets.name,{exact:true}).fill("Lifecycle Reserve");await dialog.getByRole("combobox",{name:en.Wallets.defaultCurrency}).selectOption("BTC");await dialog.getByLabel(en.Wallets.amount,{exact:true}).fill("0.00000010");await dialog.getByRole("button",{name:en.Wallets.create,exact:true}).click();await expect(dialog).toHaveCount(0);
 const reserve=(await rows("wallets")).find((w)=>w.name==="Lifecycle Reserve")!;expect(reserve).toBeTruthy();
 let catalog=(await rows("currencies")).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.code.localeCompare(b.code));balances=await rows("wallet_balances");
 expect(balances.filter((b)=>b.wallet_id===reserve.id).map((b)=>b.currency).sort()).toEqual(catalog.map((c)=>c.code).sort());
 const exact=(wallet:string,code:string)=>balances.find((b)=>b.wallet_id===wallet&&b.currency===code)!;
 expect(exact(reserve.id,"BTC").opening_balance_minor).toBe(10);expect(balances.filter((b)=>b.wallet_id===reserve.id&&b.currency!=="BTC").every((b)=>b.opening_balance_minor===0)).toBe(true);
 // Selecting a global display currency never changes wallet defaults.
 const defaults=(await rows("wallets")).map((w)=>[w.id,w.default_balance_id]);
 await page.getByRole("combobox",{name:en.Wallets.displayCurrency}).selectOption("BTC");await expect(page.getByRole("list",{name:en.Nav.wallets,exact:true}).getByRole("listitem")).toHaveCount(3);expect((await rows("wallets")).map((w)=>[w.id,w.default_balance_id])).toEqual(defaults);
 // Actual same-currency Move through the composer, using the precise source row.
 await page.getByRole("button",{name:en.Nav.add,exact:true}).filter({visible:true}).click();dialog=page.getByRole("dialog");await dialog.locator("label").filter({hasText:new RegExp(`^${en.Add.move}$`)}).click();
 await dialog.getByRole("combobox",{name:en.Add.from,exact:true}).selectOption(first);await dialog.getByRole("combobox",{name:en.Add.fromCurrency,exact:true}).selectOption({label:"USD"});await dialog.getByRole("combobox",{name:en.Add.to,exact:true}).selectOption(second);await dialog.getByRole("combobox",{name:en.Add.toCurrency,exact:true}).selectOption({label:"USD"});await dialog.getByRole("button",{name:"1",exact:true}).click();await commitThenLoseResponse(page,en.Add.moveSave,1);
 // Same-wallet Exchange has explicit actual received, without implicit BTC rates.
 await page.getByRole("button",{name:en.Nav.add,exact:true}).filter({visible:true}).click();dialog=page.getByRole("dialog");await dialog.locator("label").filter({hasText:new RegExp(`^${en.Add.exchange}$`)}).click();await dialog.getByRole("combobox",{name:en.Add.from,exact:true}).selectOption(first);await dialog.getByRole("combobox",{name:en.Add.fromCurrency,exact:true}).selectOption({label:"USD"});await dialog.getByRole("combobox",{name:en.Add.toCurrency,exact:true}).selectOption({label:"LBP"});await dialog.getByRole("button",{name:"1",exact:true}).click();await dialog.getByRole("button",{name:en.Add.editReceived,exact:true}).click();await dialog.getByLabel(en.Add.received.replace("{currency}","LBP"),{exact:true}).fill("90000");await commitThenLoseResponse(page,en.Add.exchangeSave,2);
 const transactions=await rows("transactions");expect(transactions.filter((t)=>t.kind==="transfer")).toHaveLength(2);expect(transactions.some((t)=>t.balance_id===exact(first,"USD").id&&t.to_balance_id===exact(second,"USD").id)).toBe(true);expect(transactions.some((t)=>t.balance_id===exact(first,"USD").id&&t.to_balance_id===exact(first,"LBP").id)).toBe(true);
 await rpc("reorder_wallets",{p_ids:[reserve.id,second,first]});await inspectBoth(page,"wallets");expect((await rows("wallets")).sort((a,b)=>a.position-b.position).map((w)=>w.id)).toEqual([reserve.id,second,first]);
 for(const [locale,messages] of [["en",en],["ar",ar]] as const){
  await page.goto(`/${locale}/wallets`);
  const list=page.getByRole("list",{name:messages.Nav.wallets,exact:true});
  for(const code of catalog.map((c)=>c.code)){
   await page.getByRole("combobox",{name:messages.Wallets.displayCurrency}).selectOption(code);
   expect(await list.locator("button[aria-label]").evaluateAll((buttons)=>buttons.filter((b)=>b.querySelector("bdi")).map((b)=>b.querySelector("bdi")!.textContent))).toEqual(["Lifecycle Reserve","Lifecycle Bank","Lifecycle Pocket"]);
   await expectNoHorizontalOverflow(page);
  }
 }
 // Nonzero disable is blocked; after spending to zero, defaults switch and IDs survive re-enable.
 const blocked=await db.rpc("set_currency_disabled",{p_code:"BTC",p_disabled:true});expect(blocked.error?.message).toBe("currency.nonzero");
 const category=(await rows("categories")).find((c)=>c.kind==="expense"&&c.parent_id===null)!;
 const expenseId=randomUUID();await rpc("save_transaction",{p_id:expenseId,p_expected_revision:null,p_input:{kind:"expense",occurredOn:"2026-11-05",balanceId:exact(reserve.id,"BTC").id,amountMinor:10,categoryId:category.id,note:"Lifecycle BTC expense"},p_items:null,p_settlement:null},{BTC:8});
 await rpc("set_wallet_default",{p_wallet_id:first,p_balance_id:exact(first,"BTC").id});await rpc("set_currency_disabled",{p_code:"BTC",p_disabled:true});expect((await rows("wallets")).every((w)=>![...btcIds,exact(reserve.id,"BTC").id].includes(w.default_balance_id))).toBe(true);
 await inspectBoth(page,"activity");await expect(page.getByRole("main")).toContainText("Lifecycle BTC expense");
 await rpc("set_currency_disabled",{p_code:"BTC",p_disabled:false});expect((await rows("wallet_balances")).filter((b)=>b.currency==="BTC").map((b)=>b.id).sort()).toEqual([...btcIds,exact(reserve.id,"BTC").id].sort());
 await rpc("create_currency",{p_code:"UNUSED",p_symbol:"U",p_decimal_places:3});await rpc("delete_currency",{p_code:"UNUSED"});expect((await rows("currencies")).some((c)=>c.code==="UNUSED")).toBe(false);
 // The stale tab submits the exact precision2 intent it used before another client edits.
 await rpc("create_currency",{p_code:"STALEDRAFT",p_symbol:"D",p_decimal_places:2});await page.goto("/en/wallets");
 await page.getByRole("button",{name:en.Wallets.add,exact:true}).click();dialog=page.getByRole("dialog");
 await dialog.getByLabel(en.Wallets.name,{exact:true}).fill("Stale opening recovery");await dialog.getByRole("combobox",{name:en.Wallets.defaultCurrency}).selectOption("STALEDRAFT");await dialog.getByLabel(en.Wallets.amount,{exact:true}).fill("1.00");
 await rpc("update_currency",{p_current_code:"STALEDRAFT",p_code:"STALEDRAFT",p_symbol:"D",p_decimal_places:8});
 await dialog.getByRole("button",{name:en.Wallets.create,exact:true}).click();await expect(dialog.getByLabel(en.Wallets.amount,{exact:true})).toHaveValue("");
 expect((await rows("wallets")).some(w=>w.name==="Stale opening recovery")).toBe(false);
 await dialog.getByLabel(en.Wallets.amount,{exact:true}).fill("1.00000001");await dialog.getByRole("button",{name:en.Wallets.create,exact:true}).click();await expect(dialog).toHaveCount(0);
 const recovered=(await rows("wallets")).find(w=>w.name==="Stale opening recovery")!;expect(recovered).toBeTruthy();expect((await rows("wallet_balances")).find(b=>b.wallet_id===recovered.id&&b.currency==="STALEDRAFT").opening_balance_minor).toBe(100000001);
 catalog=await rows("currencies");
 // Both signs settle atomically to retained counterpart IDs before tombstoning.
 for(const opening of [250,-125]){const id=await rpc("create_wallet",{p_name:`Delete ${opening}`,p_kind:"cash",p_default_currency:"USD",p_opening_minor:opening},{USD:2});const source=(await rows("wallet_balances")).find((b)=>b.wallet_id===id&&b.currency==="USD")!;await rpc("settle_and_delete_wallet",{p_request_id:randomUUID(),p_wallet_id:id,p_settlements:(await rows("wallet_balances")).filter(b=>b.wallet_id===id).map(b=>({balanceId:b.id,counterpartBalanceId:b.id===source.id?exact(second,"USD").id:null,expectedAmountMinor:b.id===source.id?opening:0,expectedUnit:{code:b.currency,decimalPlaces:catalog.find(c=>c.code===b.currency)!.decimal_places}}))});expect((await rows("wallets")).find((w)=>w.id===id).deleted_at).not.toBeNull();expect(Number((await rows("wallet_balance_totals")).find((b)=>b.balance_id===source.id).balance_minor)).toBe(0);}
 await inspectBoth(page,"wallets");await inspectBoth(page,"activity");await page.screenshot({path:".superpowers/sdd/2026-11-05-global-currencies-all-wallets/final-fix-authenticated-ar-320.png",fullPage:true});
 expect((await rows("transactions")).filter((t)=>t.kind==="transfer")).toHaveLength(4);
 // Real DB → query projection → serialized workbook after receiver rename/tombstone.
 const receiver=await rpc("create_wallet",{p_name:"Original change receiver",p_kind:"cash",p_default_currency:"USD",p_opening_minor:0});
 const receiverBalances=(await rows("wallet_balances")).filter(b=>b.wallet_id===receiver);const receiverUsd=receiverBalances.find(b=>b.currency==="USD")!;const cashId=randomUUID();
 await rpc("save_transaction",{p_id:cashId,p_expected_revision:null,p_input:{kind:"expense",occurredOn:"2026-11-05",balanceId:exact(first,"USD").id,amountMinor:100,categoryId:category.id,note:"Snapshot cashier"},p_items:null,p_settlement:{tenderMinor:200,changes:[{balanceId:receiverUsd.id,amountMinor:100}]}},{USD:2});
 expect((await db.from("wallets").update({name:"Renamed receiver"}).eq("id",receiver)).error).toBeNull();
 await rpc("settle_and_delete_wallet",{p_request_id:randomUUID(),p_wallet_id:receiver,p_settlements:receiverBalances.map(b=>({balanceId:b.id,counterpartBalanceId:b.id===receiverUsd.id?exact(second,"USD").id:null,expectedAmountMinor:b.id===receiverUsd.id?100:0,expectedUnit:{code:b.currency,decimalPlaces:catalog.find(c=>c.code===b.currency)!.decimal_places}}))});
 expect((await rows("wallets")).find(w=>w.id===receiver).deleted_at).not.toBeNull();
 const stored=(await rows("cashier_changes")).find(c=>c.transaction_id===cashId)!;expect(stored).toMatchObject({wallet_name_snapshot:"Original change receiver",balance_id:receiverUsd.id,amount_minor:100,currency:"USD"});
 const exported=await page.request.get("/en/settings/export");expect(exported.status()).toBe(200);const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await exported.body() as unknown as Parameters<typeof workbook.xlsx.load>[0]);
 const facts=workbook.getWorksheet("Source & Exact Facts")!;for(const [field,expected] of [["walletNameSnapshot","Original change receiver"],["balanceId",receiverUsd.id],["amountMinor","100"],["currency","USD"]]){const index=facts.getColumn(1).values.indexOf(`source/transactions/${cashId}/settlement/changes/0/${field}`);expect(index).toBeGreaterThan(0);expect(facts.getCell(index,3).value).toBe(expected);}

});
