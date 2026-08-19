import { expect, test } from "@playwright/test";

import { login, OWNER } from "./helpers";

/**
 * Phone-layout regressions that only show on a real device.
 *
 * Both of these shipped to production and neither is visible on a desktop
 * viewport, so they are pinned here rather than left to manual checking.
 */
test.describe("phone layout", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("form controls are large enough that iOS does not zoom on focus", async ({ page }) => {
    // iOS silently zooms the whole page in when a control smaller than 16px
    // takes focus, and never zooms back out — the page is left scrolled and
    // half off-screen. Anything typable has to be at least 16px on a phone.
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();

    const tooSmall = await page.evaluate(() =>
      [...document.querySelectorAll("input, textarea, [role=combobox]")]
        .filter((el) => {
          const type = el.getAttribute("type");
          // These never focus a keyboard, so they never trigger the zoom.
          return !["checkbox", "radio", "file"].includes(type ?? "");
        })
        .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
        .map((el) => el.getAttribute("placeholder") ?? el.getAttribute("name") ?? el.tagName),
    );

    expect(tooSmall).toEqual([]);
  });

  test("the account menu stays on screen however long the shop name is", async ({ page }) => {
    // The header is `justify-between`; without shrink protection a long shop
    // name pushes the account menu past the right edge. It stays in the DOM and
    // still reports as "visible", so only its box gives the bug away.
    await login(page, OWNER);

    const header = page.locator("header");
    await header
      .locator("span")
      .first()
      .evaluate((el) => {
        el.textContent = "Fenet Boutique Bole Main Branch Number Two";
      });

    const account = page.getByRole("button", { name: "Account menu" });
    const box = await account.boundingBox();
    const width = page.viewportSize()!.width;

    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);

    // And the page itself must not have gained a sideways scroll.
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });
});
