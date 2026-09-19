/* ============================================================
   TracePulse NCR — Application Layer
   Wires the REST contract to the mission-control UI.
   Includes the one-click 4-minute judging demo sequencer.
   ============================================================ */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const INR = (v) => "₹" + Math.round(v).toLocaleString("en-IN");

const state = {
  summary: null, health: null,
  batches: [], selectedBatch: "BATCH-PAN-1042",
  incident: null,           // POST /incidents response
  blast: null,              // GET blast-radius response
  graphPayload: null,
  zonesDone: {},
  demoRunning: false, demoCancel: false,
  tracedOrders: [],
};

let engine = null;

/* ---------------- api helper ---------------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || res.statusText);
  }
  return res.json();
}

/* ---------------- toast ---------------- */
function toast(msg, kind = "info", ttl = 5200) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = msg;
  $("#toast-stack").appendChild(el);
  setTimeout(() => { el.classList.add("bye"); setTimeout(() => el.remove(), 450); }, ttl);
}

/* ---------------- count-up animation ---------------- */
function countUp(el, target, { dur = 900, prefix = "", fmt = (v) => Math.round(v).toLocaleString("en-IN") } = {}) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = prefix + fmt(target * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- clock ---------------- */
function tickClock() {
  const d = new Date();
  $("#clock-time").textContent = d.toLocaleTimeString("en-IN", { hour12: false });
  $("#clock-date").textContent = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() + " · DELHI NCR · IST";
}
setInterval(tickClock, 1000);

/* ---------------- tabs ---------------- */
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "blast" && engine) setTimeout(() => engine.resize(), 60);
}

/* ============================================================
   INIT — load network summary + health
   ============================================================ */
