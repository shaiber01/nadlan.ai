import { useMemo, useState } from "react";
import { Button } from "../../../components/primitives";
import { store, useUi, useV2State } from "../../app/store";
import type { HInvoice, PersonId, SectionId } from "../../data/types";
import { createInvoice, pkg, updateInvoiceBuilding, updateInvoiceSection } from "../../engine/commands";
import { dateHe, dateTimeHe, monthHe, nis, num, personName, sectionFull, sectionShort, supplierName, defaultActor } from "./format";

const STATUS_TONE: Record<HInvoice["status"], string> = { אושר: "ok", בבדיקה: "warn", שולם: "done" };

export function InvoicesScreen() {
  const ui = useUi();
  if (ui.erp.creating) return <NewInvoiceForm />;
  if (ui.erp.invoiceId != null) return <InvoiceView invoiceId={ui.erp.invoiceId} />;
  return <InvoiceList />;
}

function openInvoice(id: number | null, patch: { editing?: boolean; creating?: boolean } = {}) {
  store.setUi((u) => ({ ...u, erp: { ...u.erp, screen: "invoices", invoiceId: id, editing: patch.editing ?? false, creating: patch.creating ?? false } }));
}

function InvoiceList() {
  const state = useV2State();
  const ui = useUi();
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("");
  // a deep link from the control report ("חשבונות הסעיף במערכת המידע") pre-filters the list by section
  const [section, setSection] = useState<string>(ui.erp.sectionId ?? "");
  const [status, setStatus] = useState("");
  const rows = useMemo(() => {
    const q = search.trim();
    return [...state.erp.invoices]
      .filter((i) => (!supplier || i.supplierId === supplier) && (!section || i.sectionId === section) && (!status || i.status === status))
      .filter((i) => !q || String(i.id).includes(q) || i.supplierDocNo.includes(q) || i.descriptionHe.includes(q) || supplierName(i.supplierId).includes(q))
      .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
  }, [state.erp.invoices, search, supplier, section, status]);
  const total = rows.reduce((a, i) => a + i.amount, 0);

  return (
    <div className="erp-screen" data-testid="erp-invoice-list">
      <div className="erp-screen-head">
        <h2>חשבונות ספקים</h2>
        <div className="erp-actions">
          <Button size="sm" variant="primary" onClick={() => openInvoice(null, { creating: true })} data-testid="erp-invoice-new">
            + חשבון חדש
          </Button>
        </div>
      </div>
      <div className="erp-filters">
        <label>
          חיפוש
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="מס׳ חשבון / מסמך ספק / תיאור" data-testid="erp-invoice-search" />
        </label>
        <label>
          ספק
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">הכול</option>
            {pkg.suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nameHe}
              </option>
            ))}
          </select>
        </label>
        <label>
          סעיף תקציבי
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">הכול</option>
            {pkg.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionShort(s.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          סטטוס
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">הכול</option>
            <option value="אושר">אושר</option>
            <option value="בבדיקה">בבדיקה</option>
            <option value="שולם">שולם</option>
          </select>
        </label>
        <span className="erp-count">
          {num(rows.length)} רשומות · {nis(total)}
        </span>
      </div>
      <div className="erp-table-wrap">
        <table className="erp-table">
          <thead>
            <tr>
              <th>מס׳</th>
              <th>תאריך</th>
              <th>ספק</th>
              <th>מסמך ספק</th>
              <th>סוג</th>
              <th>תיאור</th>
              <th>סעיף תקציבי</th>
              <th className="num">סכום לפני מע״מ</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => openInvoice(i.id)} data-testid={`erp-invoice-row-${i.id}`}>
                <td className="mono">{i.id}</td>
                <td>{dateHe(i.date)}</td>
                <td>{supplierName(i.supplierId)}</td>
                <td className="mono">{i.supplierDocNo}</td>
                <td>
                  {i.docType}
                  {i.partialNo != null ? ` ${i.partialNo}` : ""}
                </td>
                <td className="erp-desc">{i.descriptionHe}</td>
                <td>{sectionShort(i.sectionId)}</td>
                <td className="num">{nis(i.amount)}</td>
                <td>
                  <span className={`erp-status erp-status-${STATUS_TONE[i.status]}`}>{i.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoiceView({ invoiceId }: { invoiceId: number }) {
  const state = useV2State();
  const ui = useUi();
  const invoice = state.erp.invoices.find((i) => i.id === invoiceId);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  if (!invoice) {
    return (
      <div className="erp-screen">
        <p className="erp-error">חשבון {invoiceId} לא נמצא.</p>
        <Button size="sm" onClick={() => openInvoice(null)}>
          חזרה לרשימה
        </Button>
      </div>
    );
  }
  const log = state.erp.changeLog.filter((c) => c.recordType === "invoice" && c.recordId === String(invoice.id)).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const contract = invoice.contractId ? pkg.contracts.find((c) => c.id === invoice.contractId) : null;
  const attachment = invoice.attachmentId ? pkg.documents.find((d) => d.id === invoice.attachmentId) : null;

  return (
    <div className="erp-screen" data-testid="erp-invoice-view" data-invoice-id={invoice.id}>
      <div className="erp-screen-head">
        <h2>
          חשבון ספק <span className="mono">{invoice.id}</span>
          <span className={`erp-status erp-status-${STATUS_TONE[invoice.status]}`}>{invoice.status}</span>
        </h2>
        <div className="erp-actions">
          <Button size="sm" variant="ghost" onClick={() => openInvoice(null)} data-testid="erp-invoice-back">
            ‹ חזרה לרשימה
          </Button>
          {attachment && (
            <Button size="sm" onClick={() => store.openDocument(attachment.id)} data-testid="erp-invoice-attachment">
              📎 פתח קובץ מצורף
            </Button>
          )}
          {!ui.erp.editing && (
            <Button size="sm" variant="primary" onClick={() => openInvoice(invoice.id, { editing: true })} data-testid="erp-invoice-edit">
              עריכה
            </Button>
          )}
        </div>
      </div>
      {savedNote && (
        <div className="erp-saved" role="status" data-testid="erp-invoice-saved">
          {savedNote}
        </div>
      )}
      {ui.erp.editing ? (
        <InvoiceEditForm
          invoice={invoice}
          onDone={(note) => {
            setSavedNote(note);
            openInvoice(invoice.id);
          }}
          onCancel={() => openInvoice(invoice.id)}
        />
      ) : (
        <div className="erp-record">
          <RecordSection title="פרטי המסמך">
            <Fieldv label="ספק" value={supplierName(invoice.supplierId)} />
            <Fieldv label="מס׳ מסמך ספק" value={invoice.supplierDocNo} mono />
            <Fieldv label="סוג מסמך" value={invoice.docType} />
            <Fieldv label="חשבון חלקי מס׳" value={invoice.partialNo != null ? String(invoice.partialNo) : "—"} />
            <Fieldv label="תקופה" value={monthHe(invoice.period)} />
            <Fieldv label="תאריך מסמך" value={dateHe(invoice.date)} />
            <Fieldv label="התקבל בתאריך" value={dateHe(invoice.dateReceived)} />
            <Fieldv label="נקלט" value={`${dateHe(invoice.enteredAt)} · ${personName(invoice.enteredBy)}`} />
          </RecordSection>
          <RecordSection title="שיוך">
            <Fieldv label="סעיף תקציבי" value={sectionFull(invoice.sectionId)} strong testId="erp-invoice-section-value" />
            <Fieldv label="חוזה" value={contract ? `${contract.id} — ${contract.scopeHe}` : "—"} />
            <Fieldv label="הזמנת רכש" value={invoice.poId != null ? String(invoice.poId) : "—"} mono />
            <Fieldv label="בניין" value={invoice.building ?? "—"} />
            <Fieldv label="תיאור" value={invoice.descriptionHe} wide />
          </RecordSection>
          <RecordSection title="סכומים (לפני מע״מ)">
            <Fieldv label="סכום החשבון" value={nis(invoice.amount)} strong />
            <Fieldv label="מצטבר קודם" value={invoice.cumulativePrev != null ? nis(invoice.cumulativePrev) : "—"} />
            <Fieldv label="מצטבר נוכחי" value={invoice.cumulativeNow != null ? nis(invoice.cumulativeNow) : "—"} />
            <Fieldv label="עכבון %" value={`${invoice.retentionPct}%`} />
            <Fieldv label="סכום עכבון" value={nis(invoice.retentionAmt)} />
            <Fieldv label="לתשלום נטו" value={nis(invoice.netPayable)} />
            {invoice.quantity != null && <Fieldv label="כמות" value={`${num(invoice.quantity)} ${invoice.unit ?? ""}`} />}
            {invoice.unitPrice != null && <Fieldv label="מחיר יחידה" value={nis(invoice.unitPrice)} />}
          </RecordSection>
          <RecordSection title="אישור">
            <Fieldv label="סטטוס" value={invoice.status} />
            <Fieldv label="אושר על ידי" value={personName(invoice.approvedBy)} />
            <Fieldv
              label="קובץ מצורף"
              value={
                attachment ? (
                  <button type="button" className="erp-link" onClick={() => store.openDocument(attachment.id)}>
                    📎 {attachment.fileName}
                  </button>
                ) : (
                  "—"
                )
              }
            />
          </RecordSection>
        </div>
      )}
      <section className="erp-subsection" data-testid="erp-invoice-changelog">
        <h3>יומן שינויים לרשומה</h3>
        {log.length === 0 ? (
          <p className="erp-muted">אין שינויים מתועדים לרשומה זו.</p>
        ) : (
          <table className="erp-table compact">
            <thead>
              <tr>
                <th>מועד</th>
                <th>שדה</th>
                <th>לפני</th>
                <th>אחרי</th>
                <th>מבצע</th>
                <th>הערה</th>
              </tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.id} data-testid="erp-changelog-row">
                  <td>{dateTimeHe(c.at)}</td>
                  <td>{c.field}</td>
                  <td>{c.before}</td>
                  <td>{c.after}</td>
                  <td>{personName(c.byId)}</td>
                  <td className="erp-muted">{c.noteHe}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function InvoiceEditForm({ invoice, onDone, onCancel }: { invoice: HInvoice; onDone: (note: string) => void; onCancel: () => void }) {
  const [sectionId, setSectionId] = useState<SectionId>(invoice.sectionId);
  const [building, setBuilding] = useState<string>(invoice.building ?? "");
  const [byId, setById] = useState<PersonId>(defaultActor("חשבונות"));
  const [error, setError] = useState<string | null>(null);
  const changed = sectionId !== invoice.sectionId;
  const buildingChanged = (building || null) !== invoice.building;
  const buildingOptions = [...pkg.project.buildings.map((b) => ({ id: b.id, labelHe: `בניין ${b.id}` })), { id: pkg.project.buckets.shared.id, labelHe: pkg.project.buckets.shared.labelHe }];

  const save = () => {
    try {
      store.dispatch((s) => {
        let next = updateInvoiceSection(s, invoice.id, sectionId, byId);
        if (buildingChanged) next = updateInvoiceBuilding(next, invoice.id, building || null, byId);
        return next;
      });
      const notes = [changed ? `סעיף תקציבי: ${sectionShort(invoice.sectionId)} ← ${sectionShort(sectionId)}` : "", buildingChanged ? `בניין: ${invoice.building ?? "—"} ← ${building || "—"}` : ""].filter(Boolean);
      onDone(notes.length ? `נשמר. ${notes.join(" · ")} (${personName(byId)}).` : "נשמר ללא שינוי.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="erp-form" data-testid="erp-invoice-edit-form">
      <div className="erp-form-grid">
        <label className="erp-field">
          <span>ספק</span>
          <input value={supplierName(invoice.supplierId)} readOnly />
        </label>
        <label className="erp-field">
          <span>מס׳ מסמך ספק</span>
          <input value={invoice.supplierDocNo} readOnly />
        </label>
        <label className="erp-field">
          <span>תאריך</span>
          <input value={dateHe(invoice.date)} readOnly />
        </label>
        <label className="erp-field">
          <span>סכום לפני מע״מ</span>
          <input value={nis(invoice.amount)} readOnly />
        </label>
        <label className="erp-field erp-field-wide">
          <span>תיאור</span>
          <input value={invoice.descriptionHe} readOnly />
        </label>
        <label className="erp-field erp-field-editable">
          <span>סעיף תקציבי *</span>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value as SectionId)} data-testid="erp-invoice-section" autoFocus>
            {pkg.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {sectionFull(s.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field erp-field-editable">
          <span>בניין</span>
          <select value={building} onChange={(e) => setBuilding(e.target.value)} data-testid="erp-invoice-building">
            <option value="">לא צוין</option>
            {buildingOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.labelHe}
              </option>
            ))}
          </select>
        </label>
        <label className="erp-field">
          <span>מבצע השינוי</span>
          <select value={byId} onChange={(e) => setById(e.target.value as PersonId)} data-testid="erp-invoice-by">
            {pkg.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameHe} — {p.roleHe}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="erp-error" role="alert" data-testid="erp-invoice-error">
          {error}
        </p>
      )}
      <div className="erp-form-actions">
        <Button size="sm" variant="primary" onClick={save} data-testid="erp-invoice-save">
          שמור
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="erp-invoice-cancel">
          ביטול
        </Button>
        <span className="erp-muted">שדות חסומים לעריכה אחרי אישור החשבון; ניתן לשנות שיוך בלבד.</span>
      </div>
    </div>
  );
}

function NewInvoiceForm() {
  const state = useV2State();
  const [form, setForm] = useState({ supplierId: "", supplierDocNo: "", date: "", amount: "", descriptionHe: "", sectionId: "" as SectionId | "", contractId: "", attachmentId: "" });
  const [byId, setById] = useState<PersonId>(defaultActor("חשבונות"));
  const [error, setError] = useState<string | null>(null);
  const invoiceDocs = pkg.documents.filter((d) => d.kind === "invoice");
  const contractsForSupplier = pkg.contracts.filter((c) => !form.supplierId || c.supplierId === form.supplierId);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    const amount = Number(form.amount.replace(/[^\d.]/g, ""));
    if (!form.supplierId || !form.supplierDocNo || !form.date || !form.sectionId || !form.descriptionHe) {
      setError("יש למלא ספק, מס׳ מסמך, תאריך, תיאור וסעיף תקציבי.");
      return;
    }
    try {
      let created: number | null = null;
      store.dispatch((s) => {
        const [next, invoice] = createInvoice(s, { supplierId: form.supplierId, supplierDocNo: form.supplierDocNo, date: form.date, amount, descriptionHe: form.descriptionHe, sectionId: form.sectionId as SectionId, contractId: form.contractId || null, attachmentId: form.attachmentId || null, byId });
        created = invoice.id;
        return next;
      });
      if (created != null) openInvoice(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const nextId = Math.max(...state.erp.invoices.map((i) => i.id)) + 1;
  return (
    <div className="erp-screen" data-testid="erp-invoice-new-form">
      <div className="erp-screen-head">
        <h2>
          חשבון ספק חדש <span className="erp-muted">(מספר יוקצה בשמירה — הבא בתור: {nextId})</span>
        </h2>
        <div className="erp-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // like an ERP's "copy last invoice": the newest invoice of the ERP as a starting point
              const last = [...state.erp.invoices].sort((a, b) => (a.enteredAt === b.enteredAt ? b.id - a.id : b.enteredAt.localeCompare(a.enteredAt)))[0];
              if (last) setForm({ supplierId: last.supplierId, supplierDocNo: "", date: state.clock.slice(0, 10), amount: "", descriptionHe: last.descriptionHe, sectionId: last.sectionId, contractId: last.contractId ?? "", attachmentId: "" });
            }}
            data-testid="erp-new-copy-last"
          >
            העתק מהחשבון האחרון
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openInvoice(null)}>
            ‹ חזרה לרשימה
          </Button>
        </div>
      </div>
      <div className="erp-form">
        <div className="erp-form-grid">
          <label className="erp-field">
            <span>ספק *</span>
            <select value={form.supplierId} onChange={set("supplierId")} data-testid="erp-new-supplier">
              <option value="">— בחר —</option>
              {pkg.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameHe}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-field">
            <span>מס׳ חשבון ספק *</span>
            <input value={form.supplierDocNo} onChange={set("supplierDocNo")} placeholder="מס׳ החשבון אצל הספק" data-testid="erp-new-docno" />
          </label>
          <label className="erp-field">
            <span>תאריך *</span>
            <input type="date" value={form.date} onChange={set("date")} data-testid="erp-new-date" />
          </label>
          <label className="erp-field">
            <span>סכום לפני מע״מ *</span>
            <input inputMode="numeric" value={form.amount} onChange={set("amount")} placeholder="סכום לפני מע״מ" data-testid="erp-new-amount" />
          </label>
          <label className="erp-field erp-field-wide">
            <span>תיאור *</span>
            <input value={form.descriptionHe} onChange={set("descriptionHe")} placeholder="תיאור העבודה או האספקה" data-testid="erp-new-desc" />
          </label>
          <label className="erp-field erp-field-editable">
            <span>סעיף תקציבי *</span>
            <select value={form.sectionId} onChange={set("sectionId")} data-testid="erp-new-section">
              <option value="">— בחר מהרשימה —</option>
              {pkg.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {sectionFull(s.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-field">
            <span>חוזה</span>
            <select value={form.contractId} onChange={set("contractId")} data-testid="erp-new-contract">
              <option value="">— ללא —</option>
              {contractsForSupplier.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} — {c.scopeHe}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-field">
            <span>קובץ מצורף</span>
            <select value={form.attachmentId} onChange={set("attachmentId")} data-testid="erp-new-attachment">
              <option value="">— ללא —</option>
              {invoiceDocs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName}
                </option>
              ))}
            </select>
          </label>
          <label className="erp-field">
            <span>קולט</span>
            <select value={byId} onChange={(e) => setById(e.target.value as PersonId)} data-testid="erp-new-by">
              {pkg.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameHe} — {p.roleHe}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <p className="erp-error" role="alert" data-testid="erp-new-error">
            {error}
          </p>
        )}
        <div className="erp-form-actions">
          <Button size="sm" variant="primary" onClick={save} data-testid="erp-new-save">
            שמור
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openInvoice(null)}>
            ביטול
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RecordSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="erp-record-section">
      <h3>{title}</h3>
      <div className="erp-record-grid">{children}</div>
    </section>
  );
}

export function Fieldv({ label, value, strong, mono, wide, testId }: { label: string; value: React.ReactNode; strong?: boolean; mono?: boolean; wide?: boolean; testId?: string }) {
  return (
    <div className={`erp-fv${wide ? " erp-fv-wide" : ""}`} data-testid={testId}>
      <span className="erp-fv-label">{label}</span>
      <span className={`erp-fv-value${strong ? " strong" : ""}${mono ? " mono" : ""}`}>{value}</span>
    </div>
  );
}
