import { useEffect, useState, type ReactNode } from "react";

/**
 * Five sparkle glyphs on a 24px grid, smallest to fullest, in lucide's style (round caps): a seed dot,
 * a glint, an asterisk burst, a four-point star and, at the peak, lucide's `Sparkles`.
 */
const FRAMES = [
  <circle key="seed" cx="12" cy="12" r="1.25" fill="currentColor" />,
  <path key="glint" d="M12 8v8M8 12h8" />,
  <path key="burst" d="M12 5v14M5 12h14M8.82 8.82l6.36 6.36M15.18 8.82l-6.36 6.36" />,
  <path key="star" d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  <g key="sparkles">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
  </g>,
];
/** Ping-pong from the full sparkle down to the seed and back, so it breathes instead of jumping. */
const ORDER = [4, 3, 2, 1, 0, 1, 2, 3];
/** Per-frame dwell: quick through the middle, lingering on the seed and the peak. */
const HOLD_MS = [320, 150, 150, 150, 480];

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** "Working" mark for long AI tasks: a sparkle that swells and settles. Still (full sparkle) under reduced motion. */
export function WorkingSparkle({ className = "h-4 w-4" }: { className?: string }) {
  const [step, setStep] = useState(0);
  const still = reducedMotion();
  useEffect(() => {
    if (still) return;
    const timer = setTimeout(() => setStep((n) => (n + 1) % ORDER.length), HOLD_MS[ORDER[step]]);
    return () => clearTimeout(timer);
  }, [step, still]);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {FRAMES[still ? 4 : ORDER[step]]}
    </svg>
  );
}

/** Sky status panel for long tasks: the sparkle, half the panel's height, vertically centred with room on both sides. */
export function WorkingPanel({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950">
      <WorkingSparkle className="mx-3 h-8 w-8 flex-none text-brand-700" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}
