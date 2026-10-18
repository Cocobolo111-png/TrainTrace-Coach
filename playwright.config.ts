import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 10000 },
  use: {
    baseURL: "http://127.0.0.1:14173",
    actionTimeout: 10000,
    ...devices["iPhone 13"],
    defaultBrowserType: "chromium",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [
    { name: "local", testMatch: ["**/feedback.spec.ts", "**/journey.spec.ts"] },
    {
      name: "public",
      testMatch: ["**/public.spec.ts", "**/journey.spec.ts"],
      use: { baseURL: "http://127.0.0.1:14174" },
    },
  ],
  webServer: [
    {
      command:
        "node node_modules/vite/bin/vite.js preview --outDir dist-local --host 127.0.0.1 --port 14173 --strictPort",
      port: 14173,
      reuseExistingServer: false,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 14174 --strictPort",
      port: 14174,
      reuseExistingServer: false,
    },
  ],
});
