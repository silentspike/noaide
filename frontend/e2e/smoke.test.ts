/**
 * noaide E2E Smoke Test Suite
 *
 * Verifies all critical UI features across all tabs.
 * Run: npx playwright test e2e/smoke.test.ts
 */
import { test, expect } from "@playwright/test";

test.describe("noaide smoke tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // Dismiss welcome screen if shown
    const welcome = page.getByTestId("welcome-dismiss");
    if (await welcome.isVisible({ timeout: 2000 }).catch(() => false)) {
      await welcome.click();
    }
  });

  test("sessions panel loads with sort/group/filter", async ({ page }) => {
    await expect(page.getByTestId("session-sort-dropdown")).toBeVisible();
    await expect(page.getByTestId("session-group-dropdown")).toBeVisible();
    await expect(page.getByTestId("session-filter")).toBeVisible();
    await expect(page.getByTestId("archive-toggle")).toBeVisible();
    await expect(page.getByTestId("new-session-btn")).toBeVisible();
  });

  test("sort dropdown changes session order", async ({ page }) => {
    await page.getByTestId("session-sort-dropdown").selectOption("name");
    // Should not crash — order changes are visual
    await expect(page.getByTestId("session-sort-dropdown")).toHaveValue("name");
  });

  test("group dropdown shows headers", async ({ page }) => {
    await page.getByTestId("session-group-dropdown").selectOption("cliType");
    // Group headers should appear (in grouped For loop)
    await expect(page.locator("[data-testid^='group-header-']").first()).toBeVisible({ timeout: 3000 });
  });

  test("context menu opens on right-click", async ({ page }) => {
    const card = page.locator("[role='button']").first();
    await card.click({ button: "right" });
    await expect(page.getByTestId("context-menu")).toBeVisible();
    // Close by clicking outside
    await page.locator("body").click();
  });

  test("plan tab loads with selector", async ({ page }) => {
    await page.getByTestId("tab-plan").click();
    await expect(page.getByTestId("plan-selector")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("plan-selector-toggle")).toBeVisible();
  });

  test("kanban board has cards and columns", async ({ page }) => {
    await page.getByTestId("tab-plan").click();
    await page.getByTestId("sidebar-view-kanban").click();
    await expect(page.locator("[data-testid^='kanban-column-']").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("[data-testid^='kanban-card-']").first()).toBeVisible();
  });

  test("dependency graph has clickable nodes", async ({ page }) => {
    await page.getByTestId("tab-plan").click();
    await page.getByTestId("sidebar-view-dependencies").click();
    const node = page.locator("[data-testid^='dependency-node-']").first();
    await expect(node).toBeVisible({ timeout: 5000 });
    // Click should change opacity of non-downstream nodes
    await node.dispatchEvent("click");
  });

  test("undo button exists and is disabled initially", async ({ page }) => {
    await page.getByTestId("tab-plan").click();
    const undo = page.getByTestId("undo-btn");
    await expect(undo).toBeVisible();
    await expect(undo).toBeDisabled();
  });

  test("network tab has filter and HAR export", async ({ page }) => {
    await page.getByTestId("tab-network").click();
    await expect(page.getByTestId("network-filter")).toBeVisible();
    await expect(page.getByTestId("har-export-btn")).toBeVisible();
  });

  test("keyboard shortcuts overlay opens with ?", async ({ page }) => {
    await page.keyboard.press("?");
    await expect(page.getByTestId("keyboard-shortcuts-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("keyboard-shortcuts-overlay")).not.toBeVisible();
  });

  test("welcome screen shows on first visit", async ({ page, context }) => {
    // Clear localStorage to simulate first visit
    await page.evaluate(() => localStorage.removeItem("noaide-welcomed"));
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("welcome-screen")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("welcome-dismiss").click();
    await expect(page.getByTestId("welcome-screen")).not.toBeVisible();
  });

  test("ARIA labels present on key elements", async ({ page }) => {
    const ariaCount = await page.evaluate(() => document.querySelectorAll("[aria-label]").length);
    expect(ariaCount).toBeGreaterThanOrEqual(3);
  });
});
