import type { ButtonHTMLAttributes, ReactNode } from "react";
import { formatILS, formatNumber, formatVariance } from "../domain/money";

export function Bidi({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}

/** Currency display: isolated LTR digits, optional sign/tone. */
export function Money({ value, signed, tone, className }: { value: number; signed?: boolean; tone?: "auto" | "none" | "variance"; className?: string }) {
  const text = signed ? formatVariance(value) : formatILS(value);
  let cls = "money";
  if (tone === "variance") cls += value > 0 ? " pos-warn" : value < 0 ? " good" : "";
  else if (tone === "auto" && value < 0) cls += " neg";
  return <bdi className={`${cls}${className ? ` ${className}` : ""}`}>{text}</bdi>;
}

export function Num({ value, unit }: { value: number | null | undefined; unit?: string }) {
  if (value == null) return <span className="faint">—</span>;
  return (
    <span className="nowrap">
      <bdi className="num">{formatNumber(value)}</bdi>
      {unit ? ` ${unit}` : ""}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  done?: boolean;
  guide?: string;
};

export function Button({ variant = "secondary", size = "md", busy, done, guide, className, children, disabled, ...rest }: ButtonProps) {
  const cls = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "", busy ? "busy" : "", done ? "done" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || busy} aria-busy={busy || undefined} data-guide={guide} {...rest}>
      {children}
    </button>
  );
}

export function Badge({ tone = "neutral", children, dot }: { tone?: "neutral" | "primary" | "amber" | "red" | "green" | "navy"; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Card({ title, actions, accent, children, className, selected, onClick, guide }: { title?: ReactNode; actions?: ReactNode; accent?: "amber" | "red" | "green" | "primary"; children: ReactNode; className?: string; selected?: boolean; onClick?: () => void; guide?: string }) {
  const cls = ["card", accent ? `accent-${accent}` : "", selected ? "selected" : "", onClick ? "clickable" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <section className={cls} onClick={onClick} data-guide={guide}>
      {title || actions ? (
        <div className="card-title">
          {typeof title === "string" ? <h3>{title}</h3> : title}
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tooltip, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tooltip?: string; tone?: "amber" | "red" | "green" }) {
  return (
    <div className="stat" title={tooltip}>
      <div className="stat-label">
        {label}
        {tooltip ? (
          <span className="faint" aria-label={tooltip} title={tooltip}>
            ⓘ
          </span>
        ) : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone}-text)` } : undefined}>
        {value}
      </div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; labelHe: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>
          {t.labelHe}
          {t.count != null ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Notice({ tone = "navy", children }: { tone?: "amber" | "red" | "green" | "navy"; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function KeyValue({ rows }: { rows: { labelHe: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {rows.map((r, i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{r.labelHe}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function BeforeAfter({ before, after }: { before: { labelHe: string; value: string }[]; after: { labelHe: string; value: string }[] }) {
  return (
    <div className="before-after">
      <div className="col">
        <h4>לפני</h4>
        <KeyValue rows={before.map((r) => ({ labelHe: r.labelHe, value: <Bidi>{r.value}</Bidi> }))} />
      </div>
      <div className="col after">
        <h4>אחרי</h4>
        <KeyValue rows={after.map((r) => ({ labelHe: r.labelHe, value: <Bidi>{r.value}</Bidi> }))} />
      </div>
    </div>
  );
}

export function Checklist({ items, title }: { items: string[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="stack-sm">
      {title ? <h4 className="muted">{title}</h4> : null}
      <ul className="checklist">
        {items.map((item, i) => (
          <li key={i}>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string | null }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint-text">{hint}</span> : null}
    </div>
  );
}

export function Chip({ active, onClick, children, guide, "data-testid": testId }: { active?: boolean; onClick?: () => void; children: ReactNode; guide?: string; "data-testid"?: string }) {
  return (
    <button type="button" className="chip" aria-pressed={active} onClick={onClick} data-guide={guide} data-testid={testId}>
      {children}
    </button>
  );
}
