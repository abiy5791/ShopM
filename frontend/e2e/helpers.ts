import { expect, type Page } from "@playwright/test";

/** Demo accounts from `make seed` (plan §11 Phase 0). */
export const OWNER = { email: "owner@shopm.local", password: "password123" };
export const CASHIER = { email: "cashier.a@shopm.local", password: "password123" };

export async function login(page: Page, { email, password }: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  // exact: the show/hide toggle's "Show password" label would also match.
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}
