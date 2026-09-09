import { useEffect, useMemo, useState } from "react";
import { store, useUi } from "../../app/store";
import type { Coverage, HBoqLine } from "../../data/types";
import { boqPageFor } from "../../engine/checks";
import { pkg } from "../../engine/commands";
import { dateHe, num, sectionShort } from "./format";

const COVERAGE_HE: Record<Coverage, string> = { covered: "מכוסה בחוזה", excluded: "מוחרג מהחוזה", not_contracted: "טרם נחתם חוזה" };
const COVERAGE_TONE: Record<Coverage, string> = { covered: "ok", excluded: "warn", not_contracted: "done" };

/**
 * The ERP's bill of quantities: the contractor's design quantity list by Blue Book chapter (not a tender BOQ),
 * read-only. Every line shows the budget section it lands in and its contract coverage — the contract that
 * covers it, or the exclusion clause that leaves it open — so a "coverage gap" finding can be read against the
 * line itself. A line can be addressed by URL (`?screen=boq&line=57.03.040`); a section deep link pre-filters.
 */
export function BoqScreen() {
  const ui = useUi();
  const target = ui.erp.boqLineId;
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState("");
  const [section, setSection] = useState<string>(ui.erp.sectionId ?? "");
  const [coverage, setCoverage] = useState<string>("");

  const all = useMemo(() => [...pkg.boq].sort((a, b) => a.id.localeCompare(b.id)), []);
  const chapters = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of all) if (!seen.has(l.chapter)) seen.set(l.chapter, l.chapterNameHe);
    return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [all]);
  const rows = useMemo(() => {
    const q = search.trim();
    return all.filter((l) => (!chapter || l.chapter === chapter) && (!section || l.sectionId === section) && (!coverage || l.coverage === coverage)).filter((l) => !q || l.id.includes(q) || l.descriptionHe.includes(q) || (l.coverageRef ?? "").includes(q));
  }, [all, search, chapter, section, coverage]);
  const groups = useMemo(() => {
    const map = new Map<string, HBoqLine[]>();
    for (const l of rows) map.set(l.chapter, [...(map.get(l.chapter) ?? []), l]);
    return [...map.entries()];
  }, [rows]);
  const count = (lines: HBoqLine[], c: Coverage) => lines.filter((l) => l.coverage === c).length;

  // a line addressed by URL (the report's source link) is highlighted and scrolled into view once the list renders
  useEffect(() => {
    if (!target) return;
    document.querySelector(`[data-boq-line="${CSS.escape(target)}"]`)?.scrollIntoView({ block: "center" });
  }, [target]);

  const openContract = (contractId: string) => store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "contracts", contractId } }));

  return (
    <div className="erp-screen" data-testid="erp-boq">
      <div className="erp-screen-head">
        <h2>כתב כמויות — {pkg.project.nameHe}</h2>
        <div className="erp-actions">
          <span className="erp-count" data-testid="erp-boq-version">
            גרסה {pkg.project.boqVersion.number} ({dateHe(pkg.project.boqVersion.date)}) · {num(all.length)} שורות · {num(chapters.length)} פרקים
          </span>
        </div>
      </div>
      <div className="erp-notice">
        רשימת כמויות תכנון של הקבלן לפי פרקי המפרט הכללי הבין-משרדי (״הספר הכחול״); אינה כתב כמויות מכרזי. לקריאה בלבד. הכיסוי החוזי של כל שורה — החוזה המכסה אותה או סעיף ההחרגה שמשאיר אותה פתוחה — נרשם לפי החוזים שבמערכת: מכוסה {num(count(all, "covered"))} · מוחרג {num(count(all, "excluded"))} · טרם נחתם חוזה {num(count(all, "not_contracted"))}.
      </div>
      <div className="erp-filters">
        <label>
          חיפוש
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="מס׳ שורה / תיאור / אסמכתה" data-testid="erp-boq-search" />
        </label>
        <label>
          פרק
          <select value={chapter} onChange={(e) => setChapter(e.target.value)} data-testid="erp-boq-chapter">
            <option value="">הכול</option>
            {chapters.map(([code, nameHe]) => (
              <option key={code} value={code}>
                {code} — {nameHe}
              </option>
            ))}
          </select>
        </label>
        <label>
          סעיף תקציבי
          <select value={section} onChange={(e) => setSection(e.target.value)} data-testid="erp-boq-section">
            <option value="">הכול</option>
            {pkg.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionShort(s.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          כיסוי חוזי
          <select value={coverage} onChange={(e) => setCoverage(e.target.value)} data-testid="erp-boq-coverage">
            <option value="">הכול</option>
            {(Object.keys(COVERAGE_HE) as Coverage[]).map((c) => (
              <option key={c} value={c}>
                {COVERAGE_HE[c]}
              </option>
            ))}
          </select>
        </label>
        <span className="erp-count" data-testid="erp-boq-count">
          {num(rows.length)} שורות
        </span>
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table" data-testid="erp-boq-table">
          <thead>
            <tr>
              <th>מס׳ שורה</th>
              <th>תיאור</th>
              <th className="num">כמות</th>
              <th>יח׳</th>
              <th>סעיף תקציבי</th>
              <th>כיסוי חוזי</th>
              <th>אסמכתה</th>
              <th>הערה</th>
              <th>מסמך</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 && (
              <tr>
                <td colSpan={9} className="erp-muted">
                  אין שורות התואמות לסינון.
                </td>
              </tr>
            )}
            {groups.map(([code, lines]) => (
              <GroupRows key={code} code={code} lines={lines} target={target} count={count} openContract={openContract} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ code, lines, target, count, openContract }: { code: string; lines: HBoqLine[]; target: string | null; count: (lines: HBoqLine[], c: Coverage) => number; openContract: (id: string) => void }) {
  const excluded = count(lines, "excluded");
  const open = count(lines, "not_contracted");
  return (
    <>
      <tr className="erp-group-row" data-testid={`erp-boq-chapter-${code}`}>
        <td colSpan={9}>
          פרק {code} — {lines[0].chapterNameHe} · {num(lines.length)} שורות · מכוסה {num(count(lines, "covered"))}
          {excluded ? ` · מוחרג ${num(excluded)}` : ""}
          {open ? ` · טרם נחתם חוזה ${num(open)}` : ""}
        </td>
      </tr>
      {lines.map((l) => {
        const page = boqPageFor(pkg, l.id);
        return (
          <tr key={l.id} className={l.id === target ? "erp-row-target" : ""} data-testid={`erp-boq-row-${l.id}`} data-boq-line={l.id} data-coverage={l.coverage}>
            <td className="mono">{l.id}</td>
            <td className="erp-desc">{l.descriptionHe}</td>
            <td className="num">{num(l.qty)}</td>
            <td>{l.unit}</td>
            <td>{sectionShort(l.sectionId)}</td>
            <td>
              <span className={`erp-status erp-status-${COVERAGE_TONE[l.coverage]}`}>{COVERAGE_HE[l.coverage]}</span>
            </td>
            <td className="erp-desc">
              {l.coveredByContractId ? (
                <button type="button" className="erp-link" onClick={() => openContract(l.coveredByContractId!)} data-testid={`erp-boq-contract-${l.id}`}>
                  {l.coverageRef ?? `חוזה ${l.coveredByContractId}`}
                </button>
              ) : l.coverageRef ? (
                <span className={l.coverage === "excluded" ? "erp-warn-text" : ""}>{l.coverageRef}</span>
              ) : (
                "—"
              )}
            </td>
            <td className="erp-desc">{l.noteHe ?? ""}</td>
            <td>
              {page ? (
                <button type="button" className="erp-link" onClick={() => store.openDocument(page.id, "line")} data-testid={`erp-boq-document-${l.id}`}>
                  📎 פתח
                </button>
              ) : (
                ""
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
