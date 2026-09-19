/* TracePulse graph engine — canvas ring layout, animated traversal, glow + particles */
import type { TraceEdge, TraceNode } from "./types";

interface NodeStyle { color: string; glow: string; r: number; shape: string; icon: string }

const NODE_STYLE: Record<string, NodeStyle> = {
  Batch:       { color: "#ef4444", glow: "rgba(239,68,68,0.9)",  r: 26, shape: "octagon", icon: "☣" },
  Warehouse:   { color: "#a78bfa", glow: "rgba(167,139,250,0.8)", r: 19, shape: "box",    icon: "▤" },
  Shipment:    { color: "#fb923c", glow: "rgba(251,146,60,0.8)",  r: 15, shape: "diamond", icon: "➤" },
  Kitchen:     { color: "#34d399", glow: "rgba(52,211,153,0.8)",  r: 17, shape: "square",  icon: "⌂" },
  Dish:        { color: "#fbbf24", glow: "rgba(251,191,36,0.8)",  r: 15, shape: "circle",  icon: "◍" },
  OrderCohort: { color: "#60a5fa", glow: "rgba(96,165,250,0.8)",  r: 22, shape: "circle",  icon: "≡" },
  Consumers:   { color: "#f472b6", glow: "rgba(244,114,182,0.8)", r: 20, shape: "hex",     icon: "☺" },
};

interface EngineNode extends TraceNode {
  style: NodeStyle; x: number; y: number; revealAt: number;
  hold?: boolean; avg_temp_c?: number;
}

function rgba(glow: string, alpha: number): string {
  return glow.replace(/,[^,)]*\)$/, `,${alpha})`);
}

