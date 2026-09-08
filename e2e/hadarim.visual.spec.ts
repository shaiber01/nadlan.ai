import { expect, test, type Page } from "@playwright/test";

/**
 * Hadarim v2 visual tour: element-level screenshots of the report sections, the ERP forms and the
 * document viewer for presenter review (e2e/screenshots/hadarim-v-*.png), plus the scene-1 variant B
 * (new invoice) and the PO correction guard.
 */

async function fresh(page: Page) {
  await page.goto("/hadarim.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("presenter-bar").waitFor();
  await page.getByTestId("skip-motion").check();
}

async function say(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}

async function option(page: Page, id: string) {
  const button = page.getByTestId(`chat-option-${id}`).last();
  await button.waitFor();
  await button.click();
}

async function elementShot(page: Page, testId: string, name: string) {
  const el = page.getByTestId(testId).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `e2e/screenshots/hadarim-v-${name}.png` });
}

async function runWholeScript(page: Page) {
  await page.getByTestId("erp-invoice-row-1147").click();
  await page.getByTestId("erp-invoice-edit").click();
  await page.getByTestId("erp-invoice-by").selectOption("SARIT");
  await page.getByTestId("erp-invoice-section").selectOption("02");
  await page.getByTestId("erp-invoice-save").click();
  await page.getByTestId("go-control").click();
  await say(page, "תכיני בקרה תקציבית להדרים");
  await option(page, "review");
  await option(page, "yes_target");
  await option(page, "update");
  await option(page, "yes_tons");
  await option(page, "refer_roi");
  await option(page, "all");
  const coverage = page.getByTestId("finding-card").filter({ hasText: "ניקוז" }).last();
  await coverage.getByTestId("finding-free-text").fill("צריך להזמין. יש הצעה בתיקייה");
  await coverage.getByTestId("finding-free-send").click();
  await option(page, "accept");
  await expect(page.getByTestId("control-headline")).toContainText("48,360,000 ₪");
}

test.describe("Hadarim v2 — visual tour and ERP variants", () => {
  test("report sections, chart, CEO page and document viewer", async ({ page }) => {
    test.setTimeout(120_000);
    await fresh(page);
    await runWholeScript(page);
    await say(page, "תוסיפי השוואה לבקרה הקודמת ומגמות");
    await say(page, "תציגי את הטבלה לפי בניין");
    await say(page, "תכיני גרסה לדנה — עמוד אחד");
    await option(page, "open");
    await expect(page.getByTestId("report-view")).toBeVisible();
    await elementShot(page, "report-section-1", "exec-summary");
    await elementShot(page, "report-section-2", "status");
    await elementShot(page, "report-section-3", "sections-table");
    await elementShot(page, "report-by-building", "by-building");
    await elementShot(page, "report-section-4", "changes-4a-4b");
    await elementShot(page, "report-section-5", "material");
    await elementShot(page, "report-section-6", "contingency");
    await elementShot(page, "report-section-7", "risks");
    await elementShot(page, "report-section-8", "issues");
    await elementShot(page, "report-section-9", "verified");
    await elementShot(page, "report-section-10", "trends");
    await page.getByTestId("report-appendices-toggle").click();
    await elementShot(page, "report-section-11", "appendices");
    await page.getByTestId("report-tab-ceo").click();
    await elementShot(page, "report-ceo", "ceo-page");
    await page.getByTestId("report-tab-full").click();
    // a source link in 4a opens the price appendix in the viewer
    await page.getByTestId("report-change-source").first().click();
    await expect(page.getByTestId("document-view")).toBeVisible();
    await elementShot(page, "document-view", "document-appendix");
    await page.keyboard.press("Escape");
    // back to the chat: the newest message is in view
    await page.getByTestId("control-back-to-chat").click();
    await expect(page.getByTestId("chat-message").last()).toBeInViewport();
    // finding sources open documents at their anchor
    const card = page.getByTestId("finding-card").filter({ hasText: "ניקוז" }).last();
    await card.scrollIntoViewIfNeeded();
    await card.getByTestId("finding-source").filter({ hasText: "3.4" }).first().click();
    await expect(page.getByTestId("document-view")).toBeVisible();
    await elementShot(page, "document-view", "document-contract-exclusion");
  });

  test("scene 1 variant B: a new invoice keyed into שלד triggers the allocation finding", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("scene1-variant").selectOption("B");
    await page.getByTestId("erp-invoice-new").click();
    await page.getByTestId("erp-new-prefill").click();
    await elementShot(page, "erp-invoice-new-form", "erp-new-invoice-form");
    await page.getByTestId("erp-new-save").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");
    await page.getByTestId("go-control").click();
    await say(page, "תכיני בקרה תקציבית להדרים");
    await expect(page.getByTestId("chat-message").filter({ hasText: "נמצאו 4 ממצאים" })).toBeVisible();
    await option(page, "review");
    await expect(page.getByTestId("finding-card").first()).toContainText("נ.ת.ב.");
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
    await expect(page.getByTestId("erp-po-view")).toContainText("4,800");
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("12 טון");
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
