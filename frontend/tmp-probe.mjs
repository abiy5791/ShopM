import { chromium } from "@playwright/test";

const browser = await chromium.launch();

for (const BASE of ["http://localhost:5173", "http://localhost:5175"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const hits = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/.vite/deps/")) return;
    try {
      const body = await r.text();
      const n = (body.match(/var lockStack = \[\]/g) || []).length;
      if (n) hits.push(`${u.split("/").pop()} x${n}`);
    } catch {}
  });

  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("owner@shopm.local");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  await page.goto(`${BASE}/purchases`);
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "New purchase" }).click();
  await page.waitForTimeout(400);
  await page.getByRole("combobox", { name: "Product" }).click();
  await page.waitForTimeout(1000);

  console.log(`${BASE} -> scroll-lock registries actually loaded by the app:`, hits);
  await context.close();
}

await browser.close();
