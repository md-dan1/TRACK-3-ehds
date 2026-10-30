import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

/** WAI-ARIA tabs: arrow keys / Home / End move between tabs; the active panel is `children`. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  children,
  label,
  className = "",
  panelClassName = "",
}: {
  tabs: TabDef<T>[];
  value: T;
  onChange: (id: T) => void;
  children?: ReactNode;
  label: string;
  className?: string;
  /** Extra classes for the panel, e.g. to let only the panel scroll below a fixed tab header. */
  panelClassName?: string;
}) {
  const base = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((t) => !t.disabled);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = enabled.findIndex((t) => t.id === value);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next !== null) {
      e.preventDefault();
      const id = enabled[next].id;
      onChange(id);
      refs.current[id]?.focus();
    }
  };

  return (
    <div className={className}>
      {/* no overflow scrolling: tabs wrap instead, so a tab header can never scroll */}
      <div role="tablist" aria-label={label} className="flex flex-none flex-wrap gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => (refs.current[t.id] = el)}
              role="tab"
              type="button"
              id={`${base}-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`${base}-panel`}
              tabIndex={active ? 0 : -1}
              disabled={t.disabled}
              onClick={() => onChange(t.id)}
              onKeyDown={onKey}
              className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:text-slate-400 ${
                active ? "border-brand-700 text-brand-800" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {t.label}
              {t.badge !== undefined && t.badge !== null && (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${active ? "bg-brand-100 text-brand-800" : "bg-slate-100 text-slate-700"}`}>{t.badge}</span>
              )}
            </button>
          );
        })}
      </div>
      {children !== undefined && (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className={`pt-4 ${panelClassName}`}>
          {children}
        </div>
      )}
    </div>
  );
}
