import { expect, test, type Page } from "@playwright/test";

/**
 * Hadarim web app, offline (browser-only generator data): the simulated ERP edit of scene 1 (both
 * variants live in hadarim.visual.spec.ts), the report tab as a read-only viewer of the control,
 * exports, persistence and reset. Running the control belongs to the Claude agent and its tools; the
 * live-database flow that shows the agent's finished control in this viewer is e2e/hadarim.db.spec.ts.
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

/** The ERP and the report are separate pages; neither links to the other. */
async function goTo(page: Page, app: "erp" | "report") {
  await page.goto(app === "report" ? "/report.html" : "/hadarim.html");
  await page.getByTestId(app === "report" ? "report-header" : "presenter-bar").waitFor();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/hadarim-${name}.png`, fullPage: false });
}

/** With invoice 1147 open in the ERP: re-allocate it to 02-שלד as שרית (the script's scene 1). */
async function moveInvoiceToSheled(page: Page) {
  await page.getByTestId("erp-invoice-edit").click();
  await page.getByTestId("erp-invoice-by").selectOption("SARIT");
  await page.getByTestId("erp-invoice-section").selectOption("02");
  await page.getByTestId("erp-invoice-save").click();
  await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");
}

test.describe("Hadarim — ERP and the report viewer (offline)", () => {
  test("scene 1 (variant A): the bookkeeper moves invoice 1147 to שלד in the ERP", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fresh(page);
    await expect(page.getByTestId("erp-app")).toBeVisible();
    await page.getByTestId("erp-invoice-row-1147").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("07 — פיתוח");
    await shot(page, "01-invoice-1147");
    await moveInvoiceToSheled(page);
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("שלד");
    await shot(page, "02-invoice-1147-changed");
    expect(errors).toEqual([]);
  });

  test("the report tab is a read-only viewer: draft before any control, live ERP data, exports, no controls", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fresh(page);
    await goTo(page, "report");
    await expect(page.getByTestId("report-view")).toBeVisible();
    await expect(page.getByTestId("report-view")).toHaveAttribute("data-source", "live");
    await expect(page.getByTestId("report-idle-notice")).toContainText("טרם הופעלה");
    await expect(page.getByTestId("report-status")).toContainText("לא הופעלה בקרה");
    await expect(page.getByTestId("report-agent-hint")).toContainText("claude --agent bakara");
    await expect(page.getByTestId("report-headline-eac")).toContainText("48,000,000 ₪");
    await expect(page.getByTestId("report-version")).toContainText("טיוטה");
    await expect(page.getByTestId("report-row-07")).toContainText("2,280,000");
    await expect(page.getByTestId("report-comparison")).toHaveCount(0);
    // nothing in the control is edited from the browser
    await expect(page.getByTestId("report-toggle-trends")).toHaveCount(0);
    await expect(page.getByTestId("report-save-config")).toHaveCount(0);
    await expect(page.getByTestId("report-finalize")).toHaveCount(0);
    await expect(page.getByTestId("chat-input")).toHaveCount(0);
    await shot(page, "03-report-viewer-draft");

    // an ERP edit shows up in the live report's recorded amounts
    await goTo(page, "erp");
    await page.getByTestId("erp-invoice-row-1147").click();
    await moveInvoiceToSheled(page);
    await goTo(page, "report");
    await expect(page.getByTestId("report-view")).toBeVisible();
    await expect(page.getByTestId("report-row-07")).toContainText("2,100,000");
    await expect(page.getByTestId("report-row-02")).toContainText("12,600,000");

    // exports: Word is a real download; PDF goes through the browser print dialog
    const download = page.waitForEvent("download");
    await page.getByTestId("report-export-docx").click();
    expect((await download).suggestedFilename()).toMatch(/\.docx$/);
    const workbook = page.waitForEvent("download");
    await page.getByTestId("report-export-xlsx").click();
    expect((await workbook).suggestedFilename()).toMatch(/\.xlsx$/);
    await page.evaluate(() => {
      (window as unknown as { __printed: boolean }).__printed = false;
      window.print = () => {
        (window as unknown as { __printed: boolean }).__printed = true;
      };
    });
    await page.getByTestId("report-export-pdf").click();
    expect(await page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);

    // source links: a document opens in the viewer, an ERP record opens read-only with its change log
    await page.getByTestId("report-tab-full").click();
    await page.getByTestId("report-source").filter({ hasText: "נספח" }).first().click();
    await expect(page.getByTestId("document-view")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByTestId("report-source").filter({ hasText: "הסכם מסגרת" }).first().click();
    await expect(page.getByTestId("record-modal")).toBeVisible();
    await expect(page.getByTestId("record-modal")).toHaveAttribute("data-record-type", "contract");
    await page.keyboard.press("Escape");

    // persistence across reload, then reset restores the seed
    await page.reload();
    await expect(page.getByTestId("report-view")).toBeVisible();
    await expect(page.getByTestId("report-row-07")).toContainText("2,100,000");
    await goTo(page, "erp"); // the reset lives on the ERP page
    await page.getByTestId("reset-demo").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("erp-app")).toBeVisible();
    await page.getByTestId("erp-invoice-row-1147").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("07 — פיתוח");
    expect(errors).toEqual([]);
  });
});
