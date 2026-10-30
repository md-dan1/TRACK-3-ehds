import { Check, ChevronLeft, ChevronRight, Copy, Info, Loader2, TriangleAlert, XCircle } from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Tooltip } from "./Tooltip";

export const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 disabled:bg-slate-300 disabled:text-slate-600",
  secondary: "bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-300 disabled:text-slate-600",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  loading = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  const sz = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed ${sz} ${VARIANTS[variant]} ${focusRing} ${className}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className = "", bodyClassName = "p-4" }: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Page title row. `before` (e.g. a back button) sits left of the title, outside the h1. */
export function PageHeader({ title, subtitle, actions, before }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; before?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {before && <div className="flex-none">{before}</div>}
        <div className="min-w-0">
          <h1 className={`text-xl font-semibold tracking-tight text-slate-900 ${before ? "leading-8" : ""}`}>{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-600">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…", className = "" }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center gap-2 text-sm text-slate-600 ${className}`}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ title = "Something went wrong", error, children }: { title?: string; error?: unknown; children?: ReactNode }) {
  const msg = error instanceof Error ? error.message : error ? String(error) : null;
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <XCircle className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {msg && <p className="mt-0.5 break-words text-red-800">{msg}</p>}
        {children}
      </div>
    </div>
  );
}

export function Notice({ tone = "info", title, children, icon }: { tone?: "info" | "warning" | "success" | "neutral"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  const tones = {
    info: "border-sky-300 bg-sky-50 text-sky-950",
    warning: "border-amber-300 bg-amber-50 text-amber-950",
    success: "border-slate-200 bg-slate-50 text-slate-800", // neutral box; the green lives in the check icon
    neutral: "border-slate-200 bg-slate-50 text-slate-800",
  } as const;
  const defaultIcon = tone === "warning" ? <TriangleAlert className="h-4 w-4" aria-hidden /> : tone === "success" ? <Check className="h-4 w-4 text-green-700" aria-hidden /> : <Info className="h-4 w-4" aria-hidden />;
  return (
    <div className={`flex gap-3 rounded-lg border p-3 text-sm ${tones[tone]}`}>
      <div className="mt-0.5 flex-none">{icon ?? defaultIcon}</div>
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">{children}</div>;
}

/** Round, focusable "?" button whose tooltip (hover and keyboard focus) explains something; `items` render as a list. */
export function HelpChip({ label, children, items, ordered = false }: { label: string; children?: ReactNode; items?: ReactNode[]; ordered?: boolean }) {
  const ListTag = ordered ? "ol" : "ul";
  const content = (
    <>
      {children}
      {items && (
        <ListTag className={`${ordered ? "list-decimal" : "list-disc"} space-y-1 pl-4 ${children ? "mt-1" : ""}`}>
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ListTag>
      )}
    </>
  );
  return (
    <Tooltip content={content} wide={!!items}>
      <button
        type="button"
        aria-label={label}
        className={`inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-slate-200 text-xs font-semibold leading-none text-slate-800 hover:bg-slate-300 ${focusRing}`}
      >
        ?
      </button>
    </Tooltip>
  );
}

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "warning" | "danger" | "info" | "success" | "blue"; className?: string }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 ring-slate-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-300",
    danger: "bg-red-50 text-red-800 ring-red-300",
    info: "bg-sky-50 text-sky-900 ring-sky-300",
    success: "bg-green-50 text-green-800 ring-green-300",
    blue: "bg-blue-50 text-blue-800 ring-blue-300",
  } as const;
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]} ${className}`}>{children}</span>;
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked (e.g. http): ignore */
        }
      }}
      aria-live="polite"
    >
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** Code in the same grey monospace panel as the raw request JSON, with a copy button in the corner. */
/** Code panel; long lines wrap at the available width so expanded rows never widen their table. */
export function CodeBlock({ code, maxHeight = "max-h-80" }: { code: string; maxHeight?: string }) {
  return (
    <div className="relative">
      <pre className={`${maxHeight} overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-3 pr-20 font-mono text-xs leading-relaxed text-slate-800 [overflow-wrap:anywhere]`} tabIndex={0}>
        <code>{code}</code>
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

/** Plain number tile: label and value, optional `?` help next to the label. No icons, hints or colours. */
export function Kpi({ label, value, help, to }: { label: ReactNode; value: ReactNode; help?: ReactNode; to?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
        {label}
        {help}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
    </>
  );
  const box = "block rounded-lg border border-slate-200 bg-white p-3 shadow-sm";
  return to ? (
    <Link to={to} className={`${box} transition-colors hover:border-brand-600 hover:bg-brand-50 ${focusRing}`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** Card title followed by a `?` chip. */
export function TitleWithHelp({ title, help, items }: { title: ReactNode; help?: ReactNode; items?: ReactNode[] }) {
  return (
    <span className="inline-flex items-center gap-2">
      {title}
      <HelpChip label={`About ${typeof title === "string" ? title.toLowerCase() : "this"}`} items={items}>
        {help}
      </HelpChip>
    </span>
  );
}

/** A card that is collapsed by default (same look as "Raw EHDS request body (JSON)"). */
export function Collapsible({ title, actions, children, defaultOpen = false }: { title: ReactNode; actions?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 flex-none transition-transform group-open:rotate-90" aria-hidden />
        <span className="flex-1">{title}</span>
        {actions && (
          <span className="font-normal" onClick={(e) => e.preventDefault()}>
            {actions}
          </span>
        )}
      </summary>
      <div className="border-t border-slate-200 p-4">{children}</div>
    </details>
  );
}

/**
 * Table cell content that never wraps or gets an ellipsis: it stays on one line and scrolls sideways inside
 * the cell, and only when it would overflow `max` (no scrollbar when it fits). Put it inside the padded <td>.
 */
export function ScrollCell({ children, max = "max-w-xs", className = "" }: { children: ReactNode; max?: string; className?: string }) {
  return <div className={`thin-scrollbar overflow-x-auto overflow-y-hidden whitespace-nowrap ${max} ${className}`}>{children}</div>;
}

/** "Search" filter field as used on the Logs tabs. */
export function SearchField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-700">
        Search
      </label>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-2.5 py-1.5" />
    </div>
  );
}

/** Rows per page on the Logs subpages. */
export const LOG_PAGE_SIZE = 40;

/** Previous / Page N (of M) / Next, bottom right under a table. Pages are 0-based. */
export function Pager({ page, hasNext, onPage, busy = false, pages }: { page: number; hasNext: boolean; onPage: (p: number) => void; busy?: boolean; pages?: number }) {
  return (
    <nav className="flex items-center justify-end gap-2" aria-label="Pagination">
      <Button size="sm" onClick={() => onPage(page - 1)} disabled={page === 0 || busy}>
        <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
      </Button>
      <span className="whitespace-nowrap text-xs tabular-nums text-slate-700">
        Page {page + 1}
        {pages ? ` of ${pages}` : ""}
      </span>
      <Button size="sm" onClick={() => onPage(page + 1)} disabled={!hasNext || busy}>
        Next <ChevronRight className="h-4 w-4" aria-hidden />
      </Button>
    </nav>
  );
}

/** Grid for the filter row above a log table; the search field takes the first (widest) column. */
export const FILTER_GRID = "grid gap-3 sm:grid-cols-[1.5fr_9rem_10rem]";

/** Small two-column fact table (label | value), e.g. the request summary in the left column. */
export function KeyValueTable({ rows, caption }: { rows: [string, ReactNode][]; caption: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([k, val]) => (
            <tr key={k}>
              <th scope="row" className="w-28 whitespace-nowrap px-3 py-2 text-left align-top font-medium text-slate-600">
                {k}
              </th>
              <td className="px-3 py-2 text-slate-900">
                <ScrollCell max="max-w-[9.5rem]">{val}</ScrollCell>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-600">{k}</dt>
          <dd className="min-w-0 break-words text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
