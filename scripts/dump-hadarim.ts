/**
 * Writes the generated Hadarim package to data/hadarim/ as JSON and CSV for inspection and diffing.
 * Run: npm run hadarim:dump   (uses vite-node, shipped with vitest)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateHadarimPackage } from "../src/hadarim/data/generate";

const pkg = generateHadarimPackage();
const dir = join(process.cwd(), "data", "hadarim");
mkdirSync(dir, { recursive: true });

function csv<T extends object>(rows: T[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return ["﻿" + keys.join(","), ...rows.map((r) => keys.map((k) => esc((r as Record<string, unknown>)[k])).join(","))].join("\n");
}

writeFileSync(join(dir, "project.json"), JSON.stringify(pkg.project, null, 2));
writeFileSync(join(dir, "people.json"), JSON.stringify(pkg.people, null, 2));
writeFileSync(join(dir, "suppliers.csv"), csv(pkg.suppliers));
writeFileSync(join(dir, "sections.csv"), csv(pkg.sections.map((s) => ({ ...s, contractIds: s.contractIds.join("|") }))));
writeFileSync(join(dir, "contracts.json"), JSON.stringify(pkg.contracts, null, 2));
writeFileSync(join(dir, "invoices.csv"), csv(pkg.invoices));
writeFileSync(join(dir, "purchase_orders.csv"), csv(pkg.purchaseOrders));
writeFileSync(join(dir, "boq.csv"), csv(pkg.boq));
writeFileSync(join(dir, "change_log.csv"), csv(pkg.changeLog));
for (const f of pkg.forecasts) writeFileSync(join(dir, `forecast_${f.controlDate}.json`), JSON.stringify(f, null, 2));
writeFileSync(join(dir, "documents.json"), JSON.stringify(pkg.documents, null, 2));

const totals = pkg.sections.map((s) => ({ section: s.id, budget: s.budget, recorded: pkg.invoices.filter((i) => i.sectionId === s.id && i.status !== "בבדיקה").reduce((a, i) => a + i.amount, 0) }));
console.log(`invoices=${pkg.invoices.length} purchaseOrders=${pkg.purchaseOrders.length} boq=${pkg.boq.length} recorded=${totals.reduce((a, t) => a + t.recorded, 0).toLocaleString("en-US")}`);
