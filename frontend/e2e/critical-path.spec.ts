import { expect, test } from "@playwright/test";

import { login, OWNER } from "./helpers";

/** Plan §8 Phase 8 DoD: "login → POS sale → void → report" critical path. */
test.describe("critical path: login → POS sale → void → report", () => {
  test("owner can ring up a sale, void it, and see reports", async ({ page }) => {
    await login(page, OWNER);

    // --- POS: ring up a sale ---
    await page.getByRole("link", { name: "Point of Sale", exact: true }).click();
    await expect(page).toHaveURL("/pos");

    const productCard = page.getByRole("button", { name: /Cola 500ml/ });
    await expect(productCard).toBeVisible({ timeout: 15_000 });
    await productCard.click();

    await page.getByRole("button", { name: "Charge", exact: true }).click();
    await page.getByRole("button", { name: /^Charge \$/ }).click();

    await expect(page.getByRole("heading", { name: "Receipt" })).toBeVisible();
    await expect(page.getByText("OFFLINE", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "Done" }).click();

    // --- Sales: the new sale is on top; void it ---
    await page.getByRole("link", { name: "Sales", exact: true }).click();
    await expect(page).toHaveURL("/sales");

    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow.getByText("completed")).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await firstRow.getByRole("button", { name: "Void sale" }).click();
    await expect(firstRow.getByText("voided")).toBeVisible();

    // --- Reports: the sales report loads with a monetary summary ---
    await page.getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL("/reports");
    await expect(page.getByText("Total sales")).toBeVisible();
  });
});
