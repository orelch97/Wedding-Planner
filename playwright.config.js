import { defineConfig, devices } from "@playwright/test";

const required = {
  VITE_USE_FIREBASE_EMULATORS: "true",
  VITE_FIREBASE_ENV: "test",
  VITE_FIREBASE_PROJECT_ID: "demo-wedding-planner-e2e",
  GCLOUD_PROJECT: "demo-wedding-planner-e2e",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
  FUNCTIONS_EMULATOR_HOST: "127.0.0.1:5001",
};
for (const [key, value] of Object.entries(required)) {
  if (process.env[key] !== value) {
    throw new Error(`E2E safety stop: ${key} must equal ${value}; refusing to launch tests.`);
  }
}

const firebaseClientEnv = {
  VITE_FIREBASE_API_KEY: "demo-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "127.0.0.1",
  VITE_FIREBASE_PROJECT_ID: "demo-wedding-planner-e2e",
  VITE_FIREBASE_STORAGE_BUCKET: "demo-wedding-planner-e2e.appspot.com",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  VITE_FIREBASE_APP_ID: "1:000000000000:web:playwright-e2e",
  VITE_FIREBASE_ENV: "test",
  VITE_USE_FIREBASE_EMULATORS: "true",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1365, height: 900 } } },
    { name: "chromium-mobile", use: { ...devices["Pixel 7"], viewport: { width: 393, height: 852 } } },
  ],
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, ...firebaseClientEnv },
  },
});
