import type { CellValue, ResultRow, Suppression } from "../api";
import { formatCell, humanize, isSuppressedValue, looksLikeRatio } from "../lib/format";
import { HelpChip, ScrollCell } from "./ui";

const RULE_TEXT = {
  "<10": "Small-cell rule: counts below 10 (including 0) are shown as “<10” so that no individual can be singled out.",
  suppressed: "Small-cell rule: this percentage or mean is suppressed because it is based on fewer than 10 patients (numerator or denominator below 10).",
} as const;

function groupLabel(row: ResultRow, groupKeys: string[]): string {
  return groupKeys.length ? groupKeys.map((k) => String(row[k])).join(" | ") : "all";
}

/**
 * Released statistics. Group columns first, then metrics; "<10" and "suppressed" cells are
 * greyed and explained in a tooltip. Staff view passes `suppression` to show the exact rule.
 */
export function ResultTable({
  columns,
  groupKeys,
  rows,
  suppression,
  ratioColumns,
  caption,
}: {
  columns: string[];
  groupKeys: string[];
  rows: ResultRow[];
  suppression?: Suppression[];
  ratioColumns?: Set<string>;
  caption?: string;
}) {
  const metrics = columns.filter((c) => !groupKeys.includes(c));
  const oneDecimal = new Set(
    metrics.filter((c) => (ratioColumns ? ratioColumns.has(c) : looksLikeRatio(c, rows.map((r) => r[c] as CellValue)))),
  );
  const ruleFor = (row: ResultRow, metric: string) =>
    suppression?.find((s) => s.metric === metric && s.group === groupLabel(row, groupKeys))?.rule;

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50">
          <tr>
            {groupKeys.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                {humanize(c)}
              </th>
            ))}
            {metrics.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-700">
                {humanize(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {groupKeys.map((k) => (
                <th key={k} scope="row" className="px-3 py-1.5 text-left font-medium text-slate-900">
                  <ScrollCell max="max-w-[14rem]">{row[k] === null ? "–" : String(row[k])}</ScrollCell>
                </th>
              ))}
              {groupKeys.length === 0 && null}
              {metrics.map((m) => {
                const v = row[m] as CellValue;
                if (isSuppressedValue(v)) {
                  const rule = ruleFor(row, m);
                  const text = RULE_TEXT[v as "<10" | "suppressed"] + (rule ? ` Rule applied: ${rule}.` : "");
                  return (
                    <td key={m} className="whitespace-nowrap bg-slate-100 px-3 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1.5 italic text-slate-600">
                        {v}
                        <HelpChip label={`Why ${v}?`}>{text}</HelpChip>
                      </span>
                    </td>
                  );
                }
                return (
                  <td key={m} className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums text-slate-900">
                    {formatCell(v, oneDecimal.has(m))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
