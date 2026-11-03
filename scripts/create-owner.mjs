// Creates the single owner account. Usage: pnpm owner:create <password>
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and OWNER_EMAIL from .env.local.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = process.env.OWNER_EMAIL;
const password = process.argv[2];

if (!url || !secret || !email) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and OWNER_EMAIL in .env.local.");
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error("Usage: pnpm owner:create <password of at least 12 characters>");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log(`Owner account created: ${data.user.email}`);
