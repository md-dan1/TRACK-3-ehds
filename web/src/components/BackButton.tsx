import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip } from "./Tooltip";
import { focusRing } from "./ui";

/** Blue icon-only back link placed left of a page title; the label is the accessible name and the tooltip. */
export function BackButton({ to, label }: { to: string; label: string }) {
  return (
    <Tooltip content={label}>
      <Link
        to={to}
        aria-label={label}
        className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-md bg-brand-700 text-white hover:bg-brand-800 ${focusRing}`}
      >
        <ArrowLeft className="h-5 w-5" aria-hidden />
      </Link>
    </Tooltip>
  );
}
