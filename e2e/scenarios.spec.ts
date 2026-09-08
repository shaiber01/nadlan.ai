import { expect, test, type Page } from "@playwright/test";

/**
 * Every remaining scenario started from the gallery and completed through the UI:
 * triggers via the in-context scenario buttons, approvals in the reviewer view,
 * client replies in the message center, completion read from the scenario definition.
 */

async function fresh(page: Page) {
  await page.goto("/#/overview");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector(".app-nav");
  await page.getByRole("button", { name: "בקרת הצגה" }).click();
  await page.getByRole("button", { name: "ללא אנימציה" }).click();
  await page.getByRole("button", { name: "בקרת הצגה" }).click();
}

async function setRole(page: Page, role: "manager" | "reviewer") {
  await page.getByRole("button", { name: role === "manager" ? "מנהל החברה" : "צוות הבקרה", exact: true }).click();
}

async function startScenario(page: Page, number: number) {
  await page.goto("/#/scenarios");
  const card = page.locator("section").filter({ has: page.getByText(`${number}`, { exact: true }) }).filter({ has: page.getByRole("button", { name: "התחל תרחיש" }) }).first();
  await card.getByRole("button", { name: "התחל תרחיש" }).click();
  await page.waitForTimeout(300);
}

async function isComplete(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { __bakaraStore: { getSnapshot: () => { state: unknown; scenario: { isComplete: (s: unknown) => boolean } | null } } };
    const snap = w.__bakaraStore.getSnapshot();
    return snap.scenario ? snap.scenario.isComplete(snap.state) : false;
  });
}

async function approveFirst(page: Page, label: string | RegExp) {
  await setRole(page, "reviewer");
  await page.goto("/#/records?tab=proposals");
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForTimeout(300);
}

async function triggerOnBudget(page: Page, code: string, label: string) {
  await page.goto(`/#/budget?project=HAD&code=${code}`);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForTimeout(300);
}

/** Send the first pending question to the client and answer it with the first suggested reply. */
async function answerFirstQuestion(page: Page, cardText: string, replyText?: string) {
  await setRole(page, "reviewer");
  await page.goto("/#/questions?tab=questions");
  await page.waitForTimeout(200);
  await page.locator("section.card").filter({ hasText: cardText }).filter({ has: page.getByRole("button", { name: "אשר והוסף לשאלות המרוכזות" }) }).last().getByRole("button", { name: "אשר והוסף לשאלות המרוכזות" }).click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "שלח בירור מרוכז" }).first().click();
  await page.waitForTimeout(300);
  await setRole(page, "manager");
  await page.goto("/#/questions?tab=messages");
  await page.waitForTimeout(300);
  const box = page.locator("[data-guide='reply-box']");
  if (replyText) await box.locator("textarea").fill(replyText);
  else await box.locator(".chip").first().click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: "שלח תשובה" }).click();
  await page.waitForTimeout(400);
}

test("S02 draft budget assumptions", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 2);
  await page.goto("/#/projects?project=NOF");
  await page.getByRole("button", { name: "טען תקציב לדוגמה" }).click();
  await page.getByRole("button", { name: "קלוט טיוטה בזיו — הדגמה" }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "הצג בדיקת הנחות" }).click();
  await expect(page.locator(".drawer")).toContainText("80,000");
  await expect(page.locator(".drawer")).toContainText("100,000");
  await page.keyboard.press("Escape");
  await expect(page.locator("main")).toContainText("לא נכלל בהשוואה — מפרט ותנאים שונים");
  await setRole(page, "reviewer");
  await page.getByRole("button", { name: "עדכן טיוטה" }).first().click();
  await page.waitForTimeout(300);
  await expect(page.locator("main")).toContainText("5,090,000");
  await page.screenshot({ path: "e2e/screenshots/flow-s02.png" });
  expect(await isComplete(page)).toBe(true);
});

test("S08 signed addendum raises commitments", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 8);
  await triggerOnBudget(page, "H30", "קלוט תוספת להסכם");
  await approveFirst(page, "עדכן התחייבות");
  await page.goto("/#/budget?project=HAD&code=H30");
  await expect(page.locator("main")).toContainText("6,206,000");
  await expect(page.locator("main")).toContainText("900,000");
  expect(await isComplete(page)).toBe(true);
});

test("S09 cumulative certificate corrected to the period amount", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 9);
  await triggerOnBudget(page, "H30", "חשבון קבלן חדש לבדיקה");
  await approveFirst(page, "אשר תיקון");
  await page.goto("/#/budget?project=HAD&code=H30");
  await expect(page.locator("main")).toContainText("700,000");
  await expect(page.locator("main")).toContainText("6,106,000");
  expect(await isComplete(page)).toBe(true);
});

test("S10 unbilled work then the matching invoice", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 10);
  await triggerOnBudget(page, "H50", "קלוט אישור ביצוע ללא חשבונית");
  await approveFirst(page, "אשר הכרה בעבודה שבוצעה");
  await page.goto("/#/budget?project=HAD&code=H50");
  await expect(page.locator("main")).toContainText("180,000");
  await expect(page.locator("main")).toContainText("170,000");
  expect(await isComplete(page)).toBe(true);
  await triggerOnBudget(page, "H50", "הדמה הגעת החשבונית");
  await approveFirst(page, "אשר התאמת חשבונית");
  await page.goto("/#/budget?project=HAD&code=H50");
  await expect(page.locator("main")).toContainText("6,106,000");
});

