import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config (plan §8, §11 Phase 8). Assumes the backend stack is already
 * running and seeded (`make up && make migrate && make seed`) at
 * PLAYWRIGHT_API_BASE_URL — Playwright only boots the frontend dev server.
 */
// Override with E2E_PORT if 5173 is taken by another project.
const FRONTEND_PORT = process.env.E2E_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // specs share seeded accounts; avoid cross-test races
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${FRONTEND_PORT} --strictPort`,
    url: `http://localhost:${FRONTEND_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
