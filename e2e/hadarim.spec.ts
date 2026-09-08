import { expect, test, type Page } from "@playwright/test";

/**
 * Hadarim v2: the whole demo script end to end (hadarimdemoscript.md scenes 1–9) through the real UI,
 * plus persistence, reset, exports and the clean-data trap.
 */

async function fresh(page: Page) {
  await page.goto("/hadarim.html");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("hadarim-offline", "1"); // e2e runs on the browser-only generator data, never the shared database
  });
  await page.reload();
  await page.getByTestId("presenter-bar").waitFor();
  await page.getByTestId("skip-motion").check();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/hadarim-${name}.png`, fullPage: false });
}

async function say(page: Page, text: string) {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
}

async function lastMessage(page: Page) {
  return page.getByTestId("chat-message").last();
}

async function option(page: Page, id: string) {
  const button = page.getByTestId(`chat-option-${id}`).last();
  await button.waitFor();
  await button.click();
}

test.describe("Hadarim v2 — the scripted demo", () => {
  test("scene 1 (variant A): the bookkeeper moves invoice 1147 to שלד in the ERP", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fresh(page);
    await expect(page.getByTestId("go-erp")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("erp-invoice-row-1147").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("07 — פיתוח");
    await shot(page, "01-invoice-1147");
    await page.getByTestId("erp-invoice-edit").click();
    await page.getByTestId("erp-invoice-by").selectOption("SARIT");
    await page.getByTestId("erp-invoice-section").selectOption("02");
    await page.getByTestId("erp-invoice-save").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("שלד");
    await shot(page, "02-invoice-1147-changed");
    expect(errors).toEqual([]);
  });

  test("scenes 2–9: control, four decisions, living report, configuration, questions", async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fresh(page);
    // scene 1
    await page.getByTestId("erp-invoice-row-1147").click();
    await page.getByTestId("erp-invoice-edit").click();
    await page.getByTestId("erp-invoice-by").selectOption("SARIT");
    await page.getByTestId("erp-invoice-section").selectOption("02");
    await page.getByTestId("erp-invoice-save").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");

    // scene 2: request the control
    await page.getByTestId("go-control").click();
    await expect(page.getByTestId("control-app")).toBeVisible();
    await expect(page.getByTestId("control-headline")).toContainText("48,000,000 ₪");
    await say(page, "תכיני בקרה תקציבית להדרים");
    await expect(page.getByTestId("chat-message").filter({ hasText: "נמצאו 4 ממצאים" })).toBeVisible();
    await expect(page.getByTestId("chat-message").filter({ hasText: "ששונתה היום" })).toBeVisible();
    await shot(page, "03-control-ready");
    await option(page, "review");

    // scene 3: allocation → yes → update in the ERP
    const allocation = page.getByTestId("finding-card").filter({ hasText: "1147" }).last();
    await expect(allocation).toContainText("הבעיה");
    await expect(allocation).toContainText("אינו קבלן משנה מאושר");
    await shot(page, "04-finding-allocation");
    await option(page, "yes_target");
    await option(page, "update");
    await expect(page.getByTestId("chat-message").filter({ hasText: "נקרא מחדש" }).last()).toBeVisible();
    await expect(page.getByTestId("chat-message").filter({ hasText: "תיעוד: חשבון 1147" }).last()).toBeVisible();

    // scene 4: unit → yes 12 tons → refer to Roi
    await expect(page.getByTestId("finding-card").filter({ hasText: "2291" }).last()).toContainText("57,600 ₪");
    await shot(page, "05-finding-unit");
    await option(page, "yes_tons");
    await option(page, "refer_roi");
    await expect(page.getByTestId("chat-message").filter({ hasText: "נשלח לרועי" }).last()).toBeVisible();

    // scene 5: price → all remaining tons
    await expect(page.getByTestId("finding-card").filter({ hasText: "4,800" }).last()).toContainText("240,000");
    await shot(page, "06-finding-price");
    await option(page, "all");
    await expect(page.getByTestId("control-headline")).toContainText("48,240,000 ₪");

    // scene 5b: coverage → free text → quote from the folder → estimate
    const coverage = page.getByTestId("finding-card").filter({ hasText: "ניקוז" }).last();
    await expect(coverage).toContainText("3.4");
    await shot(page, "07-finding-coverage");
    await coverage.getByTestId("finding-free-text").fill("צריך להזמין. יש הצעה בתיקייה");
    await coverage.getByTestId("finding-free-send").click();
    await expect(page.getByTestId("chat-message").filter({ hasText: "י. כהן" }).last()).toBeVisible();
    await option(page, "accept");
    await expect(page.getByTestId("control-headline")).toContainText("48,360,000 ₪");
    await expect(page.getByTestId("chat-message").filter({ hasText: "הדוח מוכן" }).last()).toBeVisible();
    await shot(page, "08-all-decided");

    // scene 6: the report
    await option(page, "open");
    await expect(page.getByTestId("report-view")).toBeVisible();
    await expect(page.getByTestId("report-headline-eac")).toContainText("48,360,000 ₪");
    await expect(page.getByTestId("report-version")).toContainText("טיוטה");
    await expect(page.getByTestId("report-section-4a")).toContainText("240,000");
    await expect(page.getByTestId("report-section-4a")).toContainText("120,000");
    await expect(page.getByTestId("report-section-4b")).toContainText("1147");
    await expect(page.getByTestId("report-row-03")).toContainText("3,240,000");
    await expect(page.getByTestId("report-row-07")).toContainText("3,320,000");
    await expect(page.getByTestId("report-section-9")).toContainText("איטום");
    await expect(page.getByTestId("report-comparison")).toHaveCount(0);
    await shot(page, "09-report");

    // scene 7: three live changes
    await page.getByTestId("control-back-to-chat").click();
    await say(page, "תוסיפי השוואה לבקרה הקודמת ומגמות");
    await option(page, "open");
    await expect(page.getByTestId("report-comparison")).toContainText("48.36");
    await shot(page, "10-report-comparison");
    await page.getByTestId("control-back-to-chat").click();
    await say(page, "תציגי את הטבלה לפי בניין");
    await option(page, "open");
    await expect(page.getByTestId("report-by-building")).toContainText("משותף");
    await shot(page, "11-report-by-building");
    await page.getByTestId("control-back-to-chat").click();
    // scene 7, change 2: the "[שנה]" affordance tags invoice 1147 with a building and the split follows
    await option(page, "open");
    await page.getByTestId("report-building-change-1147-A").click();
    await expect(page.getByTestId("report-by-building-note")).toContainText("שויך לבניין A");
    await page.getByTestId("control-back-to-chat").click();
    await say(page, "תכיני גרסה לדנה — עמוד אחד");
    // scene 7, change 3: the message carries the exports and the hand-off; scene 8: the full save prompt
    await expect(page.getByTestId("chat-option-send_dana").last()).toBeVisible();
    await expect(page.getByTestId("chat-message").filter({ hasText: "מה יישמר" }).last()).toBeVisible();
    await page.getByTestId("chat-option-send_dana").last().click();
    await expect(page.getByTestId("chat-message").filter({ hasText: "נשלח לדנה" }).last()).toBeVisible();
    const chatDownload = page.waitForEvent("download");
    await page.getByTestId("chat-option-export_docx").last().click();
    expect((await chatDownload).suggestedFilename()).toMatch(/\.docx$/);
    await expect(page.getByTestId("report-view")).toBeVisible();
    await page.getByTestId("report-tab-ceo").click();
    await expect(page.getByTestId("report-view")).toContainText("אותם מספרים");
    await shot(page, "12-report-ceo");
    await page.getByTestId("report-tab-full").click();
    await expect(page.getByTestId("report-material-02")).toBeVisible();
    await expect(page.getByTestId("report-material-12")).toContainText("בסיס 0%");

    // scene 8: save the configuration
    await page.getByTestId("report-save-config").click();
    await expect(page.getByTestId("report-view")).toContainText("תצורת בקרה — הדרים");

    // exports: Word is a real download; PDF goes through the browser print dialog
    const download = page.waitForEvent("download");
    await page.getByTestId("report-export-docx").click();
    expect((await download).suggestedFilename()).toMatch(/\.docx$/);
    await page.evaluate(() => {
      (window as unknown as { __printed: boolean }).__printed = false;
      window.print = () => {
        (window as unknown as { __printed: boolean }).__printed = true;
      };
    });
    await page.getByTestId("report-export-pdf").click();
    expect(await page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);

    // scene 9: questions
    await page.getByTestId("control-back-to-chat").click();
    await say(page, "אז החריגה בברזל נובעת מזה שקנינו יותר?");
    await expect(await lastMessage(page)).toContainText("300 × 4,000");
    await say(page, "אילו נושאים מהבקרה הקודמת כבר נסגרו?");
    await expect(await lastMessage(page)).toContainText("נסגרו 2 מתוך 3");
    await say(page, "למה פיתוח עלה ביותר מ-120 אלף?");
    await expect(await lastMessage(page)).toContainText("180,000");
    await shot(page, "13-questions");

    // the ERP shows the corrected invoice and the audit trail
    await page.getByTestId("go-erp").click();
    await page.getByTestId("erp-nav-change_log").click();
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("1147");
    await page.getByTestId("erp-nav-invoices").click();
    await page.getByTestId("erp-invoice-row-1147").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("07 — פיתוח");

    // persistence across reload, then reset
    await page.reload();
    await page.getByTestId("go-control").click();
    await expect(page.getByTestId("control-headline")).toContainText("48,360,000 ₪");
    await page.getByTestId("reset-demo").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("go-erp")).toHaveAttribute("aria-selected", "true");
    await page.getByTestId("erp-invoice-row-1147").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("07 — פיתוח");
    expect(errors).toEqual([]);
  });

  test("clean data: three findings, no allocation trap", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("go-control").click();
    await say(page, "תכיני בקרה תקציבית להדרים");
    await expect(page.getByTestId("chat-message").filter({ hasText: "נמצאו 3 ממצאים" })).toBeVisible();
    await expect(page.getByTestId("chat-message").filter({ hasText: "ששונתה היום" })).toHaveCount(0);
  });

  test("progressive steps play without the skip flag and can be skipped", async ({ page }) => {
    await fresh(page);
    await page.getByTestId("skip-motion").uncheck();
    await page.getByTestId("go-control").click();
    await say(page, "תכיני בקרה תקציבית להדרים");
    await page.getByTestId("steps-skip").click();
    await expect(page.getByTestId("chat-message").filter({ hasText: "נמצאו 3 ממצאים" })).toBeVisible();
    await expect(page.getByTestId("chat-option-review").last()).toBeVisible();
  });
});
