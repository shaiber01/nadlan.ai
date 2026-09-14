/**
 * Renders the report version that ships with the seed — the previous control's final report — into
 * src/hadarim/data/report-versions.json, so `npm run hadarim:seed` inserts it and `reset_project` restores it.
 *
 * The report is built by the engine from the package as that control saw it (`packageAsOf`): the ERP without
 * the records keyed in since, the folder without the later documents, the price appendices in force then. Nothing
 * is typed in; when the generator changes, run this again and re-seed.
 *
 *   npm run hadarim:seed-report
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUGUST_CONTROL, generateHadarimPackage, packageAsOf } from "../src/hadarim/data/generate";
import { finalizeControl, initialState, reviewFindings, revealAllSteps, setPackage, startControl } from "../src/hadarim/engine/commands";
import { recordReviewPass } from "../src/hadarim/engine/operations";
import { buildReport } from "../src/hadarim/engine/report";

const { controlDate, savedBy, savedAt, pulledAt, project, reviewPassHe } = AUGUST_CONTROL;
const pkg = packageAsOf(generateHadarimPackage(), controlDate, project);
setPackage(pkg);

let state = { ...initialState(), clock: pulledAt, operatorId: savedBy };
state = reviewFindings(revealAllSteps(startControl(state, "תכיני בקרה תקציבית")));
if (state.control.findings.length) throw new Error(`the ${controlDate} control is expected to be clean; it raised ${state.control.findings.map((f) => f.kind).join(", ")}`);
[state] = recordReviewPass(state, reviewPassHe, savedBy);
state = finalizeControl(state);

const model = buildReport(pkg, state);
const month = `${controlDate.slice(5, 7)}/${controlDate.slice(0, 4)}`;
const versions = [{ controlDate, label: `בקרה ${month}`, createdBy: savedBy, createdAt: savedAt, model }];
const out = resolve(__dirname, "../src/hadarim/data/report-versions.json");
writeFileSync(out, JSON.stringify(versions, null, 2) + "\n");
console.log(`${out}: ${versions[0].label} — ${model.header.controlLabelHe}, EAC ${model.sections.totals.eac.toLocaleString("en-US")}, ${model.material.length} material sections, ${model.issues.open.length} open issues`);
