import { useDemo } from "../app/store";
import { useUi } from "../app/ui";
import { costLineView, projectTotals } from "../domain/selectors/financial";
import { EvidenceList } from "./EvidenceList";
import { Button, KeyValue, Money, Notice, Num } from "./primitives";

/** The "פתח את החישוב" drawer for a conditional price risk: actual premium versus conditional future exposure. */
export function CalculationView({ findingId }: { findingId: string }) {
  const { state } = useDemo();
  const ui = useUi();
  const finding = state.findings.find((f) => f.id === findingId);
  if (!finding) return <Notice tone="amber">הממצא אינו זמין.</Notice>;
  const code = finding.costCodeId ? state.costCodes.find((c) => c.id === finding.costCodeId) : undefined;
  const line = code ? costLineView(state, code.id) : null;
  const totals = projectTotals(state, finding.projectId);
  const unit = code?.unit ?? "";
  const question = state.questions.find((q) => finding.questionIds.includes(q.id));
  const open = !["resolved", "dismissed", "superseded"].includes(finding.status);
  const future = finding.amounts.futurePremium ?? 0;
  return (
    <div className="stack-lg">
      <p>{finding.explanationHe}</p>
      <KeyValue
        rows={[
          { labelHe: "כמות שנרכשה (מאומתת)", value: <Num value={finding.numbers.purchased} unit={unit} /> },
          { labelHe: "כמות מתוכננת", value: <Num value={finding.numbers.planned} unit={unit} /> },
          { labelHe: "מחיר רכישה מול תקציב", value: <span><Money value={finding.amounts.candidatePrice ?? 0} /> מול <Money value={finding.amounts.budgetPrice ?? 0} /> ל{unit}</span> },
          { labelHe: "תוספת בפועל (כבר נצברה)", value: <Money value={finding.amounts.actualPremium ?? 0} /> },
          { labelHe: "יתרה ללא התחייבות", value: <Num value={finding.numbers.remaining} unit={unit} /> },
          ...(finding.numbers.committed ? [{ labelHe: "כמות במחיר קבוע (לא חשופה)", value: <Num value={finding.numbers.committed} unit={unit} /> }] : []),
          { labelHe: "תוספת עתידית מותנית", value: <Money value={future} /> },
          { labelHe: "חריגה כוללת בסעיף אם ההנחה תתממש", value: <Money value={finding.amounts.total ?? 0} /> },
        ]}
      />
      {line ? (
        <div className="grid-2">
          <div className="card card-muted stack-sm">
            <h4 className="muted">תחזית מאושרת</h4>
            <div>
              {code?.nameHe}: <Money value={line.eac} /> (חריגה <Money value={line.variance} signed />)
            </div>
            <div>
              הפרויקט: <Money value={totals.eac} />
            </div>
          </div>
          <div className="card card-muted stack-sm">
            <h4 className="muted">{open ? "תרחיש מותנה (טרם אושר)" : "ההחלטה התקבלה"}</h4>
            {open ? (
              <>
                <div>
                  {code?.nameHe}: <Money value={line.eac + future} />
                </div>
                <div>
                  הפרויקט: <Money value={totals.eac + future} />
                </div>
                <div className="tiny muted">מוצג לצד התחזית המאושרת ואינו נכלל בה עד להחלטה.</div>
              </>
            ) : (
              <div className="small">{finding.resolutionHe}</div>
            )}
          </div>
        </div>
      ) : null}
      <EvidenceList evidence={finding.evidence} />
      <div className="row">
        {question?.conversationId ? (
          <Button variant="primary" onClick={() => ui.openConversation(question.conversationId!)}>
            בדוק את הנחת המחיר
          </Button>
        ) : question ? (
          <Notice tone="navy">הבירור על הנחת המחיר ממתין לאישור צוות הבקרה לפני שליחתו.</Notice>
        ) : null}
        <Button variant="ghost" onClick={() => ui.openFinding(finding.id)}>
          פתח את הממצא
        </Button>
      </div>
    </div>
  );
}