export class GraphEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private nodes = new Map<string, EngineNode>();
  private edges: TraceEdge[] = [];
  private particles: { edge: TraceEdge; t: number; speed: number }[] = [];
  private running = false;
  private t0 = 0;
  private revealMs = 620;
  private hover: string | null = null;
  private intercepted = false;
  private w = 600;
  private h = 500;
  private ro: ResizeObserver;
  private lastPayload: { nodes: TraceNode[]; edges: TraceEdge[] } | null = null;

  onNodeClick: ((n: EngineNode) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    canvas.addEventListener("mousemove", (e) => this.onMove(e));
    canvas.addEventListener("mouseleave", () => { this.hover = null; });
    canvas.addEventListener("click", (e) => {
      const n = this.pick(e);
      if (n && this.onNodeClick) this.onNodeClick(n);
    });
    this.resize();
  }

  destroy() { this.running = false; this.ro.disconnect(); }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(rect.width, 320);
    this.h = Math.max(rect.height, 320);
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // re-layout after tab becomes visible / window resizes, preserving live state
    if (this.lastPayload && this.nodes.size) {
      const holds = [...this.nodes.values()].filter((n) => n.hold).map((n) => n.id);
      const wasIntercepted = this.intercepted;
      this.buildLayout(this.lastPayload.nodes, this.lastPayload.edges);
      holds.forEach((id) => this.markKitchenHold(id));
      this.intercepted = wasIntercepted;
    }
  }

  setGraph(nodes: TraceNode[], edges: TraceEdge[]) {
    this.lastPayload = { nodes, edges };
    this.intercepted = false;
    this.buildLayout(nodes, edges);
  }

  private buildLayout(nodes: TraceNode[], edges: TraceEdge[]) {
    this.nodes = new Map();
    this.edges = edges || [];
    const rings: Record<number, TraceNode[]> = {};
    (nodes || []).forEach((n) => {
      const ring = n.ring ?? n.hop ?? 0;
      (rings[ring] = rings[ring] || []).push(n);
    });
    const cx = this.w / 2, cy = this.h / 2 - 8;
    const ringKeys = Object.keys(rings).map(Number);
    const maxRing = Math.max(...ringKeys, 1);
    const maxR = Math.min(this.w, this.h) / 2 - 74;
    Object.entries(rings).forEach(([ringStr, list]) => {
      const ring = Number(ringStr);
      const r = ring === 0 ? 0 : (ring / maxRing) * maxR;
      const n = list.length;
      list.forEach((node, i) => {
        const angle = n === 1 ? -Math.PI / 2 : (i / n) * Math.PI * 2 - Math.PI / 2 + (ring % 2 ? Math.PI / n : 0);
        const style = NODE_STYLE[node.label] || NODE_STYLE.Dish;
        this.nodes.set(node.id, {
          ...node, style,
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r * 0.92,
          ring, revealAt: ring * this.revealMs,
        });
      });
    });
    for (let k = 0; k < 60; k++) this.relax();
    this.particles = this.edges
      .filter((e) => ["SHIPPED_VIA", "DELIVERED_TO", "CONTAINS_ITEM", "PLACED_BY", "PREPARED"].includes(e.type))
      .map((e) => ({ edge: e, t: Math.random(), speed: 0.004 + Math.random() * 0.004 }));
  }

  private relax() {
    const arr = [...this.nodes.values()];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        if (a.ring !== b.ring) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1, min = 66;
        if (d < min) {
          const f = ((min - d) / d) * 0.35;
          a.x -= dx * f; a.y -= dy * f; b.x += dx * f; b.y += dy * f;
        }
      }
    }
  }

  start() {
    this.t0 = performance.now();
    if (!this.running) { this.running = true; requestAnimationFrame(() => this.loop()); }
  }

  private elapsed() { return performance.now() - this.t0; }

  markKitchenHold(id: string) { const n = this.nodes.get(id); if (n) n.hold = true; }
  markIntercepted() { this.intercepted = true; }

  private loop() {
    this.draw();
    if (this.running) requestAnimationFrame(() => this.loop());
  }

  private edgePoint(e: TraceEdge, t: number) {
    const a = this.nodes.get(e.source), b = this.nodes.get(e.target);
    if (!a || !b) return null;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(28, len * 0.14);
    const cxp = mx - (dy / len) * bow, cyp = my + (dx / len) * bow;
    const u = 1 - t;
    return {
      x: u * u * a.x + 2 * u * t * cxp + t * t * b.x,
      y: u * u * a.y + 2 * u * t * cyp + t * t * b.y,
      cx: cxp, cy: cyp,
    };
  }

  private draw() {
    const ctx = this.ctx, now = this.elapsed();
    ctx.clearRect(0, 0, this.w, this.h);

    ctx.save();
    ctx.strokeStyle = "rgba(34,211,238,0.05)";
    const cx = this.w / 2, cy = this.h / 2 - 8;
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (Math.min(this.w, this.h) / 2 - 74) * (i / 5) * 0.95, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    for (const e of this.edges) {
      const a = this.nodes.get(e.source), b = this.nodes.get(e.target);
      if (!a || !b) continue;
      const appear = Math.max(a.revealAt, b.revealAt) + 260;
      if (now < appear) continue;
      const p = Math.min(1, (now - appear) / 500);
      const pt = this.edgePoint(e, p);
      if (!pt) continue;
      const danger = e.type === "USES_BATCH" || a.label === "Batch";
      const grad = ctx.createLinearGradient(a.x, a.y, pt.x, pt.y);
      grad.addColorStop(0, danger ? "rgba(239,68,68,0.75)" : "rgba(96,165,250,0.5)");
      grad.addColorStop(1, danger ? "rgba(251,191,36,0.65)" : rgba(b.style.glow, 0.55));
      ctx.strokeStyle = grad;
      ctx.lineWidth = danger ? 2 : 1.4;
      ctx.setLineDash(e.type === "USES_BATCH" ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(pt.cx, pt.cy, pt.x, pt.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const p of this.particles) {
      const e = p.edge;
      const a = this.nodes.get(e.source), b = this.nodes.get(e.target);
      if (!a || !b) continue;
      if (now < Math.max(a.revealAt, b.revealAt) + 800) continue;
      p.t += p.speed;
      if (p.t > 1) p.t = 0;
      const pt = this.edgePoint(e, p.t);
      if (!pt) continue;
      ctx.fillStyle = "rgba(103,232,249,0.9)";
      ctx.shadowColor = "rgba(34,211,238,0.9)";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const n of this.nodes.values()) {
      if (now < n.revealAt) continue;
      const age = Math.min(1, (now - n.revealAt) / 420);
      const scale = 0.4 + 0.6 * (1 - Math.pow(1 - age, 3));
      this.drawNode(n, scale, now);
    }
  }

  private drawNode(n: EngineNode, scale: number, now: number) {
    const ctx = this.ctx;
    const s = n.style;
    const r = s.r * scale;
    const isHover = this.hover === n.id;
    const isRoot = n.label === "Batch";
    ctx.save();
    ctx.translate(n.x, n.y);

    if (isRoot) {
      const pulse = (now / 900) % 1;
      ctx.strokeStyle = `rgba(239,68,68,${(1 - pulse) * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 8 + pulse * 34, 0, Math.PI * 2);
      ctx.stroke();
    }

    const halo = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.6);
    halo.addColorStop(0, rgba(s.glow, isHover ? 0.5 : 0.3));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = s.glow;
    ctx.shadowBlur = isHover ? 26 : 14;
    ctx.fillStyle = n.hold ? "#f59e0b" : s.color;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    switch (s.shape) {
      case "octagon": this.poly(r, 8, Math.PI / 8); break;
      case "diamond": this.poly(r, 4, 0); break;
      case "square": this.rect(r * 1.7, r * 1.7, 4); break;
      case "box": this.rect(r * 2.1, r * 1.5, 3); break;
      case "hex": this.poly(r, 6, Math.PI / 6); break;
      default: ctx.arc(0, 0, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(4,7,13,0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (n.label === "OrderCohort" || n.label === "Consumers") {
      ctx.font = `700 ${Math.max(11, r * 0.62)}px 'JetBrains Mono',monospace`;
      ctx.fillText(String(n.count ?? ""), 0, 1);
    } else {
      ctx.font = `${Math.max(10, r * 0.7)}px sans-serif`;
      ctx.fillText(s.icon, 0, 1);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.globalAlpha = scale;
    ctx.textAlign = "center";
    const label = n.name || n.id || "";
    ctx.font = "600 10.5px 'Space Grotesk',sans-serif";
    ctx.fillStyle = "rgba(230,241,255,0.95)";
    ctx.fillText(label.length > 26 ? label.slice(0, 24) + "…" : label, 0, r + 15);
    let sub: string | null = null;
    if (n.label === "Shipment") sub = `${n.avg_temp_c}°C transit${(n.avg_temp_c ?? 0) > 8 ? " ⚠ BREACH" : ""}`;
    if (n.label === "Kitchen") sub = n.hold ? "PARTIAL HOLD — paneer line frozen" : (n.cluster as string);
    if (n.label === "OrderCohort") sub = `${String(n.status).replace(/_/g, " ")}${this.intercepted && n.status === "OUT_FOR_DELIVERY" ? " → INTERCEPTED" : ""}`;
    if (n.label === "Dish") sub = n.grams_per_dish ? `${n.grams_per_dish} g batch/dish` : null;
    if (n.label === "Batch") sub = n.status as string;
    if (sub) {
      ctx.font = "500 8.5px 'JetBrains Mono',monospace";
      ctx.fillStyle = (n.avg_temp_c ?? 0) > 8 || n.hold ? "rgba(251,191,36,0.95)" : "rgba(139,163,199,0.9)";
      ctx.fillText(sub, 0, r + 27);
    }
    ctx.restore();
  }

  private poly(r: number, sides: number, rot: number) {
    const ctx = this.ctx;
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  private rect(w: number, h: number, rad: number) {
    this.ctx.roundRect(-w / 2, -h / 2, w, h, rad);
  }

  private pick(e: MouseEvent): EngineNode | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const n of this.nodes.values()) {
      if (Math.hypot(n.x - x, n.y - y) < n.style.r + 8) return n;
    }
    return null;
  }

  private onMove(e: MouseEvent) {
    const n = this.pick(e);
    this.hover = n ? n.id : null;
    this.canvas.style.cursor = n ? "pointer" : "default";
  }
}
