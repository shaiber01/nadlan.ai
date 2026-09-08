import { Fragment, useEffect, useState } from "react";
import { navigate, routeWith, useRoute } from "../../app/router";
import { store, useDemo } from "../../app/store";
import { useUi } from "../../app/ui";
import { EvidenceList } from "../../components/EvidenceList";
import { HistoryList } from "../../components/HistoryList";
import { recordKindHe } from "../../components/RecordView";
import { ScenarioEventButtons } from "../../components/ScenarioEventButtons";
import { Badge, Bidi, Button, Card, Chip, EmptyState, Field, KeyValue, Money, Notice, Num, PageHeader, Stat, Tabs } from "../../components/primitives";
import { CheckStatusBadge, FindingStatusBadge, QuestionStatusBadge } from "../../components/StatusBadge";
import { editSteelErpRow, setCandidateFuturePrice, steelWhatIf, updateSteelExperiment, validateExperiment } from "../../domain/commands/experiment";
import { createFuturePriceProposal } from "../../domain/commands/messages";
import { approveProposal } from "../../domain/commands/review";
import { approveRecovery, requestDurationChange } from "../../domain/commands/scenario-actions";
import { finishDateForDuration, formatDate } from "../../domain/dates";
import { formatNumber, ils, parseMoneyInput, parseQuantityInput, toIls } from "../../domain/money";
import { contractRemainingPayment, projectLines, projectTotals } from "../../domain/selectors/financial";
import type { CostLineView, Finding, Project } from "../../domain/types";
import { he } from "../../locales/he";
import "./budget.css";

const isOpen = (f: Finding) => !["resolved", "dismissed", "superseded"].includes(f.status);
type DetailTab = "records" | "commitments" | "forecast" | "payments" | "quantities" | "recovery" | "history";

const workItemStatusHe: Record<string, string> = { uncommitted: "ללא התחייבות", committed: "מחויב", fulfilled: "מומש", historical: "היסטורי" };

