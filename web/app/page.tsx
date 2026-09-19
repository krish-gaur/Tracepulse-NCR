"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlastResult, Health, IncidentResult, NetworkSummary, TraceGraph } from "@/lib/types";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import Toasts from "@/components/Toasts";
import TopBar from "@/components/TopBar";
import Dashboard from "@/components/Dashboard";
import Blast from "@/components/Blast";
import Containment from "@/components/Containment";
import Reverse from "@/components/Reverse";
import Copilot from "@/components/Copilot";

const TABS = [
  { id: "dashboard", n: "01", label: "Operations Overview" },
  { id: "blast", n: "02", label: "Blast Radius" },
  { id: "containment", n: "03", label: "Containment" },
  { id: "reverse", n: "04", label: "Reverse Trace" },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [tab, setTab] = useState("dashboard");
  const [health, setHealth] = useState<Health | null>(null);
  const [summary, setSummary] = useState<NetworkSummary | null>(null);
  const [selectedBatch, setSelectedBatch] = useState("BATCH-PAN-1042");
  const [incident, setIncident] = useState<IncidentResult | null>(null);
  const [blast, setBlast] = useState<BlastResult | null>(null);
  const [graph, setGraph] = useState<TraceGraph | null>(null);
  const [zonesDone, setZonesDone] = useState<Record<string, unknown>>({});
  const [executing, setExecuting] = useState<string | null>(null);
  const [netAlert, setNetAlert] = useState(false);
  const [blastBusy, setBlastBusy] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const demoCancel = useRef(false);

  // ---- boot ----
  const loadAll = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api.health(), api.summary()]);
      setHealth(h);
      setSummary(s);
    } catch {
      toast("<b>API offline.</b> Start FastAPI: <code>uvicorn app:app</code>", "err", 12000);
    }
  }, []);
  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshSummary = useCallback(() => {
    api.summary().then(setSummary).catch(() => {});
  }, []);

  // ---- blast radius ----
  const runBlast = useCallback(async (batchId?: string, opts?: { silent?: boolean }) => {
    const id = batchId || selectedBatch;
    const batch = summary?.batches.find((b) => b.id === id);
    setTab("blast");
    setBlastBusy(true);
    try {
      if (batch && batch.status !== "CLEAR") {
        const inc = await api.flagIncident(id);
        setIncident(inc);
        setNetAlert(true);
        setZonesDone({});
      } else {
        setIncident(null);
        setNetAlert(false);
      }
      const [b, g] = await Promise.all([api.blast(id), api.traceGraph(id)]);
      setBlast(b);
      setGraph(g);
      if (!opts?.silent) {
        toast(
          `<b>Blast radius computed in ${b.metrics.traversal_ms.toFixed(1)} ms.</b> ${b.metrics.affected_orders} orders downstream of ${id}.`,
          b.metrics.affected_orders ? "err" : "ok",
        );
      }
    } catch (e) {
      toast(`<b>Traversal failed:</b> ${(e as Error).message}`, "err");
    } finally {
      setBlastBusy(false);
    }
  }, [selectedBatch, summary]);

  // ---- containment ----
  const executeZone = useCallback(async (action: string, opts?: { silent?: boolean }) => {
    if (!incident || zonesDone[action]) return;
    setExecuting(action);
    try {
      const zone = incident.containment_boundary.find((b) => b.zone.startsWith(
        action === "FREEZE_PREP" ? "ZONE1" : action === "INTERCEPT_DISPATCH" ? "ZONE2" : "ZONE3"));
      const res = await api.quarantine(incident.incident_id, action, zone?.scope.kitchens || []);
      setZonesDone((prev) => ({ ...prev, [action]: res }));
      refreshSummary();
      if (!opts?.silent) {
        if (action === "FREEZE_PREP") toast(`<b>KDS locks dispatched to ${(res.locked_kitchens as string[]).length} kitchens.</b> Biryani, dal & breads remain LIVE.`, "ok");
        if (action === "INTERCEPT_DISPATCH") toast(`<b>${res.orders_intercepted} riders intercepted.</b> Orders flipped to INTERCEPTED before handover.`, "ok");
        if (action === "NOTIFY_CONSUMER") toast(`<b>${res.notifications_queued} consumer alerts queued.</b>`, "info");
      }
    } catch (e) {
      toast(`<b>Action failed:</b> ${(e as Error).message}`, "err");
    } finally {
      setExecuting(null);
    }
  }, [incident, zonesDone, refreshSummary]);

  // ---- one-click 4-minute judging demo ----
  const runDemo = useCallback(async () => {
    if (demoRunning) { demoCancel.current = true; return; }
    setDemoRunning(true);
    demoCancel.current = false;
    const wait = async (ms: number) => { await sleep(ms); if (demoCancel.current) throw new Error("CANCEL"); };
    try {
      setTab("dashboard");
      toast("<b>Act 1 — Saturday 14:00, peak lunch.</b> 750k meals/day flow through Delhi NCR cloud kitchens. Network nominal.", "info", 4200);
      await wait(3800);

      setNetAlert(true);
      toast("<b>⚠ FSSAI LAB ALERT:</b> Batch B-1042 Malai Paneer positive for <b>Listeria monocytogenes</b>. Initiating quarantine protocol.", "err", 5000);
      await wait(3200);

      setSelectedBatch("BATCH-PAN-1042");
      await runBlast("BATCH-PAN-1042", { silent: true });
      toast("<b>Blast radius complete.</b> 6 kitchens · 342 orders · 489 consumers · ₹1,24,000 GMV at risk — in milliseconds, not hours.", "err", 6000);
      await wait(6200);

      setTab("containment");
      await wait(2600);
      await executeZone("FREEZE_PREP", { silent: true }); await wait(1900);
      await executeZone("INTERCEPT_DISPATCH", { silent: true }); await wait(1900);
      await executeZone("NOTIFY_CONSUMER", { silent: true }); await wait(2400);

      setTab("reverse");
      window.dispatchEvent(new CustomEvent("tp:trace", { detail: { orderId: "ORD-8660" } }));
      await wait(6200);

      toast("<b>✓ DEMO COMPLETE.</b> Hours of relational-database panic → milliseconds of surgical, graph-native containment. Ask the AI Copilot anything about this incident.", "ok", 10000);
    } catch { /* cancelled */ }
    finally {
      setDemoRunning(false);
      demoCancel.current = false;
    }
  }, [demoRunning, runBlast, executeZone]);

  const holdKitchens = ((zonesDone.FREEZE_PREP as { locked_kitchens?: string[] } | undefined)?.locked_kitchens) || [];
  const intercepted = !!zonesDone.INTERCEPT_DISPATCH;

  return (
    <>
      <div id="bgfx">
        <div className="grid-overlay"></div>
        <div className="scanline"></div>
        <div className="glow glow-a"></div>
        <div className="glow glow-b"></div>
      </div>

      <TopBar netAlert={netAlert} health={health} />

      <nav id="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            <span className="ti">{t.n}</span>{t.label}
          </button>
        ))}
      </nav>

      <main id="main">
        <div className={`view ${tab === "dashboard" ? "active" : ""}`}>
          <Dashboard health={health} summary={summary} />
        </div>
        <div className={`view ${tab === "blast" ? "active" : ""}`}>
          <Blast
            summary={summary} selectedBatch={selectedBatch} onSelectBatch={setSelectedBatch}
            onRunBlast={() => runBlast()} busy={blastBusy} blast={blast} graph={graph}
            incidentActive={!!incident} holdKitchens={holdKitchens} intercepted={intercepted}
          />
        </div>
        <div className={`view ${tab === "containment" ? "active" : ""}`}>
          <Containment incident={incident} zonesDone={zonesDone} executing={executing} onExecute={executeZone} />
        </div>
        <div className={`view ${tab === "reverse" ? "active" : ""}`}>
          <Reverse />
        </div>
      </main>

      <button id="btn-autodemo" onClick={runDemo} className={demoRunning ? "running" : ""}>
        {demoRunning ? "■ STOP DEMO" : "▶ AUTO-RUN 4-MIN DEMO"}
      </button>

      <button className="copilot-fab" onClick={() => setCopilotOpen(true)}>
        <span className="spark">◈</span> AI COPILOT
      </button>
      <Copilot open={copilotOpen} onClose={() => setCopilotOpen(false)} />

      <Toasts />

      <footer id="footer">
        <span>TracePulse NCR · Neo4j-style index-free adjacency · FSS Act §28 trace-ready · Next.js + FastAPI</span>
        <span>copilot = LLM orchestration + deterministic graph math</span>
      </footer>
    </>
  );
}
