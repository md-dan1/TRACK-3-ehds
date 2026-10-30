import type { ReactNode } from "react";
import type { Permit } from "../api";
import { fmtDateTime, humanize } from "../lib/format";
import { DefinitionList } from "./ui";

/** The permit's facts as a definition list: dates, cohort size, rows copied per record type. */
export function PermitDetails({ permit, cohortSize, staff = false }: { permit: Permit; cohortSize?: number; staff?: boolean }) {
  const copied = Object.keys(permit.tables).filter((t) => t !== "cohort");
  const size = cohortSize ?? permit.cohort_size ?? permit.tables.cohort;
  const items: [ReactNode, ReactNode][] = [
    ["Issued", fmtDateTime(permit.issued)],
    ["Valid until", fmtDateTime(permit.valid_until)],
    ["Cohort size", <span className="tabular-nums">{size?.toLocaleString("en-GB") ?? "–"} patients</span>],
    // one row per copied record type, e.g. "Number of conditions"
    ...copied.map((t): [ReactNode, ReactNode] => [`Number of ${humanize(t).toLowerCase()}`, <span className="tabular-nums">{permit.tables[t].toLocaleString("en-GB")}</span>]),
  ];
  if (permit.observation_loinc?.length) items.push(["Observations (LOINC)", <span className="font-mono text-xs">{permit.observation_loinc.join(", ")}</span>]);
  if (staff && permit.session_id) items.push(["SPE session", <span className="font-mono text-xs">{permit.session_id}</span>]);
  if (staff && permit.not_copied?.length) items.push(["Not copied", <span className="text-slate-700">{permit.not_copied.map(humanize).join(", ")}</span>]);
  return <DefinitionList items={items} />;
}
