import type { ButtonHTMLAttributes, ReactNode } from "react";

/** The UI primitives the ERP and the report pages share; their styles are in styles/components.css. */

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
