import { store, useUi, useV2State, type ErpScreen } from "../../app/store";
import { pkg } from "../../engine/commands";
import { BudgetScreen } from "./BudgetScreen";
import { ChangeLogScreen } from "./ChangeLogScreen";
import { ContractsScreen } from "./ContractsScreen";
import { DocumentsScreen } from "./DocumentsScreen";
import { InvoicesScreen } from "./InvoicesScreen";
import { PurchaseOrdersScreen } from "./PurchaseOrdersScreen";
import { dateTimeHe, personName } from "./format";
import "./erp.css";

const NAV: { id: ErpScreen; labelHe: string; icon: string }[] = [
  { id: "invoices", labelHe: "חשבונות ספקים", icon: "🧾" },
  { id: "purchase_orders", labelHe: "הזמנות רכש", icon: "📦" },
  { id: "contracts", labelHe: "חוזי קבלני משנה", icon: "📑" },
  { id: "budget", labelHe: "תקציב ותחזית", icon: "📊" },
  { id: "change_log", labelHe: "יומן שינויים", icon: "🕘" },
  { id: "documents", labelHe: "תיקיית מסמכים", icon: "📁" },
];

/** The simulated ERP ("זיו — סביבת הדגמה"): a dense, classic contractor-ERP look, deliberately unlike the control system. */
export function ErpApp() {
  const ui = useUi();
  const state = useV2State();
  const screen = ui.erp.screen;
  const current = NAV.find((n) => n.id === screen) ?? NAV[0];

  return (
    <div className="erp" data-testid="erp-app">
      <header className="erp-band">
        <div className="erp-brand">
          <span className="erp-logo">זיו</span>
          <span className="erp-brand-sub">סביבת הדגמה</span>
        </div>
        <div className="erp-context">
          <span>{pkg.project.companyHe}</span>
          <span className="erp-sep">|</span>
          <span>פרויקט: {pkg.project.nameHe}</span>
          <span className="erp-sep">|</span>
          <span>שנת כספים 2026</span>
        </div>
        <div className="erp-user">
          משתמש: {personName(state.operatorId)} · {dateTimeHe(state.clock)}
        </div>
      </header>
      <div className="erp-toolbar">
        <span className="erp-crumb">ניהול פרויקטים</span>
        <span className="erp-crumb-sep">›</span>
        <span className="erp-crumb">{pkg.project.nameHe}</span>
        <span className="erp-crumb-sep">›</span>
        <span className="erp-crumb erp-crumb-current">{current.labelHe}</span>
      </div>
      <div className="erp-layout">
        <nav className="erp-nav" aria-label="מודולים">
          <div className="erp-nav-title">מודולים</div>
          {NAV.map((n) => (
            <button key={n.id} type="button" className={`erp-nav-item${n.id === screen ? " active" : ""}`} onClick={() => store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: n.id, editing: false, creating: false, invoiceId: null, poId: null, contractId: null } }))} data-testid={`erp-nav-${n.id}`}>
              <span className="erp-nav-icon" aria-hidden="true">
                {n.icon}
              </span>
              {n.labelHe}
            </button>
          ))}
        </nav>
        <main className="erp-main">
          {screen === "invoices" && <InvoicesScreen />}
          {screen === "purchase_orders" && <PurchaseOrdersScreen />}
          {screen === "contracts" && <ContractsScreen />}
          {screen === "budget" && <BudgetScreen />}
          {screen === "change_log" && <ChangeLogScreen />}
          {screen === "documents" && <DocumentsScreen />}
        </main>
      </div>
      <footer className="erp-footer">סביבת הדגמה — נתונים בדויים · זיו אינה מערכת אמיתית; המסכים מדמים מערכת מידע קבלנית</footer>
    </div>
  );
}
