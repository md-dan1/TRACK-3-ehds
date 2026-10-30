import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { DecisionText } from "../../components/DecisionText";
import { StatusBadge } from "../../components/StatusBadge";
import { EmptyState, ErrorBox, ScrollCell, Spinner, focusRing } from "../../components/ui";
import { fmtDateTime } from "../../lib/format";

export function MyRequestsPage() {
  const navigate = useNavigate();
  // The server returns only the signed-in applicant's own requests.
  const q = useQuery({
    queryKey: ["requests"],
    queryFn: api.listRequests,
    refetchInterval: (query) => (query.state.data?.some((r) => r.status === "running") ? 2000 : 10000),
  });
  const rows = q.data ?? [];

  return (
    <div>
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorBox title="Could not load requests" error={q.error} />}
      {q.data && rows.length === 0 && (
        <EmptyState>
          No requests yet.{" "}
          <Link to="/apply" className="font-medium text-brand-700 underline">
            Submit your first request
          </Link>
          .
        </EmptyState>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Reference", "Question", "Status", "Type", "Submitted"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-slate-700">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const rejected = r.status === "done" && r.decision === "REJECT";
                return (
                <tr key={r.run_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/requests/${r.run_id}`)}>
                  <td className="px-3 py-2">
                    <Link to={`/requests/${r.run_id}`} className={`rounded font-mono font-medium text-brand-700 hover:underline ${focusRing}`} onClick={(e) => e.stopPropagation()}>
                      {r.reference ?? r.run_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-800">
                    <ScrollCell max="max-w-[32rem]">{r.payload.question}</ScrollCell>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={rejected ? "rejected" : r.status} />
                  </td>
                  <td className="px-3 py-2">
                    {!rejected && <DecisionText decision={r.decision} />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{fmtDateTime(r.created_at)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
