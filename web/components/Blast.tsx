"use client";
import { useEffect, useRef } from "react";
import type { BlastResult, NetworkSummary, TraceGraph } from "@/lib/types";
import { GraphEngine } from "@/lib/graphEngine";
import { inr } from "@/lib/api";

interface Props {
  summary: NetworkSummary | null;
  selectedBatch: string;
  onSelectBatch: (id: string) => void;
  onRunBlast: () => void;
  busy: boolean;
  blast: BlastResult | null;
  graph: TraceGraph | null;
  incidentActive: boolean;
  holdKitchens: string[];
  intercepted: boolean;
}

export default function Blast(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GraphEngine | null>(null);
  const emptyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    engineRef.current = new GraphEngine(canvasRef.current);
    return () => engineRef.current?.destroy();
  }, []);

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !p.graph) return;
    if (emptyRef.current) emptyRef.current.style.display = "none";
    e.setGraph(p.graph.nodes, p.graph.edges);
    e.resize();
    e.start();
  }, [p.graph]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    p.holdKitchens.forEach((id) => e.markKitchenHold(id));
    if (p.intercepted) e.markIntercepted();
  }, [p.holdKitchens, p.intercepted]);

  const batch = p.summary?.batches.find((b) => b.id === p.selectedBatch);
  const m = p.blast?.metrics;
  const sc = p.blast?.status_counts;
  const total = sc ? Math.max(1, (sc.PREPARING || 0) + (sc.OUT_FOR_DELIVERY || 0) + (sc.DELIVERED || 0) + (sc.INTERCEPTED || 0)) : 1;

  return (
    <div className="blast-layout">
      <div className="blast-controls panel">
        <div className="panel-head"><h3>Rapid Incident Console</h3><span className="tag danger">QA LAB</span></div>
        <p className="hint">Select a flagged ingredient batch, then initiate a downstream blast-radius traversal across the full supply graph.</p>

        <label className="field-label">BATCH ID</label>
        <div className="batch-picker">
          {p.summary?.batches.map((b) => {
            const flagged = b.status !== "CLEAR";
            return (
              <div
                key={b.id}
                className={`batch-opt ${b.id === p.selectedBatch ? "selected" : ""} ${flagged ? "" : "clean"}`}
                onClick={() => p.onSelectBatch(b.id)}
              >
                <span className={`bo-dot ${b.status === "QUARANTINED" ? "flagged" : b.status === "SUSPECT" ? "suspect" : "clear"}`}></span>
                <div className="bo-main">
                  <div className="bo-id">{b.id}</div>
                  <div className="bo-name">{b.ingredient_name} · {b.quantity_kg} kg</div>
                </div>
                <span className={`bo-status ${b.status === "CLEAR" ? "c" : b.status === "QUARANTINED" ? "q" : "s"}`}>{b.status}</span>
              </div>
            );
          })}
        </div>

        {p.incidentActive && p.blast && (
          <div className="incident-banner">
            <div className="ib-icon">⚠</div>
            <div>
              <div className="ib-title">FSSAI LAB ALERT — INC-2026-003</div>
              <div className="ib-sub">{batch?.ingredient_name} ({p.blast.batch_id}) positive: Listeria monocytogenes · severity {p.blast.severity.class}</div>
            </div>
          </div>
        )}

        <button className="btn-primary" onClick={p.onRunBlast} disabled={p.busy}>
          <span className="btn-icon">{p.busy ? "⟳" : "◎"}</span> {p.busy ? "TRAVERSING GRAPH…" : "INITIATE BLAST RADIUS ANALYSIS"}
        </button>

        {m && (
          <div className="latency-box">
            <div className="lat-num">{m.traversal_ms.toFixed(1)} ms</div>
            <div className="lat-cap">graph traversal · {m.hops} hops · {m.affected_kitchens} kitchens · {m.affected_orders} orders</div>
            <div className="lat-bar"><div className="lat-fill" style={{ width: `${Math.max(2.5, Math.min(100, (m.traversal_ms / 200) * 100))}%` }}></div></div>
            <div className="lat-note">vs 45–180s relational 8-table join</div>
          </div>
        )}

        {m && sc && (
          <div className="blast-kpis">
            <div className="bkpi"><div className="bkpi-v">{m.affected_orders}</div><div className="bkpi-l">Orders hit</div></div>
            <div className="bkpi"><div className="bkpi-v">{m.affected_kitchens}</div><div className="bkpi-l">Kitchens</div></div>
            <div className="bkpi"><div className="bkpi-v">{m.exposed_customers}</div><div className="bkpi-l">Consumers</div></div>
            <div className="bkpi danger"><div className="bkpi-v">{inr(m.gmv_at_risk_inr)}</div><div className="bkpi-l">GMV at risk</div></div>
          </div>
        )}

        {m && sc && (
          <div className="status-dist">
            <div className="sd-title">ORDER DISPOSITION</div>
            <div className="sd-bar">
              <div className="sd-seg seg-prep" style={{ width: `${((sc.PREPARING || 0) / total) * 100}%` }}></div>
              <div className="sd-seg seg-transit" style={{ width: `${((sc.OUT_FOR_DELIVERY || 0) / total) * 100}%` }}></div>
              <div className="sd-seg seg-deliv" style={{ width: `${(((sc.DELIVERED || 0) + (sc.INTERCEPTED || 0)) / total) * 100}%` }}></div>
            </div>
            <div className="sd-legend">
              <span className="sd-l"><i style={{ background: "#fbbf24" }}></i>PREPARING {sc.PREPARING || 0}</span>
              <span className="sd-l"><i style={{ background: "#fb923c" }}></i>IN TRANSIT {sc.OUT_FOR_DELIVERY || 0}</span>
              <span className="sd-l"><i style={{ background: "#ef4444" }}></i>DELIVERED {sc.DELIVERED || 0}</span>
              {(sc.INTERCEPTED || 0) > 0 && <span className="sd-l"><i style={{ background: "#22d3ee" }}></i>INTERCEPTED {sc.INTERCEPTED}</span>}
            </div>
          </div>
        )}

        {p.blast?.temp_breach && (
          <div className="breach-note">
            <b>⚠ COLD-CHAIN BREACH CORRELATED:</b> Shipment <b>{p.blast.breach_shipment}</b> recorded <b>9.4°C</b> (limit 8°C).
            Co-stored batches <b>BATCH-CRM-1150</b> (Malai Cream) and <b>BATCH-BUT-1204</b> (White Butter) auto-marked <b>SUSPECT</b>.
            Severity multiplier ×1.5 applied. Ask the <b>AI Copilot</b> for the full cross-contamination analysis.
          </div>
        )}
      </div>

      <div className="blast-graph panel">
        <div className="panel-head">
          <h3>Downstream Propagation Graph</h3>
          <span className="tag">{p.graph ? `${p.graph.nodes.length} NODES · ${p.graph.edges.length} EDGES` : "IDLE"}</span>
        </div>
        <div className="graph-wrap">
          <canvas ref={canvasRef} id="graph-canvas"></canvas>
          <div className="graph-empty" ref={emptyRef}>
            <div className="ge-icon">⬡</div>
            <div>Awaiting traversal</div>
            <div className="ge-sub">Initiate blast radius to render the contamination tree</div>
          </div>
          <div className="graph-legend">
            <span className="lg-item"><i style={{ background: "#ef4444" }}></i>Batch</span>
            <span className="lg-item"><i style={{ background: "#a78bfa" }}></i>Warehouse</span>
            <span className="lg-item"><i style={{ background: "#fb923c" }}></i>Shipment</span>
            <span className="lg-item"><i style={{ background: "#34d399" }}></i>Kitchen</span>
            <span className="lg-item"><i style={{ background: "#fbbf24" }}></i>Dish</span>
            <span className="lg-item"><i style={{ background: "#60a5fa" }}></i>Orders</span>
          </div>
        </div>

        {p.blast && p.blast.orders.length > 0 && (
          <div className="affected-table-wrap">
            <div className="panel-head"><h3>Affected Order Ledger</h3><span className="tag">{m?.affected_orders} ORDERS · showing {p.blast.orders_returned}</span></div>
            <table className="ledger">
              <thead><tr><th>ORDER</th><th>DISH</th><th>KITCHEN</th><th>STATUS</th><th>GMV</th></tr></thead>
              <tbody>
                {p.blast.orders.slice(0, 40).map((o) => (
                  <tr key={o.order_id}>
                    <td>{o.order_id}</td>
                    <td>{o.dish}</td>
                    <td>{o.kitchen || "—"}</td>
                    <td><span className={`st ${o.status}`}>{o.status.replace(/_/g, " ")}</span></td>
                    <td>{inr(o.total_inr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
