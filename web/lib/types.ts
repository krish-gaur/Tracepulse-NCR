/* Shared types mirroring the FastAPI contract */

export interface Kitchen {
  id: string; name: string; cluster: string;
  latitude: number; longitude: number; status: string;
}
export interface Batch {
  id: string; ingredient_name: string; mfg_date: string; expiry_date: string;
  quantity_kg: number; storage_temp_target_c: number; status: string;
}
export interface Warehouse { id: string; name: string; zone: string; capacity_sqft: number }
export interface Shipment { id: string; vehicle_plate: string; avg_temp_c: number; temp_monitored: boolean }
export interface ClusterInfo { cluster: string; kitchens: number; flagged: number; ids: string[] }

export interface NetworkSummary {
  suppliers: number;
  warehouses: Warehouse[];
  kitchens: Kitchen[];
  clusters: ClusterInfo[];
  batches: Batch[];
  shipments: Shipment[];
  orders_total: number;
  incident: { id: string; reason: string; severity: string } | null;
}

export interface Health {
  status: string;
  components: Record<string, { status: string; uptime_seconds?: number; mode?: string; model?: string }>;
  metrics: {
    total_batches_tracked: number; total_orders_indexed: number;
    total_nodes: number; total_relationships: number; active_incidents: number;
  };
}

export interface SeverityModel { score: number; class: string; formula: string }

export interface BlastResult {
  batch_id: string;
  incident: { id: string; reason: string; severity: string } | null;
  metrics: {
    affected_kitchens: number; affected_dishes: number; affected_orders: number;
    exposed_customers: number; gmv_at_risk_inr: number; clusters: string[];
    traversal_ms: number; hops: number;
  };
  status_counts: Record<string, number>;
  severity: SeverityModel;
  temp_breach: boolean;
  breach_shipment: string | null;
  orders: { order_id: string; status: string; total_inr: number; dish: string; kitchen: string | null; cluster: string | null; ordered_at: string }[];
  orders_returned: number;
  kitchens: Kitchen[];
  dishes: { id: string; name: string; grams_per_dish: number }[];
  shipments: Shipment[];
}

export interface TraceNode {
  id: string; label: string; hop: number; ring: number;
  name?: string; status?: string; count?: number; cluster?: string;
  avg_temp_c?: number; grams_per_dish?: number; [k: string]: unknown;
}
export interface TraceEdge { source: string; target: string; type: string; props: Record<string, unknown> }
export interface TraceGraph { batch_id: string; nodes: TraceNode[]; edges: TraceEdge[]; depth: number }

export interface ZoneDirective {
  zone: string; action: string; title: string; desc: string; directive: string;
  scope: { orders?: number; kitchens?: string[]; dishes_locked?: string[] };
}

export interface IncidentResult {
  incident_id: string; batch_id: string;
  severity_model: SeverityModel;
  status_counts: Record<string, number>;
  containment_boundary: ZoneDirective[];
  temp_breach: boolean;
}

export interface ReverseHop { entity: string; hop: number; id?: string; name?: string; [k: string]: unknown }
export interface ReverseResult {
  order_id: string; hops: ReverseHop[]; hops_count: number;
  verdict: { contaminated: boolean; root_cause_batch: string | null; root_cause_supplier: string | null; incident: unknown | null };
  traversal_ms: number;
}

export interface AiEvent {
  type: "mode" | "tool_start" | "tool_done" | "delta" | "done" | "error";
  mode?: string; model?: string;
  name?: string; args?: Record<string, unknown>; summary?: string;
  content?: string; message?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  tools?: { name: string; args?: Record<string, unknown>; status: "running" | "done"; summary?: string }[];
  streaming?: boolean;
}
