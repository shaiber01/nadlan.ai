import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end review of the primary paths through the real UI (Section 14.3):
 * the guided tour S04 -> S06 -> S07 -> S01, S05 valid/invalid replies, S03 failed write/retry,
 * S11 single immutable invoice, and fixture isolation between independent scenarios.
 */

async function fresh(page: Page) {
  await page.goto("/#/overview");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app-nav");
  // skip the simulated analysis delay to keep the run deterministic
  await page.getByRole("button", { name: "בקרת הצגה" }).click();
  await page.getByRole("button", { name: "ללא אנימציה" }).click();
  await page.getByRole("button", { name: "בקרת הצגה" }).click();
}

async function setRole(page: Page, role: "manager" | "reviewer") {
  await page.getByRole("button", { name: role === "manager" ? "מנהל החברה" : "צוות הבקרה", exact: true }).click();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/flow-${name}.png`, fullPage: false });
}

async function startScenario(page: Page, number: number) {
  await page.goto("/#/scenarios");
  const card = page.locator("section").filter({ has: page.getByText(`${number}`, { exact: true }) }).filter({ has: page.getByRole("button", { name: "התחל תרחיש" }) }).first();
  await card.getByRole("button", { name: "התחל תרחיש" }).click();
  await page.waitForTimeout(300);
}

test.describe("guided path S04 -> S06 -> S07 -> S01", () => {
  test("carries one state through the tour", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fresh(page);
    await page.getByRole("button", { name: "נסה הדגמה מודרכת" }).first().click();
    await expect(page.locator(".guide")).toContainText("תרחיש 4");
    await shot(page, "s04-start");

    // S04: save the erroneous record via the scenario trigger, then approve as reviewer
    await page.goto("/#/records?tab=erp&record=TX-H-STEEL");
    await page.locator(".drawer").getByRole("button", { name: /שמור תנועה/ }).first().click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.goto("/#/records?tab=findings");
    await page.waitForTimeout(200);
    await expect(page.locator("[data-guide='finding-list']")).toContainText("בזיו נרשמו 200 טון");
    await shot(page, "s04-finding");
    await setRole(page, "reviewer");
    await page.goto("/#/records?tab=proposals");
    await page.getByRole("button", { name: "אשר תיקון" }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "הכול", exact: true }).first().click();
    await expect(page.locator("main")).toContainText("עודכן בזיו — סביבת הדגמה");
    await shot(page, "s04-applied");
    await page.goto("/#/budget?project=HAD&code=H10");
    await expect(page.locator("main")).toContainText("20 / 500");
    await expect(page.locator("main")).toContainText("6,106,000");

    // S06 continues on the same state: release the alert, answer as OPS, approve the forecast
    await page.getByRole("button", { name: "המשך לתרחיש הבא" }).click();
    await expect(page.locator(".guide")).toContainText("תרחיש 6");
    await page.goto("/#/questions?tab=alerts");
    await expect(page.locator("main")).toContainText("144,000");
    await page.getByRole("button", { name: "אשר ושחרר התרעה" }).first().click();
    await page.waitForTimeout(300);
    await page.goto("/#/reports?project=HAD");
    await expect(page.locator("main")).not.toContainText("RPT-HAD-2026-09-07");
    await setRole(page, "manager");
    await page.goto("/#/questions?tab=messages");
    await expect(page.locator("main")).toContainText("נרכשו רק 20 מתוך 500 טון");
    await shot(page, "s06-alert-whatsapp");
    // open the OPS clarification thread and reply with the suggested answer
    await page.getByText("בירורים — מאיה לוי").first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "זה המחיר הצפוי גם בהמשך" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "שלח תשובה" }).click();
    await page.waitForTimeout(400);
    await expect(page.locator("main")).toContainText("הועברה לבדיקת צוות הבקרה");
    await setRole(page, "reviewer");
    await page.goto("/#/records?tab=proposals");
    await page.getByRole("button", { name: "אשר עדכון תחזית" }).first().click();
    await page.waitForTimeout(300);
    await page.goto("/#/budget?project=HAD&code=H10");
    await expect(page.locator("main")).toContainText("6,250,000");
    await expect(page.locator("main")).toContainText("1,650,000");
    await shot(page, "s06-accepted");

    // S07: what changed since the last report -> +150,000 vs 31/08
    await page.getByRole("button", { name: "המשך לתרחיש הבא" }).click();
    await expect(page.locator(".guide")).toContainText("תרחיש 7");
    await page.goto("/#/chat");
    await page.getByRole("button", { name: "מה השתנה מאז הדוח האחרון?" }).click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-guide='chat-answer']")).toContainText("150,000");
    await expect(page.locator("[data-guide='chat-answer']")).toContainText("RPT-HAD-2026-08-31");
    await page.getByRole("button", { name: "כמה צפוי לעלות הברזל בסוף?" }).click();
    await page.waitForTimeout(500);
    await expect(page.locator("[data-guide='chat-answer']")).toContainText("1,650,000");
    await shot(page, "s07-answer");

    // S01: generate, approve and deliver; the message says 6,250,000
    await page.getByRole("button", { name: "המשך לתרחיש הבא" }).click();
    await expect(page.locator(".guide")).toContainText("תרחיש 1");
    await page.goto("/#/reports?project=HAD");
    await page.getByRole("button", { name: "WhatsApp", exact: true }).first().click();
    await page.getByRole("button", { name: "הפק דוח עכשיו" }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "אשר והעבר ללקוח" }).first().click();
    await page.waitForTimeout(300);
    await page.goto("/#/questions?tab=messages");
    await expect(page.locator("main")).toContainText("תחזית העלות לסיום היא 6,250,000 ₪");
    await shot(page, "s01-delivered");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /הורד/ }).first().click()]);
    expect(download.suggestedFilename()).toMatch(/דוח_בקרה_מגורי_הדרים_2026-09-07\.xlsx/);
    await page.goto("/#/reports?project=HAD");
    await expect(page.locator("main")).toContainText("RPT-HAD-2026-09-07-v01");
    await page.getByRole("button", { name: "התקדם שבוע" }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator("main")).toContainText("2026-09-14");
    expect(errors).toEqual([]);
  });
});

test.describe("S05 replies", () => {
  test("rejects an invalid split and applies a valid one", async ({ page }) => {
    await fresh(page);
    await startScenario(page, 5);
    await setRole(page, "reviewer");
    await page.goto("/#/questions?tab=questions");
    await page.locator("section.card").filter({ hasText: "INV-EQ-001" }).filter({ has: page.getByRole("button", { name: "אשר והוסף לשאלות המרוכזות" }) }).last().getByRole("button", { name: "אשר והוסף לשאלות המרוכזות" }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "שלח בירור מרוכז" }).first().click();
    await page.waitForTimeout(300);
    await setRole(page, "manager");
    await page.goto("/#/questions?tab=messages");
    await page.waitForTimeout(300);
    await expect(page.locator("main")).toContainText("ריכזנו שאלה אחת שלא נפתרה מהמסמכים");
    const box = page.locator("[data-guide='reply-box'] textarea");
    await box.fill("45,000 למגורי הדרים ו-20,000 למתחם הפארק");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "שלח תשובה" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("main")).toContainText("החלוקה מסתכמת ב-65,000 ₪");
    await shot(page, "s05-invalid");
    await box.fill("40,000 ₪ למגורי הדרים ו-20,000 ₪ למתחם הפארק");
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: "שלח תשובה" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("main")).toContainText("הועברה לבדיקת צוות הבקרה");
    await setRole(page, "reviewer");
    await page.goto("/#/records?tab=proposals");
    await page.getByRole("button", { name: "אשר תיקון" }).first().click();
    await page.waitForTimeout(300);
    await page.goto("/#/overview");
    await expect(page.locator("main")).toContainText("6,086,000");
    await expect(page.locator("main")).toContainText("4,018,000");
    await expect(page.locator("main")).toContainText("15,104,000");
    await shot(page, "s05-applied");
  });
});

test.describe("S03 failed write and fixture isolation", () => {
  test("retry applies once; S09 after S03 sees its own fixture", async ({ page }) => {
    await fresh(page);
    await startScenario(page, 3);
    await page.goto("/#/records?tab=erp&record=TX-H-STEEL");
    await page.locator(".drawer").getByRole("button", { name: /קלוט מחדש/ }).first().click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await setRole(page, "reviewer");
    await page.goto("/#/records?tab=proposals");
    await page.getByRole("button", { name: "הדמה כשל בעדכון" }).first().click();
    await page.getByRole("button", { name: "אשר תיקון" }).first().click();
    await page.waitForTimeout(300);
    await expect(page.locator("main")).toContainText("העדכון לא הושלם; הנתונים בזיו לא שונו");
    await shot(page, "s03-failed");
    await page.getByRole("button", { name: "נסה שוב" }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "הכול", exact: true }).first().click();
    await expect(page.locator("main")).toContainText("עודכן בזיו — סביבת הדגמה");
    await page.goto("/#/budget?project=HAD&code=H10");
    await expect(page.locator("main")).toContainText("1,506,000");

    await startScenario(page, 9);
    await page.goto("/#/budget?project=HAD&code=H30");
    await expect(page.locator("main")).toContainText("220,000");
    await expect(page.locator("main")).toContainText("780,000");
    await page.getByRole("button", { name: "חשבון קבלן חדש לבדיקה" }).click();
    await page.waitForTimeout(300);
    await expect(page.locator("main")).toContainText("520,000");
    await page.goto("/#/documents");
    await expect(page.locator("main")).not.toContainText("INV-H-STEEL-001-AMBIG");
    await shot(page, "s09-raw");
  });

  test("S11 keeps a single immutable invoice and corrects only the ERP entry", async ({ page }) => {
    await fresh(page);
    await startScenario(page, 11);
    await page.goto("/#/budget?project=HAD&code=H20");
    await page.getByRole("button", { name: "קלוט אספקת בטון לתקרה A" }).click();
    await page.waitForTimeout(300);
    await setRole(page, "reviewer");
    await page.goto("/#/records?tab=findings");
    await expect(page.locator("main")).toContainText("48,000");
    await expect(page.locator("main")).toContainText("120 מ״ק");
    await page.goto("/#/records?tab=proposals");
    await page.getByRole("button", { name: "אשר תיקון" }).first().click();
    await page.waitForTimeout(300);
    await page.goto("/#/budget?project=HAD&code=H20");
    await expect(page.locator("main")).toContainText("408,000");
    await expect(page.locator("main")).toContainText("6,114,000");
    await page.goto("/#/documents?q=INV-H-SLAB-120");
    await expect(page.locator("main")).toContainText("INV-H-SLAB-120");
    await page.getByText("INV-H-SLAB-120").first().click();
    await expect(page.locator(".drawer")).toContainText("120 מ״ק × 400 ₪ = 48,000 ₪");
    await shot(page, "s11-invoice");
  });
});
