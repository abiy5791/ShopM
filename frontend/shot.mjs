import { chromium, devices } from "@playwright/test";

const BASE = process.env.BASE || "http://localhost:5174";
const OUT = process.env.OUT || ".";

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
const page = await context.newPage();

await page.goto(`${BASE}/login`);
await page.getByLabel("Email").fill("owner@shopm.local");
await page.getByLabel("Password", { exact: true }).fill("password123");
await page.getByRole("button", { name: "Log in" }).click();
await page.waitForURL(`${BASE}/`, { timeout: 15000 });

await page.goto(`${BASE}/purchases`);
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "New purchase" }).click();
await page.waitForTimeout(400);
await page.getByRole("combobox", { name: "Product" }).click();
await page.waitForTimeout(400);

// Bring the last option into view to prove scrolling works, then screenshot.
await page.getByRole("option", { name: /Women's Heels/ }).scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/dropdown-bottom-real.png` });

await browser.close();
console.log("done");