async function init() {
  tickClock();
  engine = new GraphEngine($("#graph-canvas"));
  try {
    const [health, summary] = await Promise.all([
      api("/api/v1/health"), api("/api/v1/network/summary"),
    ]);
    state.health = health; state.summary = summary;
    renderDashboard();
    renderBatchPicker();
    renderOrderChips();
    $("#hm-val").textContent = "● LIVE";
    seedFeed();
    pollEvents();
  } catch (e) {
    toast(`<b>API offline.</b> Start the FastAPI backend: <code>uvicorn app:app</code> — ${e.message}`, "err", 12000);
    $("#hm-val").textContent = "DOWN"; $("#hm-val").classList.add("warn");
  }
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const s = state.summary, h = state.health;
  const kitchensActive = s.kitchens.filter((k) => k.status === "OPERATIONAL").length;
  $("#kpi-net").textContent = s.incident ? "WARNING" : "SAFE";
  $("#kpi-net-foot").textContent = s.incident ? `incident ${s.incident.id} live` : "99.8% batches clear";
  $("#kpi-kitchens").textContent = `${kitchensActive}/${s.kitchens.length}`;
  $("#kpi-batches").textContent = s.batches.length;
  countUp($("#kpi-orders"), s.orders_total, { dur: 1100 });
  $("#kpi-incidents").textContent = s.incident ? 1 : 0;
  $("#kpi-incidents-foot").textContent = s.incident ? s.incident.id : "quarantine queue empty";

  // cluster cards
  const cc = $("#cluster-cards");
  cc.innerHTML = "";
  s.clusters.forEach((c) => {
    const flaggedKitchens = s.kitchens.filter((k) => k.cluster === c.cluster && k.status !== "OPERATIONAL");
    const badge = flaggedKitchens.length ? (flaggedKitchens.length > 1 ? "bad" : "warn") : "ok";
    const badgeTxt = flaggedKitchens.length ? `${flaggedKitchens.length} FLAGGED` : "OPERATIONAL";
    const kitchenChips = s.kitchens.filter((k) => k.cluster === c.cluster).map((k) =>
      `<span class="cc-k ${k.status !== "OPERATIONAL" ? "flagged" : ""}">${k.id.replace("KIT-", "")}</span>`).join("");
    cc.insertAdjacentHTML("beforeend", `
      <div class="cluster-card">
        <div class="cc-top"><span class="cc-name">${c.cluster.replace(/_/g, " ")}</span>
        <span class="cc-badge ${badge}">${badgeTxt}</span></div>
        <div class="cc-meta"><span>${c.kitchens} cloud kitchens</span><span>zone coverage · live KDS</span></div>
        <div class="cc-kitchens">${kitchenChips}</div>
      </div>`);
  });

  // upstream mesh
  const mesh = $("#mesh-list");
  mesh.innerHTML = "";
  s.warehouses.forEach((w) => mesh.insertAdjacentHTML("beforeend", `
    <div class="mesh-row">
      <div class="mesh-ico" style="background:rgba(167,139,250,.14);color:#a78bfa">▤</div>
      <div class="mesh-name">${w.name}<div class="mesh-sub">${w.id} · ${w.zone} · ${(w.capacity_sqft / 1000).toFixed(0)}k sqft cold storage</div></div>
    </div>`));
  s.batches.slice(0, 5).forEach((b) => {
    const col = b.status === "CLEAR" ? "52,211,153" : "251,191,36";
    mesh.insertAdjacentHTML("beforeend", `
    <div class="mesh-row">
      <div class="mesh-ico" style="background:rgba(${col},.13);color:rgb(${col})">☣</div>
      <div class="mesh-name">${b.ingredient_name}<div class="mesh-sub">${b.id} · mfg ${b.mfg_date} · ${b.quantity_kg} kg · ${b.storage_temp_target_c}°C target</div></div>
      <span class="bo-status ${b.status === "CLEAR" ? "c" : "s"}">${b.status}</span>
    </div>`);
  });

  // telemetry
  $("#telemetry").innerHTML = `
    <div class="tele-tile"><div class="tele-k">GRAPH NODES</div><div class="tele-v c">${h.metrics.total_nodes.toLocaleString()}</div></div>
    <div class="tele-tile"><div class="tele-k">RELATIONSHIPS</div><div class="tele-v c">${h.metrics.total_relationships.toLocaleString()}</div></div>
    <div class="tele-tile"><div class="tele-k">API UPTIME</div><div class="tele-v g">${h.components.api.uptime_seconds}s</div></div>
    <div class="tele-tile"><div class="tele-k">ENGINE MODE</div><div class="tele-v a" style="font-size:10.5px;padding-top:5px">INDEX-FREE ADJACENCY</div></div>`;
}

