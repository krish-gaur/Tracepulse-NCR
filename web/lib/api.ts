/* API client — all calls go through the Next.js rewrite proxy (single origin) */
import type {
  BlastResult, Health, IncidentResult, NetworkSummary, ReverseResult, TraceGraph,
} from "./types";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/api/v1/health"),
  summary: () => req<NetworkSummary>("/api/v1/network/summary"),
  blast: (batchId: string) => req<BlastResult>(`/api/v1/batches/${batchId}/blast-radius`),
  traceGraph: (batchId: string, depth = 5) => req<TraceGraph>(`/api/v1/batches/${batchId}/trace-graph?depth=${depth}`),
  reverse: (orderId: string) => req<ReverseResult>(`/api/v1/orders/${orderId}/reverse-trace`),
  flagIncident: (batchId: string) =>
    req<IncidentResult>("/api/v1/incidents", {
      method: "POST",
      body: JSON.stringify({ batch_id: batchId, reason: "Listeria monocytogenes", severity: "CRITICAL", operator_id: "QA-OFFICER-07" }),
    }),
  quarantine: (incidentId: string, action: string, kitchenIds: string[] = []) =>
    req<Record<string, unknown>>(`/api/v1/incidents/${incidentId}/quarantine`, {
      method: "POST",
      body: JSON.stringify({ action, target_kitchen_ids: kitchenIds }),
    }),
  aiStatus: () => req<{ mode: string; model: string }>("/api/v1/ai/status"),
  aiReport: (batchId: string) =>
    req<{ markdown: string; generated_by: string }>("/api/v1/ai/report", {
      method: "POST", body: JSON.stringify({ batch_id: batchId }),
    }),
};

export const inr = (v: number) =>
  "₹" + Math.round(v).toLocaleString("en-IN");
