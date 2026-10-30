import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  content: ReactNode;
  children: ReactNode;
  /** Make the wrapper itself focusable (for non-interactive triggers like text or icons). */
  focusable?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Bubble for list content: as wide as its content, up to 24rem (otherwise max 20rem). */
  wide?: boolean;
}

/**
 * Accessible tooltip: opens on hover AND keyboard focus, closes on Escape/blur/scroll.
 * Rendered in a portal with fixed positioning so table scroll containers never clip it.
 * The text is also present as an sr-only description linked with aria-describedby.
 */
export function Tooltip({ content, children, focusable = false, className = "", style, wide = false }: Props) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 72;
    const half = wide ? 192 : 160;
    const left = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
    setPos({ top: below ? r.bottom + 8 : r.top - 8, left, below });
  }, [wide]);
  const hide = useCallback(() => setPos(null), []);

  // a tall tooltip above the trigger can run off the top of the window: show it below instead
  useLayoutEffect(() => {
    const el = ref.current;
    if (!pos || pos.below || !tip.current || !el) return;
    if (tip.current.getBoundingClientRect().top < 8) setPos({ ...pos, top: el.getBoundingClientRect().bottom + 8, below: true });
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [pos]);

  const descId = `${id}-desc`;
  const child =
    !focusable && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": descId })
      : children;

  return (
    <>
      <span
        ref={ref}
        style={style}
        className={`inline-flex max-w-full ${focusable ? "cursor-help rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1" : ""} ${className}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => e.key === "Escape" && hide()}
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={focusable ? descId : undefined}
      >
        {child}
        <span id={descId} className="sr-only">
          {content}
        </span>
      </span>
      {pos &&
        createPortal(
          <div
            ref={tip}
            aria-hidden="true"
            className={`pointer-events-none fixed z-[100] ${wide ? "w-max" : "max-w-xs"} rounded-md bg-slate-900 px-2.5 py-1.5 text-xs leading-snug text-white shadow-lg`}
            style={{
              top: pos.top,
              left: pos.left,
              transform: pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
              // list tooltips fit their content, up to 24rem
              ...(wide ? { maxWidth: "min(24rem, calc(100vw - 1rem))" } : {}),
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
