import { expect, test, type Page } from "@playwright/test";

const routes = ["overview", "projects", "budget?project=HAD&code=H10", "records", "documents", "questions", "reports?project=HAD", "chat", "knowledge", "scenarios"];

async function fresh(page: Page, hash = "#/overview") {
  await page.goto(`/${hash}`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/${hash}`);
  await page.waitForSelector(".app-nav");
}

test.describe("screens render without runtime errors", () => {
  test("every destination", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    await fresh(page);
    for (const r of routes) {
      await page.goto(`/#/${r}`);
      await page.waitForTimeout(400);
      const name = r.split("?")[0];
      await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("overview shows the baseline and the two findings under review", async ({ page }) => {
    await fresh(page);
    await expect(page.locator(".app-nav")).toContainText("סביבת הדגמה");
    await expect(page.locator("main")).toContainText("6,106,000");
    await expect(page.locator("main")).toContainText("15,104,000");
    await expect(page.locator("[data-guide='conditional-panel']")).toContainText("144,000");
  });

  test("mobile viewport renders the WhatsApp thread", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fresh(page, "#/questions?tab=messages");
    await page.waitForTimeout(400);
    await page.screenshot({ path: "e2e/screenshots/mobile-messages.png", fullPage: true });
  });
});