export function BudgetPage() {
  const { state } = useDemo();
  const route = useRoute();
  const project = state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0];
  const expandedCode = route.params.get("code");
  const [showPaid, setShowPaid] = useState(true);

  useEffect(() => {
    if (!expandedCode) return;
    const timer = setTimeout(() => document.querySelector<HTMLElement>('[data-guide="budget-line"]')?.scrollIntoView({ block: "start", behavior: state.flags.skipMotion ? "auto" : "smooth" }), 150);
    return () => clearTimeout(timer);
  }, [expandedCode, state.flags.skipMotion]);

  if (project.status === "draft") {
    return (
      <div className="stack-lg">
        <PageHeader title={he.nav.budget} subtitle={`${project.nameHe} · ${he.fin.beforeVat}`} />
        <Notice tone="amber">
          לפרויקט זה יש טיוטת תקציב בלבד ואין ביצוע. את הטיוטה בודקים במסך הפרויקטים.{" "}
          <Button size="sm" variant="primary" onClick={() => navigate(routeWith("projects", { project: project.id }))}>
            פתח את טיוטת התקציב
          </Button>
        </Notice>
      </div>
    );
  }

  const lines = projectLines(state, project.id);
  const totals = projectTotals(state, project.id);
  const conditionalRisk = state.findings.filter((f) => f.projectId === project.id && (f.kind === "price_risk" || f.kind === "commitment_conditional") && isOpen(f)).reduce((acc, f) => acc + (f.amounts.futurePremium ?? f.amounts.amount ?? 0), 0);
  const toggle = (codeId: string) => navigate(routeWith("budget", { project: project.id, code: expandedCode === codeId ? null : codeId }));

  return (
    <div className="stack-lg">
      <PageHeader
        title={he.nav.budget}
        subtitle={
          <span>
            {project.nameHe} · {he.fin.beforeVat} · {he.status.autoAnalysis}
          </span>
        }
        actions={
          <Chip active={showPaid} onClick={() => setShowPaid((v) => !v)}>
            עמודת שולם בפועל
          </Chip>
        }
      />
      <div className="grid-4">
        <Stat label={he.fin.budget} value={<Money value={totals.budget} />} />
        <Stat label={he.fin.incurred} value={<Money value={totals.incurred} />} sub={<span>{he.fin.invoiced}: <Money value={totals.incurredInvoiced} />{totals.incurredAccrued ? <> · {he.fin.accrued}: <Money value={totals.incurredAccrued} /></> : null}</span>} />
        <Stat label={he.fin.commitments} value={<Money value={totals.commitments} />} sub="נטו, ללא עבודה שכבר הוכרה" />
        <Stat label={he.fin.uncommitted} value={<Money value={totals.uncommitted} />} sub="תחזית מאושרת לעבודה שטרם הוזמנה" />
        <Stat label={he.fin.eac} value={<Money value={totals.eac} />} tooltip={he.fin.eacTooltip} sub={<span>{he.fin.remainingToComplete}: <Money value={totals.commitments + totals.uncommitted} /></span>} />
        <Stat label={totals.variance >= 0 ? he.fin.variance : he.fin.varianceFavorable} value={<Money value={totals.variance} signed tone="variance" />} sub={totals.provisional ? he.status.provisional : he.fin.acceptedForecast} />
        <Stat label={he.fin.paid} value={<Money value={totals.paid} />} sub="מוצג בנפרד; אינו רכיב של העלות שנצברה" />
        {conditionalRisk > 0 ? <Stat label="סיכון מותנה שטרם אושר" value={<Money value={conditionalRisk} />} sub="מוצג בנפרד ואינו נכלל בתחזית המאושרת" tone="amber" /> : null}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>סעיף</th>
              <th className="num">{he.fin.budget}</th>
              <th className="num">{he.fin.incurred}</th>
              <th className="num">{he.fin.commitments}</th>
              <th className="num">{he.fin.uncommitted}</th>
              <th className="num">{he.fin.eac}</th>
              <th className="num">{he.fin.variance}</th>
              {showPaid ? <th className="num">{he.fin.paid}</th> : null}
              <th>כמויות</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const expanded = expandedCode === line.costCodeId;
              return (
                <Fragment key={line.costCodeId}>
                  <tr className={`clickable${expanded ? " expanded" : ""}`} onClick={() => toggle(line.costCodeId)} aria-expanded={expanded}>
                    <td>
                      <span className="strong">{line.nameHe}</span> <span className="faint tiny">{line.costCodeId}</span>
                      <span className="line-badges">
                        {line.provisional ? <CheckStatusBadge status="pending" /> : null}
                        {line.commitmentOverrun > 0 ? <Badge tone="red">חריגה מהתחייבות — נדרש טיפול</Badge> : null}
                        {line.needsRevalidation ? <Badge tone="amber">בסיס התחזית דורש אימות מחדש</Badge> : null}
                        {line.coverage === "aggregate" ? <Badge tone="neutral">סעיף מצרפי</Badge> : null}
                      </span>
                    </td>
                    <td className="num"><Money value={line.budget} /></td>
                    <td className="num"><Money value={line.incurred} /></td>
                    <td className="num"><Money value={line.commitments} /></td>
                    <td className="num"><Money value={line.uncommitted} /></td>
                    <td className="num"><Money value={line.eac} /></td>
                    <td className="num"><Money value={line.variance} signed tone="variance" /></td>
                    {showPaid ? <td className="num"><Money value={line.paid} /></td> : null}
                    <td className="small">
                      {line.quantities ? (
                        line.quantities.purchasedVerified == null ? (
                          <span className="row">
                            <Badge tone="amber">טרם אומת</Badge>
                            <span className="faint tiny">בזיו: <Num value={line.quantities.purchasedRaw} unit={line.quantities.unit} /></span>
                          </span>
                        ) : (
                          <span>
                            <Num value={line.quantities.purchasedVerified} /> / <Num value={line.quantities.planned} unit={line.quantities.unit} />
                          </span>
                        )
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="subrow">
                      <td colSpan={showPaid ? 9 : 8}>
                        <LineDetail line={line} project={project} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            <tr className="total">
              <td>סה״כ {project.nameHe}</td>
              <td className="num"><Money value={totals.budget} /></td>
              <td className="num"><Money value={totals.incurred} /></td>
              <td className="num"><Money value={totals.commitments} /></td>
              <td className="num"><Money value={totals.uncommitted} /></td>
              <td className="num"><Money value={totals.eac} /></td>
              <td className="num"><Money value={totals.variance} signed tone="variance" /></td>
              {showPaid ? <td className="num"><Money value={totals.paid} /></td> : null}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tiny muted">לחיצה על סעיף פותחת את החשבוניות, ההתחייבויות, בסיס התחזית, התשלומים וההיסטוריה שלו. תשלומים אינם רכיב של העלות שנצברה; יתרת תקציב שלא נוצלה אינה חיסכון ואינה מדד התקדמות.</div>
    </div>
  );
}

function LineDetail({ line, project }: { line: CostLineView; project: Project }) {
  const { state } = useDemo();
  const ui = useUi();
  const code = state.costCodes.find((c) => c.id === line.costCodeId)!;
  const recoveries = state.recoveries.filter((r) => r.costCodeId === line.costCodeId);
  const openFindings = state.findings.filter((f) => f.costCodeId === line.costCodeId && isOpen(f));
  const isManager = state.role === "manager";
  const availableTabs: { id: DetailTab; labelHe: string; count?: number }[] = [
    { id: "records", labelHe: "חשבוניות ורישומים", count: line.records.length },
    { id: "commitments", labelHe: "התחייבויות", count: line.commitmentViews.length },
    { id: "forecast", labelHe: "בסיס התחזית" },
    { id: "payments", labelHe: he.fin.paymentsPanel },
    ...(line.quantities ? [{ id: "quantities" as DetailTab, labelHe: "כמויות" }] : []),
    ...(recoveries.length ? [{ id: "recovery" as DetailTab, labelHe: "החזר מלקוח", count: recoveries.length }] : []),
    { id: "history", labelHe: he.actions.history },
  ];
  const [tab, setTab] = useState<DetailTab>("records");
  const contracts = line.commitmentViews.filter((c) => c.kind === "contract");
  const contractPayment = contracts.length === 1 ? contractRemainingPayment(state, contracts[0].commitmentId) : null;
  const lineRemaining = line.eac - line.paid;

  return (
    <div className="budget-expanded" data-guide="budget-line" onClick={(e) => e.stopPropagation()}>
      <ScenarioEventButtons route="budget" costCodeId={line.costCodeId} />
      {openFindings.length > 0 ? (
        <div className="row">
          {openFindings.map((f) => (
            <span key={f.id} className="row">
              {isManager && f.status === "pending_review" ? <Badge tone="navy">{he.general.underProviderReview}</Badge> : <FindingStatusBadge status={f.status} />}
              <Button size="sm" variant="ghost" onClick={() => ui.openFinding(f.id)}>
                {f.titleHe}
              </Button>
            </span>
          ))}
        </div>
      ) : null}
      <Tabs tabs={availableTabs} value={tab} onChange={setTab} />

      {tab === "records" ? (
        line.records.length === 0 ? (
          <EmptyState>{he.general.emptyRecords}</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>רשומה</th>
                  <th>סוג</th>
                  <th>תאריך</th>
                  <th className="num">סכום</th>
                  <th className="num">שולם</th>
                  <th>סטטוס</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {line.records.map((r) => (
                  <tr key={`${r.recordId}-${r.amount}`}>
                    <td>
                      {r.descriptionHe} <span className="faint tiny"><Bidi className="mono">{r.recordId}</Bidi></span>
                      {r.quantity != null ? <span className="tiny muted"> · <Num value={r.quantity} unit={r.unit ?? undefined} />{r.unitPrice != null ? <> × <Money value={r.unitPrice} /></> : null}</span> : null}
                    </td>
                    <td>{recordKindHe(r.kind)}{r.historicalSummary ? " (סיכום)" : ""}</td>
                    <td><Bidi>{formatDate(r.date)}</Bidi></td>
                    <td className="num"><Money value={r.amount} tone="auto" /></td>
                    <td className="num"><Money value={r.paid} /></td>
                    <td><CheckStatusBadge status={r.checkStatus} /></td>
                    <td>
                      <span className="row">
                        <Button size="sm" variant="ghost" onClick={() => ui.openRecord(r.recordId)}>רשומה</Button>
                        {r.sourceDocumentId ? <Button size="sm" variant="ghost" onClick={() => ui.openDocument(r.sourceDocumentId!, "line1")}>מקור</Button> : <span className="tiny faint">ללא מסמך מקור</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "commitments" ? (
        line.commitmentViews.length === 0 ? (
          <EmptyState>אין התחייבויות פתוחות בסעיף זה.</EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>התחייבות</th>
                  <th className="num">{he.fin.contractValue}</th>
                  <th className="num">{he.fin.recognized}</th>
                  <th className="num">{he.fin.remaining}</th>
                  <th>סטטוס</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {line.commitmentViews.map((c) => (
                  <tr key={c.commitmentId}>
                    <td>{c.titleHe} <span className="faint tiny"><Bidi className="mono">{c.commitmentId}</Bidi></span></td>
                    <td className="num"><Money value={c.value} /></td>
                    <td className="num"><Money value={c.recognized} /></td>
                    <td className="num"><Money value={c.remaining} /></td>
                    <td>
                      {c.overrun > 0 ? <Badge tone="red">חריגה מההתחייבות: <Money value={c.overrun} /> — נדרש טיפול (תוספת מאושרת או חריג)</Badge> : c.status === "fulfilled" || (c.remaining === 0 && c.recognized > 0) ? <Badge tone="green">{he.status.fulfilled}</Badge> : c.status === "conditional" ? <Badge tone="amber">{he.status.conditional}</Badge> : <Badge tone="primary">{he.status.active}</Badge>}
                    </td>
                    <td>{c.documentId ? <Button size="sm" variant="ghost" onClick={() => ui.openDocument(c.documentId!, "value")}>מסמך</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === "forecast" ? (
        <div className="stack-sm">
          {line.workItems.filter((w) => w.status !== "historical").length === 0 ? (
            <EmptyState>אין פריטי תחזית בסעיף זה.</EmptyState>
          ) : (
            line.workItems
              .filter((w) => w.status !== "historical")
              .map((w) => (
                <div key={w.workItemId} className="card card-muted stack-sm">
                  <div className="row-between">
                    <div className="row">
                      <Badge tone={w.status === "uncommitted" ? "amber" : w.status === "committed" ? "primary" : "green"}>{workItemStatusHe[w.status]}</Badge>
                      <span className="strong small">{w.titleHe}</span>
                      {w.needsRevalidation ? <Badge tone="amber">דורש אימות מחדש</Badge> : null}
                    </div>
                    <span className="strong"><Money value={w.amount} /></span>
                  </div>
                  <div className="small muted">
                    {w.quantity != null && w.unitPrice != null ? <><Num value={w.quantity} unit={w.unit} /> × <Money value={w.unitPrice} /> · </> : w.quantity != null ? <><Num value={w.quantity} unit={w.unit} /> · </> : null}
                    {w.basisHe}
                  </div>
                  <EvidenceList evidence={w.evidence} title={null} />
                </div>
              ))
          )}
          <div className="tiny muted">רק פריטים ללא התחייבות נכללים ביתרת העבודה ללא התחייבות; פריטים מחויבים מוצגים לפי יתרת ההתחייבות; פריטים שמומשו נכללים בעלות שנצברה.</div>
        </div>
      ) : null}

      {tab === "payments" ? (
        <div className="stack">
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>רשומה</th>
                  <th className="num">הוכר</th>
                  <th className="num">שולם בפועל</th>
                  <th className="num">{he.fin.unpaid}</th>
                </tr>
              </thead>
              <tbody>
                {line.records.map((r) => (
                  <tr key={`${r.recordId}-pay`}>
                    <td>{r.descriptionHe} <span className="faint tiny"><Bidi className="mono">{r.recordId}</Bidi></span></td>
                    <td className="num"><Money value={r.amount} tone="auto" /></td>
                    <td className="num"><Money value={r.paid} /></td>
                    <td className="num"><Money value={r.amount - r.paid} tone="auto" /></td>
                  </tr>
                ))}
                <tr className="total">
                  <td>סה״כ</td>
                  <td className="num"><Money value={line.incurred} /></td>
                  <td className="num"><Money value={line.paid} /></td>
                  <td className="num"><Money value={line.incurred - line.paid} /></td>
                </tr>
              </tbody>
            </table>
          </div>
          {contractPayment && contracts.length === 1 ? (
            <div className="card card-muted stack-sm">
              <span className="strong small">תשלום צפוי שנותר לחוזה {contracts[0].titleHe} (מודל מפושט: ללא מע״מ, עכבון ומימון)</span>
              <KeyValue
                rows={[
                  { labelHe: "חשבוניות שהוכרו וטרם שולמו", value: <Money value={contractPayment.unpaidRecognized} /> },
                  ...(contractPayment.unbilledRecognized ? [{ labelHe: he.fin.accrued, value: <Money value={contractPayment.unbilledRecognized} /> }] : []),
                  { labelHe: "יתרת התחייבות נטו", value: <Money value={contractPayment.remainingCommitment} /> },
                  { labelHe: "סה״כ לחוזה", value: <span className="strong"><Money value={contractPayment.total} /></span> },
                ]}
              />
              {lineRemaining !== contractPayment.total ? (
                <div className="small muted">
                  הסעיף כולו כולל גם <Money value={lineRemaining - contractPayment.total} /> מחוץ לחוזה זה, ולכן התשלום הצפוי לכל הסעיף הוא <Money value={lineRemaining} />.
                </div>
              ) : null}
            </div>
          ) : (
            <div className="small muted">
              תשלום צפוי שנותר לסעיף (תחזית פחות שולם): <Money value={lineRemaining} />
            </div>
          )}
          <div className="tiny muted">תשלומים ומצב התאמה הם רישומים מקושרים, לא חלק מטקסט החשבונית. תשלום אינו עלות פרויקט נוספת.</div>
        </div>
      ) : null}

      {tab === "quantities" && line.quantities ? (
        <div className="stack-sm">
          <KeyValue
            rows={[
              { labelHe: he.fin.quantityPlanned, value: <Num value={line.quantities.planned} unit={line.quantities.unit} /> },
              { labelHe: he.fin.quantityPurchased, value: line.quantities.purchasedVerified == null ? <Badge tone="amber">טרם אומת מול המסמכים</Badge> : <Num value={line.quantities.purchasedVerified} unit={line.quantities.unit} /> },
              ...(line.quantities.purchasedRaw != null && line.quantities.purchasedRaw !== line.quantities.purchasedVerified ? [{ labelHe: he.fin.quantityRaw, value: <span className="row"><Num value={line.quantities.purchasedRaw} unit={line.quantities.unit} /><Badge tone="amber">שונה מהמסמכים</Badge></span> }] : []),
              { labelHe: he.fin.quantityDelivered, value: line.quantities.delivered == null ? "אין תעודת משלוח" : <Num value={line.quantities.delivered} unit={line.quantities.unit} /> },
              ...(line.quantities.outstandingDelivery ? [{ labelHe: "יתרת אספקה שטרם התקבלה", value: <Num value={line.quantities.outstandingDelivery} unit={line.quantities.unit} /> }] : []),
              ...(line.quantities.committedQuantity ? [{ labelHe: "כמות מוזמנת במחיר קבוע", value: <Num value={line.quantities.committedQuantity} unit={line.quantities.unit} /> }] : []),
              { labelHe: he.fin.quantityRemaining, value: line.quantities.remainingToProcure == null ? "—" : <Num value={line.quantities.remainingToProcure} unit={line.quantities.unit} /> },
            ]}
          />
          <div className="tiny muted">כמות שנרכשה, כמות שסופקה, כמות מותקנת וכמות מתוכננת הם שדות שונים; קיום חשבונית אינו מעיד על התקדמות בשטח.</div>
        </div>
      ) : null}

      {tab === "recovery" ? (
        <div className="stack-sm">
          {recoveries.map((r) => (
            <div key={r.id} className="card card-muted row-between">
              <div className="stack-sm">
                <span className="small strong">{r.titleHe}</span>
                <span className="row small">
                  <Money value={r.amount} />
                  <Badge tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status === "approved" ? "אושר על ידי לקוח הקצה" : r.status === "rejected" ? "נדחה" : "ממתין לאישור"}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => ui.openDocument(r.documentId)}>מסמך</Button>
                </span>
                <span className="tiny muted">הכנסה/החזר מלקוח נפרד מתחזית העלות; אישור ההחזר אינו מקטין את העלות הצפויה.</span>
              </div>
              {state.role === "reviewer" && r.status === "pending_customer_approval" ? (
                <Button size="sm" onClick={() => store.dispatch((s) => approveRecovery(s, r.id), "ההחזר אושר; תחזית העלות ללא שינוי")}>
                  אשר החזר (לקוח הקצה)
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {tab === "history" ? <HistoryList filter={{ costCodeId: line.costCodeId }} /> : null}

      {code.category === "steel" && code.id === "H10" ? <SteelExperimentPanel /> : null}
      {code.category === "site_overhead" ? <DurationForm project={project} /> : null}
    </div>
  );
}

function SteelExperimentPanel() {
  const { state } = useDemo();
  const exp = state.steelExperiment;
  const record = state.erpRecords.find((r) => r.id === "TX-H-STEEL");
  const [qtyText, setQtyText] = useState(String(exp.purchasedQuantity));
  const [priceText, setPriceText] = useState(String(toIls(exp.purchaseUnitPrice)));
  const [candidate, setCandidate] = useState(toIls(exp.candidateFuturePrice));
  const [rawText, setRawText] = useState(String(exp.rawErpQuantity));
  const [rawOpen, setRawOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReviewer = state.role === "reviewer";
  const candidateAgorot = ils(Number.isFinite(candidate) && candidate > 0 ? candidate : 0);
  const whatIf = candidateAgorot > 0 ? steelWhatIf(state, candidateAgorot) : null;
  const acceptedPrice = record && whatIf ? whatIf.acceptedRemaining / (whatIf.remainingQty || 1) : 0;
  const candidateValid = Number.isFinite(candidate) && candidate > 0;

  const commitCandidate = (value: number) => {
    setCandidate(value);
    if (Number.isFinite(value) && value > 0 && value >= 500 && value <= 20000) store.dispatch((s) => setCandidateFuturePrice(s, ils(value)));
  };

  const changeSample = () => {
    const q = parseQuantityInput(qtyText);
    const p = parseMoneyInput(priceText);
    if (q == null || p == null) {
      setError("יש להזין כמות ומחיר תקינים");
      return;
    }
    const validation = validateExperiment({ purchasedQuantity: q, purchaseUnitPrice: p }, exp.plannedQuantity);
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    store.dispatch((s) => updateSteelExperiment(s, { purchasedQuantity: q, purchaseUnitPrice: p }), "נתוני הדוגמה עודכנו; נוצרו גרסאות חדשות למסמכים והבדיקה מתחילה אוטומטית");
  };

  const editErp = () => {
    const q = parseQuantityInput(rawText);
    if (q == null || q <= 0) {
      setError("כמות הרשומה בזיו חייבת להיות מספר חיובי");
      return;
    }
    setError(null);
    const ok = store.dispatch((s) => editSteelErpRow(s, q), "הרשומה בזיו עודכנה; המסמכים המקוריים נשמרו והבדיקה מתחילה אוטומטית");
    if (ok) setRawOpen(false);
  };

  const submitPrice = () => {
    if (!candidateValid) {
      setError("מחיר עתידי חייב להיות חיובי");
      return;
    }
    setError(null);
    store.dispatch((s) => {
      const [s1, proposal] = createFuturePriceProposal(s, "H10", ils(candidate), { label: "הנחת מחיר עתידי מפאנל ההדגמה" });
      return isReviewer ? approveProposal(s1, proposal.id, "REVIEWER") : s1;
    }, isReviewer ? "הנחת המחיר אושרה והתחזית עודכנה" : "הנחת המחיר הוגשה לבדיקת צוות הבקרה");
  };

  return (
    <Card title={he.actions.tryOtherData} accent="primary" guide="experiment-panel">
      <div className="stack">
        <div className="small muted">ניסוי מוגבל ומאומת על רכישת הברזל של מגורי הדרים. התקציב (500 טון × 3,000 ₪) קבוע. שינוי נתוני הדוגמה יוצר גרסאות חדשות לחשבונית, להזמנה ולתעודת המשלוח יחד; עריכת הרשומה בזיו בלבד שומרת את המסמכים ויוצרת אי-התאמה לבדיקה.</div>
        <div className="experiment-grid">
          <Field label="כמות מתוכננת (טון)">
            <input className="input num" value={formatNumber(exp.plannedQuantity)} disabled readOnly />
          </Field>
          <Field label="כמות שנרכשה (טון)" hint="גדולה מ-0 ועד 500; עד שלוש ספרות אחרי הנקודה">
            <input className="input num" value={qtyText} onChange={(e) => setQtyText(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="מחיר רכישה לטון (₪)" hint="מספר חיובי">
            <input className="input num" value={priceText} onChange={(e) => setPriceText(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="מחיר עתידי משוער לטון (₪)" hint="הנחת תחזית, לא התחייבות חתומה">
            <input className="input num" value={Number.isFinite(candidate) ? candidate : ""} onChange={(e) => commitCandidate(Number(e.target.value))} inputMode="decimal" type="number" min={1} />
          </Field>
        </div>
        <div className="stack-sm">
          <label className="small muted">
            טווח מהיר: 2,800–3,600 ₪ לטון (<Money value={candidateAgorot} />)
            <input type="range" min={2800} max={3600} step={10} value={Math.min(3600, Math.max(2800, Number.isFinite(candidate) ? candidate : 3000))} onChange={(e) => commitCandidate(Number(e.target.value))} aria-label="מחיר עתידי משוער" />
          </label>
        </div>
        {whatIf ? (
          <div className="table-wrap">
            <table className="whatif-table">
              <thead>
                <tr>
                  <th>חישוב</th>
                  <th className="num">תחזית מאושרת</th>
                  <th className="num">לפי המחיר הנבחר</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>סכום הרכישה (<Num value={whatIf.purchased} unit="טון" /> × <Money value={whatIf.purchasePrice} />)</td>
                  <td className="num"><Money value={whatIf.purchaseAmount} /></td>
                  <td className="num"><Money value={whatIf.purchaseAmount} /></td>
                </tr>
                <tr>
                  <td>
                    יתרה לרכישה ללא התחייבות{whatIf.committedQty > 0 ? <span className="tiny muted"> (ועוד <Num value={whatIf.committedQty} unit="טון" /> במחיר קבוע: <Money value={whatIf.committedAmount} />, אינם מושפעים)</span> : null}
                  </td>
                  <td className="num"><Num value={whatIf.remainingQty} unit="טון" /></td>
                  <td className="num"><Num value={whatIf.remainingQty} unit="טון" /></td>
                </tr>
                <tr>
                  <td>תחזית היתרה (מחיר לטון <Money value={Math.round(acceptedPrice)} /> מול <Money value={candidateAgorot} />)</td>
                  <td className="num"><Money value={whatIf.acceptedRemaining} /></td>
                  <td className="num"><Money value={whatIf.candidateRemaining} /></td>
                </tr>
                <tr>
                  <td>תחזית עלות הברזל לסיום</td>
                  <td className="num"><Money value={whatIf.acceptedSteelEac} /></td>
                  <td className="num"><Money value={whatIf.candidateSteelEac} /></td>
                </tr>
                <tr>
                  <td>חריגת מחיר בפועל (כבר נצברה)</td>
                  <td className="num"><Money value={whatIf.actualPriceVariance} signed tone="variance" /></td>
                  <td className="num"><Money value={whatIf.actualPriceVariance} signed tone="variance" /></td>
                </tr>
                <tr>
                  <td>חריגה עתידית מותנית (מול <Money value={whatIf.budgetPrice} /> לטון)</td>
                  <td className="num"><Money value={whatIf.acceptedRemaining - whatIf.remainingQty * whatIf.budgetPrice} signed tone="variance" /></td>
                  <td className="num"><Money value={whatIf.conditionalFutureVariance} signed tone="variance" /></td>
                </tr>
                <tr>
                  <td>תקציב הסעיף</td>
                  <td className="num"><Money value={whatIf.budget} /></td>
                  <td className="num"><Money value={whatIf.candidateSteelEac - whatIf.budget} signed tone="variance" /> מול התקציב</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <Notice tone="red">מחיר עתידי חייב להיות מספר חיובי.</Notice>
        )}
        {error ? <span className="error-text">{error}</span> : null}
        <div className="row">
          <Button onClick={changeSample}>{he.actions.changeSampleData}</Button>
          <Button variant="ghost" onClick={() => setRawOpen((v) => !v)}>
            {he.actions.editErpRecord}
          </Button>
          <Button variant="primary" disabled={!candidateValid} onClick={submitPrice}>
            {isReviewer ? he.actions.approveForecast : "הגש הנחת מחיר לבדיקה"}
          </Button>
        </div>
        {rawOpen ? (
          <div className="card card-muted row">
            <Field label="כמות ברשומה בזיו (טון)" hint="המסמכים המקוריים נשמרים; אי-התאמה תיבדק אוטומטית">
              <input className="input num" value={rawText} onChange={(e) => setRawText(e.target.value)} inputMode="decimal" />
            </Field>
            <Button size="sm" variant="primary" onClick={editErp}>
              {he.actions.saveRecord}
            </Button>
          </div>
        ) : null}
        <div className="tiny muted">שינוי המחיר המשוער הוא תצוגת ״מה אם״ בלבד. התחזית המאושרת משתנה רק דרך ״{he.actions.approveForecast}״ בבדיקת צוות הבקרה; דוחות שכבר הופקו אינם משתנים.</div>
      </div>
    </Card>
  );
}

function DurationForm({ project }: { project: Project }) {
  const { state } = useDemo();
  const plan = state.documents.find((d) => d.kind === "plan" && d.projectIds.includes(project.id) && d.facts.monthlyComponents);
  const components = plan?.facts.monthlyComponents ?? [];
  const baseMonths = project.acceptedMonths ?? project.plannedMonths ?? plan?.facts.months ?? 12;
  const [monthsText, setMonthsText] = useState(String(Math.max(baseMonths + 2, 14)));
  const [selected, setSelected] = useState<string[]>(components.map((c) => c.id));
  const months = Number(monthsText);
  const valid = Number.isInteger(months) && months > baseMonths;
  const monthly = components.filter((c) => selected.includes(c.id)).reduce((a, c) => a + c.amount, 0);
  const extraMonths = valid ? months - baseMonths : 0;
  const finish = valid && project.start ? finishDateForDuration(project.start, months) : null;
  const durationQuestions = state.questions.filter((q) => q.projectId === project.id && q.parser === "duration").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const latestQuestion = durationQuestions[0];
  if (!plan) return null;
  return (
    <Card title="עדכן משך פרויקט" accent="amber" guide="duration-form">
      <div className="stack">
        <div className="small muted">
          סיום מתוכנן: {project.plannedFinish ? formatDate(project.plannedFinish) : "—"} ({project.plannedMonths ?? plan.facts.months} חודשים)
          {project.acceptedFinish ? <> · סיום מאושר לפי התחזית: {formatDate(project.acceptedFinish)} ({project.acceptedMonths} חודשים) — התכנון המקורי נשמר כבסיס</> : null}
        </div>
        <div className="row">
          <Field label="משך האתר הכולל (חודשים שלמים)" hint={`המשך המאושר כיום: ${baseMonths} חודשים`} error={monthsText && !valid ? "יש להזין מספר חודשים שלם וארוך מהמשך המאושר" : null}>
            <input className="input num" value={monthsText} onChange={(e) => setMonthsText(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <div className="stack-sm">
          <span className="small muted">אילו עלויות חודשיות נמשכות בתקופה הנוספת?</span>
          <div className="component-list">
            {components.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} />
                {c.nameHe} (<Money value={c.amount} /> לחודש)
              </label>
            ))}
          </div>
        </div>
        <div className="card card-muted">
          <KeyValue
            rows={[
              { labelHe: "עלות חודשית של הרכיבים שנבחרו", value: <Money value={monthly} /> },
              { labelHe: "חודשים נוספים", value: valid ? <Num value={extraMonths} unit="חודשים" /> : "—" },
              { labelHe: "תוספת צפויה ליתרת העבודה ללא התחייבות", value: valid ? <Money value={monthly * extraMonths} /> : "—" },
              { labelHe: "סיום חדש (לפי חודשים קלנדריים מההתחלה)", value: finish ? formatDate(finish) : "—" },
            ]}
          />
        </div>
        <div className="row">
          <Button variant="primary" disabled={!valid || selected.length === 0} onClick={() => store.dispatch((s) => requestDurationChange(s, project.id, months, selected), "נוצרה שאלה ללקוח על הארכת האתר; התחזית תתעדכן רק לאחר אישור")}>
            שאל את הלקוח על ההארכה
          </Button>
          <span className="tiny muted">התחזית משתנה רק לאחר שהלקוח מאשר שהאתר כולו מתארך ואילו עלויות נמשכות, וצוות הבקרה מאשר את ההצעה. התקציב המאושר אינו משתנה.</span>
        </div>
        {latestQuestion ? (
          <div className="row small">
            <QuestionStatusBadge status={latestQuestion.status} />
            <span>{latestQuestion.textHe}</span>
            <Button size="sm" variant="ghost" onClick={() => navigate(routeWith("questions", {}))}>
              {he.nav.questions}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
