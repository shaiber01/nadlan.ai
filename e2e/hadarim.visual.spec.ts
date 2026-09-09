import { expect, test, type Page } from "@playwright/test";

/**
 * Hadarim ERP variants, offline: element-level screenshots of the ERP forms for presenter review
 * (e2e/screenshots/hadarim-v-*.png), the scene-1 variant B (new invoice), the PO correction guard and
 * the reference screens. The report-section tour runs in e2e/hadarim.db.spec.ts, where the agent's
 * tools produce a finished control for the viewer to show.
 */

async function fresh(page: Page) {
  await page.goto("/hadarim.html");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("hadarim-offline", "1"); // e2e runs on the browser-only generator data, never the shared database
  });
  await page.reload();
  await page.getByTestId("presenter-bar").waitFor();
}

async function elementShot(page: Page, testId: string, name: string) {
  const el = page.getByTestId(testId).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `e2e/screenshots/hadarim-v-${name}.png` });
}

test.describe("Hadarim — ERP variants and screens", () => {
  test("scene 1 variant B: a new invoice keyed into שלד gets the next number and shows in the change log", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("scene1-variant").selectOption("B");
    await expect(page.getByTestId("erp-invoice-row-1147")).toHaveCount(0);
    await page.getByTestId("erp-invoice-new").click();
    // the bookkeeper keys the drainage invoice into שלד (the script's scene 1, variant B)
    await page.getByTestId("erp-new-supplier").selectOption("SUP-NTB");
    await page.getByTestId("erp-new-docno").fill("2026-087");
    await page.getByTestId("erp-new-date").fill("2026-08-31");
    await page.getByTestId("erp-new-amount").fill("180000");
    await page.getByTestId("erp-new-desc").fill("עבודות עפר וקווי ניקוז — פיתוח חוץ, שלב א׳");
    await page.getByTestId("erp-new-section").selectOption("02");
    await page.getByTestId("erp-new-contract").selectOption("07-01");
    await page.getByTestId("erp-new-by").selectOption("SARIT");
    await elementShot(page, "erp-invoice-new-form", "erp-new-invoice-form");
    await page.getByTestId("erp-new-save").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");
    // the ERP numbers invoices sequentially: the new one gets the number after the seed's last
    await expect(page.getByTestId("erp-invoice-view")).toHaveAttribute("data-invoice-id", /^\d+$/);
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("נקלט");
    // the report viewer sees the new invoice in the live recorded amounts
    await page.goto("/report.html");
    await expect(page.getByTestId("report-row-02")).toContainText("12,600,000");
  });

  test("ERP: PO correction keeps the amount fixed; contracts and budget screens render", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("erp-nav-purchase_orders").click();
    await page.getByTestId("erp-po-row-2291").click();
    await page.getByTestId("erp-po-edit").click();
    await page.getByTestId("erp-po-qty-input").fill("12");
    await page.getByTestId("erp-po-save").click();
    await expect(page.getByTestId("erp-po-error")).toContainText("57,600");
    await page.getByTestId("erp-po-unit-input").selectOption("טון");
    await page.getByTestId("erp-po-price-input").fill("4800");
    await elementShot(page, "erp-po-edit-form", "erp-po-edit");
    await page.getByTestId("erp-po-save").click();
    await expect(page.getByTestId("erp-po-view")).toContainText("4,800 ₪ לטון");
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("12 טון");

    // the same order stated the way the quote states it: 12,000 ק״ג priced per טון, still 57,600 ₪
    await page.getByTestId("erp-po-edit").click();
    await page.getByTestId("erp-po-qty-input").fill("12000");
    await page.getByTestId("erp-po-unit-input").selectOption("ק״ג");
    await expect(page.getByTestId("erp-po-computed")).toHaveValue(/57,600/);
    await page.getByTestId("erp-po-save").click();
    await expect(page.getByTestId("erp-po-formula")).toContainText("12,000 ק״ג = 12 טון × 4,800 ₪ לטון = 57,600 ₪");
    await page.getByTestId("erp-nav-contracts").click();
    await page.getByTestId("erp-contract-row-07-01").click();
    await elementShot(page, "erp-contract-view", "erp-contract-07-01");
    await expect(page.getByTestId("erp-contract-exclusions")).toContainText("3.4");
    await page.getByTestId("erp-nav-budget").click();
    await expect(page.getByTestId("erp-recorded-total")).toContainText("20,070,000");
    await elementShot(page, "erp-budget", "erp-budget");
    await page.getByTestId("erp-nav-invoices").click();
    await elementShot(page, "erp-invoice-list", "erp-invoice-list");
  });
});
