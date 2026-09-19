"use client";
import { useEffect, useState } from "react";
import type { Health, NetworkSummary } from "@/lib/types";

interface FeedItem { sev: string; html: string; time: string }

const SEED_FEED: FeedItem[] = [
  { sev: "ok", html: "<b>SH-212</b> delivered to Okhla Phase-2 · dock temp 5.9°C · within range", time: "09:00" },
  { sev: "info", html: "<b>WH-KUN-01</b> intake verified — 5 batches, FSSAI licenses matched", time: "08:12" },
  { sev: "ok", html: "Cold-chain telemetry nominal across 4 reefer vehicles", time: "07:40" },
  { sev: "info", html: "Ingestion job complete — orders indexed via idempotent MERGE", time: "07:05" },
];

export default function Dashboard({ health, summary }: { health: Health | null; summary: NetworkSummary | null }) {
  const [feed, setFeed] = useState<FeedItem[]>(SEED_FEED);

  // poll the backend audit stream
  useEffect(() => {
    const known = new Set<string>();
    const poll = async () => {
      try {
        const res = await fetch("/api/v1/events", { cache: "no-store" });
        const { events } = (await res.json()) as { events: { ts: string; code: string; detail: string }[] };
        const fresh: FeedItem[] = [];
        events.forEach((e) => {
          const key = e.ts + e.code;
          if (known.has(key)) return;
          known.add(key);
          const sev = e.code.includes("FLAG") || e.code.includes("NOTIFY") ? "crit"
            : e.code.includes("CONTAINMENT") || e.code.includes("COPILOT") ? "warn"
            : e.code.includes("REPORT") ? "warn" : "info";
          fresh.unshift({ sev, html: `<b>${e.code}</b> — ${e.detail}`, time: new Date(e.ts).toLocaleTimeString("en-IN", { hour12: false }) });
        });
        if (fresh.length) setFeed((prev) => [...fresh.slice(-6), ...prev].slice(0, 30));
      } catch { /* backend warming up */ }
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, []);

  if (!health || !summary) {
    return (
      <div className="panel" style={{ textAlign: "center", padding: "60px", color: "var(--ink-faint)" }}>
        Connecting to TracePulse API…
      </div>
    );
  }

  const m = health.metrics;
  const kitchensActive = summary.kitchens.filter((k) => k.status === "OPERATIONAL").length;

  return (
    <>
      <div className="kpi-row">
        <Kpi label="NETWORK STATUS" value={summary.incident ? "WARNING" : "SAFE"} foot={summary.incident ? `incident ${summary.incident.id} live` : "99.8% batches clear"} accent={!!summary.incident} />
        <Kpi label="NCR KITCHENS ACTIVE" value={`${kitchensActive}/${summary.kitchens.length}`} foot="cloud kitchens" />
        <Kpi label="BATCHES TRACKED" value={String(m.total_batches_tracked)} foot="ingredient lots" />
        <Kpi label="ORDERS INDEXED" value={m.total_orders_indexed.toLocaleString("en-IN")} foot="today · Delhi NCR" />
        <Kpi label="ACTIVE INCIDENTS" value={String(m.active_incidents)} foot={m.active_incidents ? "INC-2026-003" : "quarantine queue empty"} accent={m.active_incidents > 0} />
      </div>

      <div className="dash-grid">
        <div className="panel cluster-panel">
          <div className="panel-head"><h3>Delhi NCR Cluster Segmentation</h3><span className="tag">GEO-ZONES</span></div>
          <div className="cluster-cards">
            {summary.clusters.map((c) => {
              const kitchens = summary.kitchens.filter((k) => k.cluster === c.cluster);
              const flagged = kitchens.filter((k) => k.status !== "OPERATIONAL");
              const badge = flagged.length ? (flagged.length > 1 ? "bad" : "warn") : "ok";
              return (
                <div className="cluster-card" key={c.cluster}>
                  <div className="cc-top">
                    <span className="cc-name">{c.cluster.replace(/_/g, " ")}</span>
                    <span className={`cc-badge ${badge}`}>{flagged.length ? `${flagged.length} FLAGGED` : "OPERATIONAL"}</span>
                  </div>
                  <div className="cc-meta"><span>{c.kitchens} cloud kitchens</span><span>zone coverage · live KDS</span></div>
                  <div className="cc-kitchens">
                    {kitchens.map((k) => (
                      <span key={k.id} className={`cc-k ${k.status !== "OPERATIONAL" ? "flagged" : ""}`}>{k.id.replace("KIT-", "")}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="panel-head" style={{ marginTop: 18 }}><h3>Supplier & Warehouse Mesh</h3><span className="tag">UPSTREAM</span></div>
          <div className="mesh-list">
            {summary.warehouses.map((w) => (
              <div className="mesh-row" key={w.id}>
                <div className="mesh-ico" style={{ background: "rgba(167,139,250,.14)", color: "#a78bfa" }}>▤</div>
                <div className="mesh-name">{w.name}<div className="mesh-sub">{w.id} · {w.zone} · {(w.capacity_sqft / 1000).toFixed(0)}k sqft cold storage</div></div>
              </div>
            ))}
            {summary.batches.slice(0, 5).map((b) => {
              const col = b.status === "CLEAR" ? "52,211,153" : b.status === "QUARANTINED" ? "239,68,68" : "251,191,36";
              return (
                <div className="mesh-row" key={b.id}>
                  <div className="mesh-ico" style={{ background: `rgba(${col},.13)`, color: `rgb(${col})` }}>☣</div>
                  <div className="mesh-name">{b.ingredient_name}<div className="mesh-sub">{b.id} · mfg {b.mfg_date} · {b.quantity_kg} kg · {b.storage_temp_target_c}°C target</div></div>
                  <span className={`bo-status ${b.status === "CLEAR" ? "c" : b.status === "QUARANTINED" ? "q" : "s"}`}>{b.status}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel feed-panel">
          <div className="panel-head"><h3>Live Incident Feed</h3><span className="live-tag"><span className="pulse-dot"></span>LIVE</span></div>
          <div className="incident-feed">
            {feed.map((f, i) => (
              <div key={i} className={`feed-item ${f.sev}`}>
                <span className="feed-time">{f.time}</span>
                <div className="feed-body" dangerouslySetInnerHTML={{ __html: f.html }} />
              </div>
            ))}
          </div>

          <div className="panel-head" style={{ marginTop: 14 }}><h3>System Telemetry</h3><span className="tag">API</span></div>
          <div className="telemetry">
            <div className="tele-tile"><div className="tele-k">GRAPH NODES</div><div className="tele-v c">{m.total_nodes.toLocaleString()}</div></div>
            <div className="tele-tile"><div className="tele-k">RELATIONSHIPS</div><div className="tele-v c">{m.total_relationships.toLocaleString()}</div></div>
            <div className="tele-tile"><div className="tele-k">AI COPILOT</div><div className="tele-v a" style={{ fontSize: "10.5px", paddingTop: 5 }}>{health.components.ai_copilot?.mode === "llm" ? "LLM TOOL-USE" : "RULES ENGINE"}</div></div>
            <div className="tele-tile"><div className="tele-k">ENGINE MODE</div><div className="tele-v g" style={{ fontSize: "10.5px", paddingTop: 5 }}>INDEX-FREE ADJACENCY</div></div>
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({ label, value, foot, accent }: { label: string; value: string; foot: string; accent?: boolean }) {
  return (
    <div className={`kpi ${accent ? "kpi-accent" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}