test("S12 freight charge credited only after the approved credit", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 12);
  await page.goto("/#/overview");
  await expect(page.locator("main")).toContainText("6,108,000");
  await triggerOnBudget(page, "H20", "הדמה קבלת זיכוי");
  await approveFirst(page, "אשר זיכוי");
  await page.goto("/#/overview");
  await expect(page.locator("main")).toContainText("6,106,000");
  expect(await isComplete(page)).toBe(true);
});

test("S13 change order adds a commitment and keeps recovery separate", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 13);
  await triggerOnBudget(page, "H50", "קלוט הוראת שינוי");
  await approveFirst(page, "עדכן התחייבות");
  await page.goto("/#/budget?project=HAD&code=H50");
  await expect(page.locator("main")).toContainText("330,000");
  await expect(page.locator("main")).toContainText("6,186,000");
  await page.getByRole("tab", { name: /החזר מלקוח/ }).click();
  await expect(page.locator("main")).toContainText("ממתין לאישור");
  expect(await isComplete(page)).toBe(true);
});

test("S14 schedule delay through the question and forecast approval", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 14);
  await page.goto("/#/budget?project=HAD&code=H70");
  await page.waitForTimeout(200);
  const form = page.locator("[data-guide='duration-form']");
  await form.locator("input.num").first().fill("14");
  await form.getByRole("button", { name: "שאל את הלקוח על ההארכה" }).click();
  await page.waitForTimeout(300);
  await answerFirstQuestion(page, "מאריך את פעילות האתר");
  await approveFirst(page, "אשר עדכון תחזית");
  await page.goto("/#/budget?project=HAD&code=H70");
  await expect(page.locator("main")).toContainText("700,000");
  await expect(page.locator("main")).toContainText("30/04/2027");
  expect(await isComplete(page)).toBe(true);
});

test("S15 approved rule reused without a new question", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 15);
  await expect(page.locator(".app-header")).toContainText("01/10/2026");
  await page.goto("/#/knowledge");
  await expect(page.locator("main")).toContainText("RULE-EQ-01");
  await triggerOnBudget(page, "H40", "קלוט חשבונית החודש הבא");
  await page.goto("/#/records?tab=findings");
  await expect(page.locator("main")).toContainText("ללא בירור נוסף עם מאיה");
  await approveFirst(page, "אשר תיקון");
  await page.goto("/#/budget?project=HAD&code=H40");
  await expect(page.locator("main")).toContainText("260,000");
  await page.goto("/#/knowledge");
  await page.getByText("RULE-EQ-01").first().click();
  await expect(page.locator("main")).toContainText("שימוש חוזר");
  await page.screenshot({ path: "e2e/screenshots/flow-s15-rule.png" });
  expect(await isComplete(page)).toBe(true);
});

test("S16 opportunity, new quote, reviewed forecast improvement", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 16);
  await page.goto("/#/overview");
  await expect(page.locator("main")).toContainText("6,250,000");
  await triggerOnBudget(page, "H10", "השווה רכישות בפרויקטים");
  await page.goto("/#/records?tab=findings");
  await expect(page.locator("main")).toContainText("192,000");
  await triggerOnBudget(page, "H10", "הדמה קבלת הצעה חדשה");
  await approveFirst(page, "עדכן את התחזית לפי ההצעה");
  await page.goto("/#/budget?project=HAD&code=H10");
  await expect(page.locator("main")).toContainText("6,154,000");
  await expect(page.locator("main")).toContainText("1,554,000");
  expect(await isComplete(page)).toBe(true);
});

test("S06 locked-order branch reduces exposure; scenario restart restores the fixture", async ({ page }) => {
  await fresh(page);
  await startScenario(page, 6);
  await triggerOnBudget(page, "H10", "חלק מהכמות כבר מוזמן במחיר קבוע");
  await approveFirst(page, "עדכן התחייבות");
  await page.goto("/#/questions?tab=alerts");
  await expect(page.locator("main")).toContainText("84,000");
  await page.getByRole("button", { name: "התחל מחדש" }).first().click();
  await page.waitForTimeout(400);
  await page.goto("/#/questions?tab=alerts");
  await expect(page.locator("main")).toContainText("144,000");
  await expect(page.locator("main")).not.toContainText("84,000");
});

test("free exploration is restored after leaving a scenario", async ({ page }) => {
  await fresh(page);
  await page.goto("/#/chat");
  await page.getByRole("button", { name: "כמה נשאר לשלם לקבלן השלד?" }).click();
  await page.waitForTimeout(500);
  await expect(page.locator("[data-guide='chat-answer']")).toContainText("850,000");
  await startScenario(page, 8);
  await page.goto("/#/chat");
  await expect(page.locator("main")).not.toContainText("850,000");
  await page.getByRole("button", { name: "מעבר לחקירה חופשית" }).first().click();
  await page.waitForTimeout(300);
  await page.goto("/#/chat");
  await expect(page.locator("main")).toContainText("850,000");
});
