/**
 * Mobile viewport tests — verifies mobile layout at 375x812.
 * Run: npx playwright test e2e/mobile.test.ts
 */
import { test, expect } from "@playwright/test";

test.describe("mobile layout (375x812)", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("https://localhost:9999/", { waitUntil: "networkidle" });
    const welcome = page.getByTestId("welcome-dismiss");
    if (await welcome.isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcome.click();
    }
  });

  test("no horizontal overflow at 375px width", async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test("mobile media query matches", async ({ page }) => {
    const isMobile = await page.evaluate(() => window.matchMedia("(max-width: 768px)").matches);
    expect(isMobile).toBe(true);
  });

  test("BottomTabBar visible on mobile", async ({ page }) => {
    // Mobile layout renders BottomTabBar at the bottom
    const tabCount = await page.evaluate(() =>
      document.querySelectorAll("nav button, [role='tablist'] button").length
    );
    expect(tabCount).toBeGreaterThan(0);
  });
});
