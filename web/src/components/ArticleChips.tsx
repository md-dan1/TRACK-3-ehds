import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api, type ArticleRef } from "../api";
import { Tooltip } from "./Tooltip";
import { focusRing } from "./ui";

const FALLBACK_EURLEX = "https://eur-lex.europa.eu/eli/reg/2025/327/oj/eng";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity });
}

/** Cited articles as chips: id + title tooltip, linking to the regulation on EUR-Lex. */
export function ArticleChips({ articles, ids, vertical = false }: { articles?: ArticleRef[]; ids?: string[]; vertical?: boolean }) {
  const meta = useMeta();
  const eurlex = meta.data?.eurlex ?? FALLBACK_EURLEX;
  const list: ArticleRef[] = articles ?? (ids ?? []).map((id) => ({ id, title: meta.data?.articles[id] ?? "" }));
  return (
    <ul className={vertical ? "flex flex-col items-start gap-2" : "flex flex-wrap gap-2"} aria-label="Cited articles">
      {list.map((a) => (
        <li key={a.id} className="min-w-0 max-w-full">
          <Tooltip content={a.title ? `Art. ${a.id}: ${a.title}` : `Art. ${a.id}`} className="max-w-full">
            <a
              href={`${eurlex}#art_${a.id}`}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-100 hover:bg-brand-50 hover:underline ${focusRing}`}
            >
              <span className="shrink-0 whitespace-nowrap">Art. {a.id}</span>
              {a.title && <span className={`hidden min-w-0 truncate font-normal text-slate-700 sm:inline ${vertical ? "" : "max-w-[16rem]"}`}>{a.title}</span>}
              <ExternalLink className="h-3 w-3" aria-hidden />
              <span className="sr-only">(opens EUR-Lex in a new tab)</span>
            </a>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
