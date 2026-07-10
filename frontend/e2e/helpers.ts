import { expect, type Page } from "@playwright/test";

/** Demo accounts from `make seed` (plan §11 Phase 0). */
export const OWNER = { email: "owner@shopm.local", password: "password123" };
export const CASHIER = { email: "cashier.a@shopm.local", password: "password123" };

export async function login(page: Page, { email, password }: { email: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");
}
