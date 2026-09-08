import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_PROJECT_ID, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../src/hadarim/db/config";

/**
 * Online mode against the shared Supabase project: the ERP edit made in the browser lands in the
 * database with a trigger-written change-log row, and "reset" restores the seed. Opt-in, because it
 * mutates shared data:  RUN_DB_E2E=1 npx playwright test e2e/hadarim.db.spec.ts
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
  await page.getByTestId("skip-motion").check();
}

test.describe("Hadarim online mode (shared database)", () => {
  test.skip(!enabled, "set RUN_DB_E2E=1 to run against the live project");

  test("the scene-1 edit is written to the database and reset restores the seed", async ({ page }) => {
    test.setTimeout(90_000);
    await online(page);
    // reset first so the run starts from the seed
    await page.getByTestId("reset-demo").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("db-status")).toContainText("מחובר", { timeout: 20_000 });
    expect(await invoiceSection(1147)).toBe("07");

    await page.getByTestId("erp-invoice-row-1147").click();
    await page.getByTestId("erp-invoice-edit").click();
    await page.getByTestId("erp-invoice-by").selectOption("SARIT");
    await page.getByTestId("erp-invoice-section").selectOption("02");
    await page.getByTestId("erp-invoice-save").click();
    await expect(page.getByTestId("erp-invoice-view")).toContainText("02 — שלד");
    await expect.poll(() => invoiceSection(1147), { timeout: 15_000 }).toBe("02");
    const log = await changeLogFor(1147);
    expect(log.at(-1)).toMatchObject({ field: "סעיף תקציבי", before: "07-פיתוח", after: "02-שלד", by_id: "SARIT" });
    // the trigger's row (not a browser-made one) is what the screen shows after the re-read
    await expect(page.getByTestId("erp-changelog-row").first()).toContainText("02-שלד");

    // the control reads the database state: four findings, one on the record changed today
    await page.getByTestId("go-control").click();
    await page.getByTestId("control-start").click();
    await expect(page.getByTestId("chat-message").filter({ hasText: "נמצאו 4 ממצאים" })).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("reset-demo").click();
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("db-status")).toContainText("מחובר", { timeout: 20_000 });
    await expect.poll(() => invoiceSection(1147), { timeout: 15_000 }).toBe("07");
    expect((await changeLogFor(1147)).length).toBe(1);
  });
});
