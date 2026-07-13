import { expect, test } from "@playwright/test";

import { CASHIER, login } from "./helpers";

/** Plan §3.4, §10, §11 Phase 8 DoD: "offline sale → reconnect → sync" critical path. */
test.describe("critical path: offline sale → reconnect → sync", () => {
  test("a cashier can complete a sale offline and it syncs on reconnect", async ({
    page,
    context,
  }) => {
    await login(page, CASHIER);
    await page.getByRole("link", { name: "Point of Sale", exact: true }).click();
    await expect(page).toHaveURL("/pos");

    // Warm the IndexedDB product cache while still online.
    const productCard = page.getByRole("button", { name: /Netela Shawl/ });
    await expect(productCard).toBeVisible({ timeout: 15_000 });

    // Go offline and complete a sale — it should queue locally, not fail.
    await context.setOffline(true);
    await productCard.click();
    await page.getByRole("button", { name: "Charge", exact: true }).click();
    await page.getByRole("button", { name: /^Charge Br/ }).click();

    await expect(page.getByText(/OFFLINE — pending sync/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText(/pending sync/i)).toBeVisible();

    // Reconnect — the outbox drains automatically, server is idempotent.
    await context.setOffline(false);
    await expect(page.getByText(/pending sync/i)).toHaveCount(0, { timeout: 15_000 });
  });
});
