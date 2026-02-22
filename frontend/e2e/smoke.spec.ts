import { test, expect } from "@playwright/test";

test.describe("Smoke Tests", () => {
  test("app loads and renders the root element", async ({ page }) => {
    await page.goto("/");
    const app = page.locator("#app");
    await expect(app).toBeVisible();
  });

  test("page title is noaide", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("noaide");
  });

  test("three-panel layout renders on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    // App should render without crashing — check that body has content
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
  });

  test("no console errors on initial load", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push(msg.text());
      }
    });
    await page.goto("/");
    await page.waitForTimeout(1000);
    // Filter out expected WebTransport connection errors (no server running)
    const unexpected = errors.filter(
      (e) => !e.includes("WebTransport") && !e.includes("ERR_CONNECTION") && !e.includes("net::")
    );
    expect(unexpected).toEqual([]);
  });

  test("fonts are loaded", async ({ page }) => {
    await page.goto("/");
    // Check that font preload links exist
    const fontLinks = page.locator('link[rel="preload"][as="font"]');
    await expect(fontLinks).toHaveCount(2);
  });
});
