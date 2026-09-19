"use client";
import { useEffect, useState } from "react";
import type { ReverseResult } from "@/lib/types";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

const ENT_META: Record<string, { icon: string; color: string; name: (n: Record<string, unknown>) => string }> = {
  Order: { icon: "🧾", color: "96,165,250", name: (n) => String(n.id) },
  Dish: { icon: "◍", color: "251,191,36", name: (n) => String(n.name) },
  Kitchen: { icon: "⌂", color: "52,211,153", name: (n) => String(n.name) },
  Shipment: { icon: "➤", color: "251,146,60", name: (n) => `${n.id} · ${n.vehicle_plate}` },
  Warehouse: { icon: "▤", color: "167,139,250", name: (n) => String(n.name) },
  Batch: { icon: "☣", color: "239,68,68", name: (n) => `${n.id} — ${n.ingredient_name}` },
  Supplier: { icon: "⬢", color: "34,211,238", name: (n) => String(n.name) },
};

const CHIPS = [
  { id: "ORD-8600", note: "paneer · prep" },
  { id: "ORD-8660", note: "paneer · transit" },
  { id: "ORD-8900", note: "paneer · delivered" },
  { id: "ORD-9305", note: "biryani · clean" },
];

export default function Reverse() {
  const [input, setInput] = useState("ORD-8660");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReverseResult | null>(null);
  const [shown, setShown] = useState(0);

  const run = async (orderId?: string) => {
    const id = (orderId || input).trim();
    if (!id) return toast("Enter an order ID.", "err");
    setInput(id);
    setBusy(true);
    setResult(null);
    setShown(0);
    try {
      const res = await api.reverse(id);
      setResult(res);
      // staggered hop reveal
      res.hops.forEach((_, i) => setTimeout(() => setShown(i + 1), 240 * (i + 1)));
      const v = res.verdict;
      setTimeout(() => {
        if (v.contaminated) toast(`<b>Root cause found in ${res.traversal_ms.toFixed(1)} ms:</b> ${v.root_cause_batch} ← ${v.root_cause_supplier}`, "err");
        else toast(`<b>Order ${id} verified clean</b> in ${res.traversal_ms.toFixed(1)} ms.`, "ok");
      }, 240 * (res.hops_count + 1));
    } catch (e) {
      toast(`<b>Reverse trace failed:</b> ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  // auto-demo hook
  useEffect(() => {
    const onTrace = (e: Event) => run((e as CustomEvent).detail.orderId);
    window.addEventListener("tp:trace", onTrace);
    return () => window.removeEventListener("tp:trace", onTrace);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="reverse-layout">
      <div className="panel reverse-controls">
        <div className="panel-head"><h3>Reverse Root-Cause Trace</h3><span className="tag">CUSTOMER → FARM</span></div>
        <p className="hint">A consumer reports illness. Enter their order ID to traverse upstream and pinpoint the exact source batch, warehouse, and supplier.</p>
        <label className="field-label">ORDER ID</label>
        <div className="order-input-row">
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="e.g. ORD-8660" />
          <button className="btn-primary" onClick={() => run()} disabled={busy}>
            <span className="btn-icon">{busy ? "⟳" : "⇄"}</span> {busy ? "TRACING…" : "TRACE"}
          </button>
        </div>
        <div className="order-chips">
          {CHIPS.map((c) => (
            <span key={c.id} className="order-chip" onClick={() => run(c.id)}>
              {c.id} <span style={{ opacity: 0.55 }}>· {c.note}</span>
            </span>
          ))}
        </div>

        {result && (
          <div className="rev-latency">
            <span className="rl-num">{result.traversal_ms.toFixed(1)} ms</span> upstream traversal · {result.hops_count} hops · customer → supplier
          </div>
        )}
        {result && shown > result.hops_count && (
          result.verdict.contaminated ? (
            <div className="rev-verdict bad">
              <b>⚠ ROOT CAUSE ISOLATED:</b> {result.verdict.root_cause_batch} from <b>{result.verdict.root_cause_supplier}</b>.
              Incident <b>INC-2026-003</b> already active — containment boundary in effect. FSSAI §28 chain-of-custody export ready.
            </div>
          ) : (
            <div className="rev-verdict good">
              <b>✓ PATH CLEAN:</b> no active incident on any upstream batch for this order.
              Provenance verified to <b>{result.verdict.root_cause_supplier}</b>.
            </div>
          )
        )}
      </div>

      <div className="panel reverse-path">
        <div className="panel-head">
          <h3>Chain of Custody</h3>
          <span className="tag" style={{ color: result ? (result.verdict.contaminated ? "var(--red-soft)" : "var(--green)") : undefined }}>
            {result ? (result.verdict.contaminated ? "ROOT CAUSE FOUND" : "PATH CLEAN") : "IDLE"}
          </span>
        </div>
        <div className="path-track">
          {!result && (
            <div className="graph-empty" style={{ position: "relative", minHeight: 380 }}>
              <div className="ge-icon">⇄</div>
              <div>No trace run yet</div>
              <div className="ge-sub">Enter an order ID to reconstruct the farm-to-fork path</div>
            </div>
          )}
          {result?.hops.map((hop, i) => {
            const meta = ENT_META[hop.entity] || { icon: "•", color: "148,163,184", name: (n: Record<string, unknown>) => String(n.id) };
            const flagged = hop.entity === "Batch" && hop.status !== "CLEAR";
            const metaLines: string[] = [];
            if (hop.entity === "Order") metaLines.push(`status ${hop.status} · ₹${Number(hop.total_inr).toLocaleString("en-IN")} · ${String(hop.ordered_at).slice(11, 16)} UTC`);
            if (hop.entity === "Dish") metaLines.push(`${hop.category} · shelf life ${hop.shelf_life_hours}h`);
            if (hop.entity === "Kitchen") metaLines.push(`${hop.cluster} cluster · ${hop.status}`);
            if (hop.entity === "Shipment") metaLines.push(`reefer ${hop.vehicle_plate} · avg ${hop.avg_temp_c}°C${Number(hop.avg_temp_c) > 8 ? " ⚠ BREACH" : ""}`);
            if (hop.entity === "Warehouse") metaLines.push(`${hop.zone} · ${Number(hop.capacity_sqft).toLocaleString()} sqft`);
            if (hop.entity === "Batch") metaLines.push(`mfg ${hop.mfg_date} · exp ${hop.expiry_date} · ${hop.quantity_kg} kg · ${hop.status}`);
            if (hop.entity === "Supplier") metaLines.push(`${hop.location} · FSSAI ${hop.fssai_license}`);
            return (
              <div key={i}>
                {i > 0 && <div className="path-connector"></div>}
                <div className={`path-node ${flagged ? "flagged" : ""} ${shown > i ? "shown" : ""}`}>
                  <div className="pn-ico" style={{ background: `rgba(${meta.color},.13)`, color: `rgb(${meta.color})` }}>{meta.icon}</div>
                  <div className="pn-body">
                    <div className="pn-ent">{hop.entity.toUpperCase()} · HOP {i}</div>
                    <div className="pn-name">{meta.name(hop as Record<string, unknown>)}</div>
                    <div className="pn-meta">{metaLines.join(" · ")}</div>
                  </div>
                  <div className="pn-hop">{i === result.hops_count - 1 ? "◉ ROOT" : ""}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
