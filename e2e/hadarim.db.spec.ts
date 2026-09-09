import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_PROJECT_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/hadarim/db/config";

/**
 * Online mode against the shared Supabase project — the whole prototype loop: the scene-1 edit made in
 * the browser lands in the database with a trigger-written change-log row; the agent's tools run the
 * control (e2e/fixtures/run-demo-control.ts, the same registry the MCP server exposes); the browser's
 * report tab shows the finished control live and the saved version; reset restores the seed. Also takes
 * the element screenshots of the report sections (e2e/screenshots/hadarim-v-*.png).
 * Opt-in, because it mutates shared data:  RUN_DB_E2E=1 npx playwright test e2e/hadarim.db.spec.ts
 */
const enabled = process.env.RUN_DB_E2E === "1";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });

async function invoiceSection(id: number): Promise<string> {
  const { data, error } = await supabase.from("invoices").select("section_id").eq("project_id", DEFAULT_PROJECT_ID).eq("id", id).single();
  if (error) throw error;
  return (data as { section_id: string }).section_id;
}

async function changeLogFor(id: number): Promise<{ field: string; before: string; after: string; by_id: string }[]> {
  const { data, error } = await supabase.from("change_log").select("field, before, after, by_id").eq("project_id", DEFAULT_PROJECT_ID).eq("record_id", String(id)).order("at");
  if (error) throw error;
  return data as { field: string; before: string; after: string; by_id: string }[];
}

async function online(page: Page) {
  await page.goto("/hadarim.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("presenter-bar").waitFor();
  await expect(page.getByTestId("db-status")).toContainText("מחובר", { timeout: 20_000 });
}

async function resetFromUi(page: Page) {
  // the reset lives on the ERP page
  await page.goto("/hadarim.html");
  await page.getByTestId("presenter-bar").waitFor();
  await expect(page.getByTestId("db-status")).toContainText("מחובר", { timeout: 20_000 });
  await page.getByTestId("reset-demo").click();
  await page.getByTestId("reset-confirm").click();
  await expect(page.getByTestId("db-status")).toContainText("מחובר", { timeout: 20_000 });
}

async function elementShot(page: Page, testId: string, name: string) {
  const el = page.getByTestId(testId).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: `e2e/screenshots/hadarim-v-${name}.png` });
}

test.describe("Hadarim online mode (shared database)", () => {
  test.skip(!enabled, "set RUN_DB_E2E=1 to run against the live project");

  test("ERP edit → the agent's tools run the control → the report viewer shows it live and as a saved version → reset", async ({ page }) => {
    test.setTimeout(300_000);
    await online(page);
    await resetFromUi(page);
    expect(await invoiceSection(1147)).toBe("07");

    // scene 1 in the browser: written to the database, logged by the trigger
    await page.getByTestId("erp-invoice-row-1147").click();
    await page.getByTestId("erp-invoice-edit").click();
    await page.getByTestId("erp-invoice-by").selectOption("SARIT");
    await page.getByTestId("erp-invoice-section").selectOption("02");
    await page.getByTestId("erp-invoice-save").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");
    await expect.poll(() => invoiceSection(1147), { timeout: 15_000 }).toBe("02");
    expect((await changeLogFor(1147)).at(-1)).toMatchObject({ field: "סעיף תקציבי", before: "07-פיתוח", after: "02-שלד", by_id: "SARIT" });
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("02-שלד");

    // the report tab before the control: draft, live data
    await page.goto("/report.html");
    await expect(page.getByTestId("report-idle-notice")).toBeVisible();
    await expect(page.getByTestId("report-headline-eac")).toContainText("48,000,000 ₪");

    // scenes 2–8 through the agent's tools (what the MCP server runs for the agent)
    const out = execFileSync("npx", ["vite-node", "e2e/fixtures/run-demo-control.ts"], { cwd: process.cwd(), encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "inherit"] });
    const result = JSON.parse(out.trim().split("\n").at(-1)!) as { summaryHe: string; versionId: number; paragraphHe: string };
    expect(result.summaryHe).toContain("נמצאו 4 ממצאים");
    expect(result.paragraphHe).toContain("48.36");

    // the viewer follows the database (Realtime; reload as a fallback so the assertion is about the data, not the channel)
    try {
      await expect(page.getByTestId("report-headline-eac")).toContainText("48,360,000 ₪", { timeout: 30_000 });
    } catch {
      await page.reload();
      await expect(page.getByTestId("db-status")).toContainText("מחובר", { timeout: 20_000 });
      await expect(page.getByTestId("report-headline-eac")).toContainText("48,360,000 ₪", { timeout: 20_000 });
    }
    await expect(page.getByTestId("report-idle-notice")).toHaveCount(0);
    await expect(page.getByTestId("report-status")).toContainText("כל הממצאים טופלו");
    await expect(page.getByTestId("report-section-4a")).toContainText("240,000");
    await expect(page.getByTestId("report-section-4a")).toContainText("120,000");
    await expect(page.getByTestId("report-section-4b")).toContainText("1147");
    await expect(page.getByTestId("report-row-03")).toContainText("3,240,000");
    await expect(page.getByTestId("report-row-07")).toContainText("3,320,000");
    await expect(page.getByTestId("report-comparison")).toContainText("48.36");
    await expect(page.getByTestId("report-by-building")).toContainText("משותף");

    // the visual tour of the report sections, for presenter review
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

    // the saved version the agent stored is listed and can be opened next to the live report
    const select = page.getByTestId("report-version-select");
    await expect(select.locator("option", { hasText: "בקרה 09/2026 — e2e" })).toHaveCount(1, { timeout: 20_000 });
    await select.selectOption(String(result.versionId));
    await expect(page.getByTestId("report-view")).toHaveAttribute("data-source", "saved");
    await expect(page.getByTestId("report-saved-notice")).toContainText(`#${result.versionId}`);
    await expect(page.getByTestId("report-headline-eac")).toContainText("48,360,000 ₪");
    await select.selectOption("");
    await expect(page.getByTestId("report-view")).toHaveAttribute("data-source", "live");

    // reset restores the seed: ERP row, change log, and an idle control
    await resetFromUi(page);
    await expect.poll(() => invoiceSection(1147), { timeout: 15_000 }).toBe("07");
    expect((await changeLogFor(1147)).length).toBe(1);
    await page.goto("/report.html");
    await expect(page.getByTestId("report-idle-notice")).toBeVisible({ timeout: 20_000 });
  });
});
