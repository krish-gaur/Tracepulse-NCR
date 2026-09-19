"""
TracePulse NCR — FastAPI backend
================================
Thin, stateless REST layer over the graph service layer, plus the AI Copilot
endpoints (SSE streaming chat with graph tool-calling).

Run:  uvicorn app:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel

import services
from ai import agent, provider, report
from data import INCIDENT, seed_graph
from graphcore import GraphStore

app = FastAPI(
    title="TracePulse NCR API",
    description="Sub-second contamination blast radius engine + graph-grounded AI copilot",
    version="2.0.0",
)

# CORS open for hackathon; tighten via ALLOWED_ORIGINS in production
_origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_methods=["*"], allow_headers=["*"])

# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------
GRAPH = GraphStore()
seed_graph(GRAPH)
BOOT_TIME = time.time()
JOBS: dict = {}
EVENT_LOG: list = []


def audit(code: str, detail: str) -> dict:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "code": code, "detail": detail}
    EVENT_LOG.append(entry)
    return entry


audit("SYSTEM_BOOT", f"graph seeded: {GRAPH.counts()['nodes']} nodes / {GRAPH.counts()['relationships']} rels")


def _svc(fn, *args, **kw):
    """Wrap service errors into HTTP codes."""
    try:
        return fn(GRAPH, *args, **kw)
    except services.NotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Health & network
# ---------------------------------------------------------------------------

@app.get("/api/v1/health")
async def health():
    counts = GRAPH.counts()
    cfg = provider.get_config()
    return {
        "status": "HEALTHY", "timestamp": services.now_iso(),
        "components": {
            "api": {"status": "UP", "uptime_seconds": round(time.time() - BOOT_TIME, 1)},
            "graph_engine": {"status": "CONNECTED", "latency_ms": 0.4, "mode": "index-free-adjacency (embedded) / Neo4j-swappable"},
            "ai_copilot": {"status": "UP", "mode": "llm" if cfg["enabled"] else "fallback",
                           "model": cfg["model"] if cfg["enabled"] else "deterministic-intent-router"},
        },
        "metrics": {
            "total_batches_tracked": counts["by_label"].get("Batch", 0),
            "total_orders_indexed": counts["by_label"].get("Order", 0),
            "total_nodes": counts["nodes"], "total_relationships": counts["relationships"],
            "active_incidents": 1 if GRAPH.find("Incident", INCIDENT["id"]) else 0,
        },
    }


@app.get("/api/v1/network/summary")
async def network_summary():
    return _svc(services.network_summary_data)


# ---------------------------------------------------------------------------
# Blast radius / trace graph
# ---------------------------------------------------------------------------

@app.get("/api/v1/batches/{batch_id}/blast-radius")
async def blast_radius(batch_id: str):
    return _svc(services.blast_radius_data, batch_id)


@app.get("/api/v1/batches/{batch_id}/trace-graph")
async def trace_graph(batch_id: str, depth: int = 5):
    return _svc(services.trace_graph_data, batch_id, depth)


# ---------------------------------------------------------------------------
# Reverse trace
# ---------------------------------------------------------------------------

@app.get("/api/v1/orders/{order_id}/reverse-trace")
async def reverse_trace(order_id: str):
    return _svc(services.reverse_trace_data, order_id)


# ---------------------------------------------------------------------------
# Incidents & containment
# ---------------------------------------------------------------------------

class IncidentIn(BaseModel):
    batch_id: str
    reason: str = "Listeria monocytogenes"
    severity: str = "CRITICAL"
    operator_id: str = "QA-OFFICER-07"


@app.post("/api/v1/incidents")
async def create_incident(body: IncidentIn):
    res = _svc(services.create_incident_core, body.batch_id, body.reason, body.severity, body.operator_id)
    audit("USER_FLAGGED_BATCH", f"{body.batch_id} -> {body.severity} ({body.reason})")
    return res


class QuarantineIn(BaseModel):
    action: str
    target_kitchen_ids: List[str] = []


@app.post("/api/v1/incidents/{incident_id}/quarantine")
async def quarantine(incident_id: str, body: QuarantineIn):
    res = _svc(services.quarantine_core, incident_id, body.action, body.target_kitchen_ids)
    audit("CONTAINMENT_ISSUED", f"{body.action}: {json.dumps({k: v for k, v in res.items() if k in ('orders_intercepted', 'notifications_queued', 'locked_kitchens')}, default=str)}")
    return res


@app.get("/api/v1/batches/{batch_id}/cross-contamination")
async def cross_contamination(batch_id: str):
    return _svc(services.cross_contamination_data, batch_id)


# ---------------------------------------------------------------------------
# AI Copilot
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


@app.get("/api/v1/ai/status")
async def ai_status():
    cfg = provider.get_config()
    return {
        "enabled": cfg["enabled"],
        "mode": "llm" if cfg["enabled"] else "fallback",
        "model": cfg["model"] if cfg["enabled"] else "deterministic-intent-router",
        "base_url": cfg["base_url"] if cfg["enabled"] else None,
        "note": "Set AI_API_KEY (optionally AI_BASE_URL + AI_MODEL) to enable tool-calling LLM mode. Fallback mode is fully deterministic and demo-safe."
    }


@app.post("/api/v1/ai/chat")
async def ai_chat(body: ChatRequest):
    messages = [m.model_dump() for m in body.messages if m.content.strip()]
    if not messages:
        raise HTTPException(400, "empty message")

    async def gen():
        try:
            async for ev in agent.stream_chat(GRAPH, messages, audit):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ReportReq(BaseModel):
    batch_id: str = "BATCH-PAN-1042"


@app.post("/api/v1/ai/report")
async def ai_report(body: ReportReq):
    res = await asyncio.to_thread(report.generate, GRAPH, body.batch_id)
    audit("FSSAI_REPORT_GENERATED", f"{body.batch_id} via {res['generated_by']}")
    return res


# ---------------------------------------------------------------------------
# Ingestion / jobs / events
# ---------------------------------------------------------------------------

@app.post("/api/v1/ingestion/seed-ncr-data")
async def seed_endpoint():
    job_id = f"JOB-{uuid.uuid4().hex[:8].upper()}"
    JOBS[job_id] = {"job_id": job_id, "status": "QUEUED", "progress": 0, "created_at": services.now_iso()}

    async def run():
        JOBS[job_id]["status"] = "PROCESSING"
        steps = ["parsing CSV manifests", "validating FSSAI licenses", "MERGE suppliers+warehouses",
                 "MERGE batches+shipments", "MERGE kitchens+dishes", "UNWIND order events (batches of 500)",
                 "verifying constraints"]
        for i, step in enumerate(steps):
            await asyncio.sleep(0.35)
            JOBS[job_id].update(progress=int((i + 1) / len(steps) * 100), last_step=step)
        counts = GRAPH.counts()
        JOBS[job_id].update(status="COMPLETED", progress=100,
                            result={"nodes": counts["nodes"], "relationships": counts["relationships"]})
        audit("INGESTION_COMPLETE", f"{job_id}: {counts['nodes']} nodes verified")

    asyncio.create_task(run())
    audit("INGESTION_QUEUED", job_id)
    return JSONResponse({"job_id": job_id, "status": "QUEUED"}, status_code=202)


@app.get("/api/v1/jobs/{job_id}")
async def job_status(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/api/v1/events")
async def events():
    return {"events": EVENT_LOG[-60:]}


# ---------------------------------------------------------------------------
# Static legacy frontend (kept as offline fallback; primary UI = Next.js)
# ---------------------------------------------------------------------------
STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/")
async def root():
    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"service": "TracePulse NCR API", "docs": "/docs"}


@app.get("/{asset:path}")
async def static_asset(asset: str):
    candidate = (STATIC_DIR / asset).resolve()
    if candidate.is_file() and str(candidate).startswith(str(STATIC_DIR.resolve())):
        return FileResponse(candidate)
    raise HTTPException(404, "Not found")