/* ---------------- feed ---------------- */
function feedItem(sev, html, time) {
  return `<div class="feed-item ${sev}"><span class="feed-time">${time}</span><div class="feed-body">${html}</div></div>`;
}
function seedFeed() {
  const f = $("#incident-feed");
  const rows = [
    feedItem("ok", "<b>SH-212</b> delivered to Okhla Phase-2 · dock temp 5.9°C · within range", "09:00"),
    feedItem("info", "<b>WH-KUN-01</b> intake verified — 5 batches, FSSAI licenses matched", "08:12"),
    feedItem("ok", "Cold-chain telemetry nominal across 4 reefer vehicles", "07:40"),
    feedItem("info", "Ingestion job complete — orders indexed via idempotent MERGE", "07:05"),
  ];
  f.innerHTML = rows.join("");
}
function pushFeed(sev, html) {
  const time = new Date().toLocaleTimeString("en-IN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("#incident-feed").insertAdjacentHTML("afterbegin", feedItem(sev, html, time));
}
async function pollEvents() {
  try {
    const { events } = await api("/api/v1/events");
    const known = new Set(state._evts || []);
    events.slice().reverse().forEach((e) => {
      if (known.has(e.ts + e.code)) return;
      known.add(e.ts + e.code);
      const sev = e.code.includes("FLAG") ? "crit" : e.code.includes("CONTAINMENT") ? "warn" : "info";
      pushFeed(sev, `<b>${e.code}</b> — ${e.detail}`);
    });
    state._evts = [...known];
  } catch { /* non-fatal */ }
  setTimeout(pollEvents, 6000);
}

/* ---------------- batch picker ---------------- */
function renderBatchPicker() {
  const wrap = $("#batch-picker");
  wrap.innerHTML = "";
  state.summary.batches.forEach((b) => {
    const flagged = b.status !== "CLEAR";
    const el = document.createElement("div");
    el.className = `batch-opt ${b.id === state.selectedBatch ? "selected" : ""} ${flagged ? "" : "clean"}`;
    el.dataset.id = b.id;
    el.innerHTML = `
      <span class="bo-dot ${b.status === "QUARANTINED" ? "flagged" : b.status === "SUSPECT" ? "suspect" : "clear"}"></span>
      <div class="bo-main"><div class="bo-id">${b.id}</div><div class="bo-name">${b.ingredient_name} · ${b.quantity_kg} kg</div></div>
      <span class="bo-status ${b.status === "CLEAR" ? "c" : b.status === "QUARANTINED" ? "q" : "s"}">${b.status}</span>`;
    el.addEventListener("click", () => {
      state.selectedBatch = b.id;
      $$(".batch-opt").forEach((o) => o.classList.toggle("selected", o.dataset.id === b.id));
    });
    wrap.appendChild(el);
  });
}

/* ============================================================
   BLAST RADIUS
   ============================================================ */
$("#btn-blast").addEventListener("click", () => runBlast());

async function runBlast(opts = {}) {
  const batchId = opts.batchId || state.selectedBatch;
  const batch = state.summary.batches.find((b) => b.id === batchId);
  const btn = $("#btn-blast");
  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⟳</span> TRAVERSING GRAPH…';
  switchTab("blast");

  try {
    // 1. flag incident for suspect batches (QA lab trigger)
    if (batch && batch.status !== "CLEAR") {
      state.incident = await api("/api/v1/incidents", {
        method: "POST",
        body: JSON.stringify({ batch_id: batchId, reason: "Listeria monocytogenes", severity: "CRITICAL", operator_id: "QA-OFFICER-07" }),
      });
      $("#incident-banner").hidden = false;
      $("#ib-title").textContent = `FSSAI LAB ALERT — ${state.incident.incident_id}`;
      $("#ib-sub").textContent = `${batch.ingredient_name} (${batchId}) positive: ${state.incident.severity_model.formula ? "Listeria monocytogenes" : "pathogen"} · severity ${state.incident.severity_model.class}`;
      setNetAlert(true);
      pushFeed("crit", `<b>${batchId}</b> flagged ${state.incident.severity_model.class} — Listeria monocytogenes (lab FSSAI/4471)`);
    } else {
      state.incident = null;
      $("#incident-banner").hidden = true;
      setNetAlert(false);
    }

    // 2. blast radius metrics
    const blast = await api(`/api/v1/batches/${batchId}/blast-radius`);
    state.blast = blast;

    // 3. graph payload + animated reveal
    const graph = await api(`/api/v1/batches/${batchId}/trace-graph?depth=5`);
    state.graphPayload = graph;
    $("#graph-empty").style.display = "none";
    engine.setGraph(graph.nodes, graph.edges);
    engine.resize();
    engine.start();
    $("#graph-tag").textContent = "TRAVERSING…";
    $("#graph-tag").style.color = "var(--amber)";
    setTimeout(() => { $("#graph-tag").textContent = `${graph.nodes.length} NODES · ${graph.edges.length} EDGES`; }, 3400);

    renderBlastResults(blast, batch);
    renderContainment();
    if (!opts.silent) toast(`<b>Blast radius computed in ${blast.metrics.traversal_ms.toFixed(1)} ms.</b> ${blast.metrics.affected_orders} orders downstream of ${batchId}.`, blast.metrics.affected_orders ? "err" : "ok");
  } catch (e) {
    toast(`<b>Traversal failed:</b> ${e.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">◎</span> INITIATE BLAST RADIUS ANALYSIS';
  }
}

function setNetAlert(on) {
  const chip = $("#net-chip");
  chip.classList.toggle("alert", on);
  $("#net-label").textContent = on ? "INCIDENT ACTIVE · INC-2026-003" : "NETWORK NOMINAL";
}

function renderBlastResults(blast, batch) {
  const m = blast.metrics;

  // latency
  $("#latency-box").hidden = false;
  countUp($("#lat-num"), m.traversal_ms, { dur: 800, fmt: (v) => v.toFixed(1) });
  setTimeout(() => $("#lat-num").textContent = m.traversal_ms.toFixed(1) + " ms", 850);
  $("#lat-hops").textContent = `${m.hops} hops · ${m.affected_kitchens} kitchens · ${m.affected_orders} orders`;
  requestAnimationFrame(() => { $("#lat-fill").style.width = Math.max(2.5, Math.min(100, (m.traversal_ms / 200) * 100)) + "%"; });

  // KPIs
  $("#blast-kpis").hidden = false;
  countUp($("#bk-orders"), m.affected_orders, { dur: 1200 });
  countUp($("#bk-kitchens"), m.affected_kitchens, { dur: 1000 });
  countUp($("#bk-customers"), m.exposed_customers, { dur: 1300 });
  countUp($("#bk-gmv"), m.gmv_at_risk_inr, { dur: 1400, fmt: (v) => INR(v) });

  // status distribution
  const sc = blast.status_counts;
  const total = Math.max(1, sc.PREPARING + sc.OUT_FOR_DELIVERY + sc.DELIVERED + (sc.INTERCEPTED || 0));
  $("#status-dist").hidden = false;
  $("#seg-prep").style.width = (sc.PREPARING / total) * 100 + "%";
  $("#seg-transit").style.width = (sc.OUT_FOR_DELIVERY / total) * 100 + "%";
  $("#seg-deliv").style.width = ((sc.DELIVERED + (sc.INTERCEPTED || 0)) / total) * 100 + "%";
  $("#sd-legend").innerHTML = `
    <span class="sd-l"><i style="background:#fbbf24"></i>PREPARING ${sc.PREPARING}</span>
    <span class="sd-l"><i style="background:#fb923c"></i>IN TRANSIT ${sc.OUT_FOR_DELIVERY}</span>
    <span class="sd-l"><i style="background:#ef4444"></i>DELIVERED ${sc.DELIVERED}</span>`;

  // cold-chain breach note
  const bn = $("#breach-note");
  if (blast.temp_breach) {
    bn.hidden = false;
    bn.innerHTML = `<b>⚠ COLD-CHAIN BREACH CORRELATED:</b> Shipment <b>${blast.breach_shipment}</b> recorded <b>9.4°C</b> (limit 8°C).
      Co-stored batches <b>BATCH-CRM-1150</b> (Malai Cream) and <b>BATCH-BUT-1204</b> (White Butter) auto-marked <b>SUSPECT</b>.
      Severity multiplier ×1.5 applied.`;
  } else {
    bn.hidden = true;
  }

  // ledger
  if (blast.orders && blast.orders.length) {
    $("#affected-table-wrap").hidden = false;
    $("#ledger-count").textContent = `${m.affected_orders} ORDERS · showing ${blast.orders_returned}`;
    const tb = $("#ledger-table tbody");
    tb.innerHTML = blast.orders.slice(0, 40).map((o) => `
      <tr>
        <td>${o.order_id}</td>
        <td>${o.dish}</td>
        <td>${o.kitchen || "—"}</td>
        <td><span class="st ${o.status}">${o.status.replace(/_/g, " ")}</span></td>
        <td>${INR(o.total_inr)}</td>
      </tr>`).join("");
  } else {
    $("#affected-table-wrap").hidden = true;
  }
}

/* ============================================================
   CONTAINMENT
   ============================================================ */
function renderContainment() {
  const zonesEl = $("#zones");
  if (!state.incident) {
    zonesEl.innerHTML = `<div class="panel" style="grid-column:1/-1;text-align:center;color:var(--ink-faint);padding:34px">
      Flag a suspect batch and run blast radius to generate the containment boundary.</div>`;
    $("#sev-score").textContent = "—";
    $("#sev-class").textContent = "Run blast radius first";
    $("#sev-formula").textContent = "";
    return;
  }
  const sev = state.incident.severity_model;
  $("#sev-score").textContent = sev.score;
  $("#sev-score").style.color = sev.class === "CRITICAL" ? "var(--red-soft)" : sev.class === "HIGH" ? "var(--orange)" : "var(--amber)";
  $("#sev-class").textContent = `CLASSIFICATION: ${sev.class}`;
  $("#sev-formula").innerHTML =
    `S<sub>bio</sub> × (O<sub>prep</sub>×2.0 + O<sub>transit</sub>×3.0 + O<sub>deliv</sub>×1.5) × C<sub>temp</sub><br>= ${sev.formula} = <b style="color:var(--ink)">${sev.score}</b>`;

  const sc = state.incident.status_counts;
  const meta = [
    { key: "ZONE1_FREEZE_PREP", cls: "z1", icon: "⏻", count: sc.PREPARING, unit: "ORDERS IN PREP", btn: "EXECUTE KDS LOCK", action: "FREEZE_PREP" },
    { key: "ZONE2_INTERCEPT_DISPATCH", cls: "z2", icon: "⛔", count: sc.OUT_FOR_DELIVERY, unit: "RIDERS IN TRANSIT", btn: "DISPATCH RIDER HALT", action: "INTERCEPT_DISPATCH" },
    { key: "ZONE3_NOTIFY_CONSUMER", cls: "z3", icon: "📡", count: sc.DELIVERED, unit: "CONSUMERS ALERTED", btn: "TRIGGER SMS WEBHOOK", action: "NOTIFY_CONSUMER" },
  ];
  zonesEl.innerHTML = "";
  meta.forEach((z) => {
    const boundary = state.incident.containment_boundary.find((b) => b.zone === z.key);
    const done = state.zonesDone[z.action];
    zonesEl.insertAdjacentHTML("beforeend", `
      <div class="zone ${z.cls}">
        <div class="zone-top">
          <div><div class="zone-num">${z.key.split("_")[0]} · ${z.action.replaceAll("_", " ")}</div>
          <div class="zone-title">${z.icon} ${boundary ? boundary.title : ""}</div></div>
          <div class="zone-count"><div class="zc-num" data-count="${z.count}">0</div><div class="zc-l">${z.unit}</div></div>
        </div>
        <div class="zone-desc">${boundary ? boundary.desc : ""}</div>
        <div class="zone-directive">${boundary ? boundary.directive : ""}</div>
        <button class="btn-zone ${done ? "done" : ""}" data-action="${z.action}" ${done ? "disabled" : ""}>${done ? "✓ EXECUTED" : z.btn}</button>
        <div class="zone-status ${done ? "ok" : ""}" id="zstat-${z.action}">${done ? "directive confirmed" : ""}</div>
      </div>`);
    countUp(zonesEl.querySelector(`[data-count="${z.count}"]`), z.count, { dur: 900 });
  });
  $$(".btn-zone").forEach((b) => b.addEventListener("click", () => executeZone(b.dataset.action)));
}

async function executeZone(action, opts = {}) {
  if (!state.incident) return toast("Run blast radius first.", "err");
  if (state.zonesDone[action]) return;
  const btn = $(`.btn-zone[data-action="${action}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "DISPATCHING…"; }
  try {
    const zone = state.incident.containment_boundary.find((b) => b.zone.startsWith(action === "FREEZE_PREP" ? "ZONE1" : action === "INTERCEPT_DISPATCH" ? "ZONE2" : "ZONE3"));
    const res = await api(`/api/v1/incidents/${state.incident.incident_id}/quarantine`, {
      method: "POST",
      body: JSON.stringify({ action, target_kitchen_ids: zone && zone.scope ? zone.scope.kitchens || [] : [] }),
    });
    state.zonesDone[action] = res;

    if (action === "FREEZE_PREP") {
      (res.locked_kitchens || []).forEach((id) => engine.markKitchenHold(id));
      renderDashboard();
      toast(`<b>KDS locks dispatched to ${res.locked_kitchens.length} kitchens.</b> ${res.note}`, "ok");
      pushFeed("warn", `<b>FREEZE_PREP</b> — paneer SKU lines locked at ${res.locked_kitchens.length} kitchens; biryani/dal/breads remain LIVE`);
      setZoneDone(action, `${res.locked_kitchens.length} stations locked · safe lines unaffected`);
    } else if (action === "INTERCEPT_DISPATCH") {
      engine.markIntercepted();
      toast(`<b>${res.orders_intercepted} riders intercepted.</b> Orders flipped to INTERCEPTED before handover.`, "ok");
      pushFeed("warn", `<b>INTERCEPT_DISPATCH</b> — ${res.orders_intercepted} orders recalled from transit`);
      setZoneDone(action, `${res.orders_intercepted} orders flipped to INTERCEPTED`);
    } else {
      toast(`<b>${res.notifications_queued} consumer alerts queued.</b> “${res.message}”`, "info");
      pushFeed("crit", `<b>NOTIFY_CONSUMER</b> — ${res.notifications_queued} safety SMS via phone_hash webhook`);
      setZoneDone(action, `${res.notifications_queued} alerts queued via webhook`);
    }
    renderDashboardKPIOnly();
  } catch (e) {
    toast(`<b>Action failed:</b> ${e.message}`, "err");
    if (btn) { btn.disabled = false; }
  }
}

function setZoneDone(action, msg) {
  const btn = $(`.btn-zone[data-action="${action}"]`);
  if (btn) { btn.classList.add("done"); btn.textContent = "✓ EXECUTED"; }
  const st = $(`#zstat-${action}`);
  if (st) { st.textContent = msg; st.classList.add("ok"); }
}

function renderDashboardKPIOnly() {
  if (state.summary) {
    // refresh kitchen statuses lazily via summary re-fetch
    api("/api/v1/network/summary").then((s) => { state.summary = s; renderDashboard(); }).catch(() => {});
  }
}

function appendContainmentLog(code, msg) {
  const log = $("#containment-log");
  if (log.querySelector(".log-empty")) log.innerHTML = "";
  const time = new Date().toLocaleTimeString("en-IN", { hour12: false });
  log.insertAdjacentHTML("afterbegin", `
    <div class="log-item"><span class="log-time">${time}</span><span class="log-code">${code}</span><span class="log-msg">${msg}</span></div>`);
}

/* ============================================================
   REVERSE TRACE
   ============================================================ */
const ENT_META = {
  Order: { icon: "🧾", color: "96,165,250", name: (n) => n.id },
  Dish: { icon: "◍", color: "251,191,36", name: (n) => n.name },
  Kitchen: { icon: "⌂", color: "52,211,153", name: (n) => n.name },
  Shipment: { icon: "➤", color: "251,146,60", name: (n) => `${n.id} · ${n.vehicle_plate}` },
  Warehouse: { icon: "▤", color: "167,139,250", name: (n) => n.name },
  Batch: { icon: "☣", color: "239,68,68", name: (n) => `${n.id} — ${n.ingredient_name}` },
  Supplier: { icon: "⬢", color: "34,211,238", name: (n) => n.name },
};

function renderOrderChips() {
  const chips = [
    { id: "ORD-8600", note: "paneer · prep" },
    { id: "ORD-8660", note: "paneer · transit" },
    { id: "ORD-8900", note: "paneer · delivered" },
    { id: "ORD-9305", note: "biryani · clean" },
  ];
  $("#order-chips").innerHTML = chips.map((c) =>
    `<span class="order-chip" data-id="${c.id}">${c.id} <span style="opacity:.55">· ${c.note}</span></span>`).join("");
  $$(".order-chip").forEach((c) => c.addEventListener("click", () => {
    $("#order-input").value = c.dataset.id;
    runReverse(c.dataset.id);
  }));
}

$("#btn-reverse").addEventListener("click", () => runReverse());
$("#order-input").addEventListener("keydown", (e) => { if (e.key === "Enter") runReverse(); });

async function runReverse(orderId, opts = {}) {
  const id = orderId || $("#order-input").value.trim();
  if (!id) return toast("Enter an order ID.", "err");
  switchTab("reverse");
  const btn = $("#btn-reverse");
  btn.disabled = true; btn.innerHTML = '<span class="btn-icon">⟳</span> TRACING…';
  const track = $("#path-track");
  track.innerHTML = "";
  $("#rev-verdict").hidden = true;
  $("#rev-latency").hidden = true;
  $("#rev-tag").textContent = "TRAVERSING UPSTREAM…";

  try {
    const res = await api(`/api/v1/orders/${id}/reverse-trace`);
    state.tracedOrders.push(res);

    // animated hop-by-hop reveal
    res.hops.forEach((hop, i) => {
      const meta = ENT_META[hop.entity] || { icon: "•", color: "148,163,184", name: (n) => n.id };
      const flagged = hop.entity === "Batch" && hop.status !== "CLEAR";
      const metaLines = [];
      if (hop.entity === "Order") metaLines.push(`status ${hop.status} · ${INR(hop.total_inr)} · ${hop.ordered_at.slice(11, 16)} UTC`);
      if (hop.entity === "Dish") metaLines.push(`${hop.category} · shelf life ${hop.shelf_life_hours}h`);
      if (hop.entity === "Kitchen") metaLines.push(`${hop.cluster} cluster · ${hop.status}`);
      if (hop.entity === "Shipment") metaLines.push(`reefer ${hop.vehicle_plate} · avg ${hop.avg_temp_c}°C${hop.avg_temp_c > 8 ? " ⚠ BREACH" : ""}`);
      if (hop.entity === "Warehouse") metaLines.push(`${hop.zone} · ${hop.capacity_sqft.toLocaleString()} sqft`);
      if (hop.entity === "Batch") metaLines.push(`mfg ${hop.mfg_date} · exp ${hop.expiry_date} · ${hop.quantity_kg} kg · ${hop.status}`);
      if (hop.entity === "Supplier") metaLines.push(`${hop.location} · FSSAI ${hop.fssai_license}`);
      if (i > 0) track.insertAdjacentHTML("beforeend", `<div class="path-connector"></div>`);
      track.insertAdjacentHTML("beforeend", `
        <div class="path-node ${flagged ? "flagged" : ""}" id="pn-${i}">
          <div class="pn-ico" style="background:rgba(${meta.color},.13);color:rgb(${meta.color})">${meta.icon}</div>
          <div class="pn-body">
            <div class="pn-ent">${hop.entity.toUpperCase()} · HOP ${i}</div>
            <div class="pn-name">${meta.name(hop)}</div>
            <div class="pn-meta">${metaLines.join("<br>")}</div>
          </div>
          <div class="pn-hop">${i === res.hops_count - 1 ? "◉ ROOT" : ""}</div>
        </div>`);
      setTimeout(() => $(`#pn-${i}`).classList.add("shown"), 260 * (i + 1));
    });

    setTimeout(() => {
      $("#rev-latency").hidden = false;
      $("#rl-num").textContent = res.traversal_ms.toFixed(1) + " ms";
      $("#rl-hops").textContent = `${res.hops_count} hops · customer → supplier`;
      const v = res.verdict;
      const el = $("#rev-verdict");
      el.hidden = false;
      if (v.contaminated) {
        el.className = "rev-verdict bad";
        el.innerHTML = `<b>⚠ ROOT CAUSE ISOLATED:</b> ${v.root_cause_batch} from <b>${v.root_cause_supplier}</b>.
          Incident <b>${v.incident ? v.incident.id : ""}</b> already active — containment boundary in effect.
          FSSAI §28 chain-of-custody export ready.`;
        $("#rev-tag").textContent = "ROOT CAUSE FOUND";
        $("#rev-tag").style.color = "var(--red-soft)";
        if (!opts.silent) toast(`<b>Root cause found in ${res.traversal_ms.toFixed(1)} ms:</b> ${v.root_cause_batch} ← ${v.root_cause_supplier}`, "err");
      } else {
        el.className = "rev-verdict good";
        el.innerHTML = `<b>✓ PATH CLEAN:</b> no active incident on any upstream batch for this order.
          Chicken batch provenance verified to <b>${v.root_cause_supplier}</b>.`;
        $("#rev-tag").textContent = "PATH CLEAN";
        $("#rev-tag").style.color = "var(--green)";
        if (!opts.silent) toast(`<b>Order ${id} verified clean</b> in ${res.traversal_ms.toFixed(1)} ms.`, "ok");
      }
    }, 260 * (res.hops_count + 1));
  } catch (e) {
    toast(`<b>Reverse trace failed:</b> ${e.message}`, "err");
    $("#rev-tag").textContent = "ERROR";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">⇄</span> TRACE';
  }
}

/* ============================================================
   ONE-CLICK 4-MINUTE JUDGING DEMO
   ============================================================ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkCancel() { if (state.demoCancel) throw new Error("DEMO_CANCELLED"); }

async function runDemo() {
  if (state.demoRunning) { state.demoCancel = true; return; }
  state.demoRunning = true; state.demoCancel = false;
  const fab = $("#btn-autodemo");
  fab.innerHTML = "■ STOP DEMO";
  fab.classList.add("running");
  try {
    // Act 1 — nominal network
    switchTab("dashboard");
    toast("<b>Act 1 — Saturday 14:00, peak lunch.</b> 750k meals/day flow through Delhi NCR cloud kitchens. Network nominal.", "info", 4200);
    await sleep(3800); await checkCancel();

    // Act 2 — the incident
    pushFeed("crit", "<b>FSSAI LAB ALERT</b> — Batch BATCH-PAN-1042 (Malai Paneer) tests POSITIVE for Listeria monocytogenes");
    toast("<b>⚠ FSSAI LAB ALERT:</b> Batch B-1042 Malai Paneer positive for <b>Listeria monocytogenes</b>. Initiating quarantine protocol.", "err", 5000);
    setNetAlert(true);
    await sleep(3200); await checkCancel();

    // Act 3 — blast radius
    state.selectedBatch = "BATCH-PAN-1042";
    renderBatchPicker();
    await runBlast({ batchId: "BATCH-PAN-1042", silent: true });
    toast("<b>Blast radius complete.</b> 6 kitchens · 342 orders · 489 consumers · ₹1,24,000 GMV at risk — in milliseconds, not hours.", "err", 6000);
    await sleep(6200); await checkCancel();

    // Act 4 — surgical containment
    switchTab("containment");
    await sleep(2400); await checkCancel();
    await executeZone("FREEZE_PREP", { silent: true }); await sleep(1900); await checkCancel();
    await executeZone("INTERCEPT_DISPATCH", { silent: true }); await sleep(1900); await checkCancel();
    await executeZone("NOTIFY_CONSUMER", { silent: true }); await sleep(2400); await checkCancel();

    // Act 5 — reverse trace
    switchTab("reverse");
    $("#order-input").value = "ORD-8660";
    await runReverse("ORD-8660", { silent: true });
    await sleep(4600); await checkCancel();

    toast("<b>✓ DEMO COMPLETE.</b> Hours of relational-database panic → milliseconds of surgical, graph-native containment. Index-free adjacency wins.", "ok", 9000);
  } catch (e) {
    if (e.message !== "DEMO_CANCELLED") console.error(e);
  } finally {
    state.demoRunning = false; state.demoCancel = false;
    fab.innerHTML = "▶ AUTO-RUN 4-MIN DEMO";
    fab.classList.remove("running");
  }
}

document.addEventListener("click", (e) => {
  if (e.target.closest("#btn-autodemo")) runDemo();
});

/* ---------------- boot ---------------- */
init();
