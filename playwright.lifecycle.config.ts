import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
// Explicit opt-in to a disposable loopback fixture; never consult .env.local.
const statePath = process.env.BUDGET_LIFECYCLE_AUTH_FILE;
if (!statePath) throw new Error("BUDGET_LIFECYCLE_AUTH_FILE must identify the ignored synthetic fixture");
const fixture = JSON.parse(readFileSync(statePath, "utf8")) as {url: string; key: string};
if (new URL(fixture.url).hostname !== "127.0.0.1") throw new Error("Lifecycle fixture must use loopback");
export default defineConfig({
 testDir:"./integration", fullyParallel:false, workers:1, timeout:120_000,
 use:{...devices["Pixel 5"],viewport:{width:320,height:568},baseURL:"http://localhost:3101",trace:"off"},
 outputDir:".superpowers/sdd/2026-11-05-global-currencies-all-wallets/task10-lifecycle-results",
 webServer:{command:"pnpm exec next dev --port 3101",url:"http://localhost:3101/en",reuseExistingServer:false,timeout:120_000,
 env:{NEXT_PUBLIC_SUPABASE_URL:fixture.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:fixture.key,NEXT_PUBLIC_SUPABASE_ANON_KEY:"",SUPABASE_SERVICE_ROLE_KEY:"",SUPABASE_SECRET_KEY:""}},
});
