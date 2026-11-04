import { defineConfig, devices } from "@playwright/test";

// Dedicated configured-auth lane; never starts/reuses the demo-mode webServer.
// Point only at a disposable app/Auth stack with confirmed, onboarded synthetic
// users and captcha disabled (or test keys). Credentials stay in the environment.
const baseURL = process.env.AUTH_E2E_BASE_URL;
if (!baseURL || !process.env.AUTH_E2E_EMAIL || !process.env.AUTH_E2E_PASSWORD) {
  throw new Error("Auth E2E requires AUTH_E2E_BASE_URL, AUTH_E2E_EMAIL and AUTH_E2E_PASSWORD for a disposable configured app.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "auth-session.spec.ts",
  fullyParallel: false,
  workers: 1, // Existing global sign-out must not race another session test.
  timeout: 90_000,
  reporter: [["list"]],
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "auth-chromium", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } } },
    { name: "auth-webkit", use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } } },
  ],
});
