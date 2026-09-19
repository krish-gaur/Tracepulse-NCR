"""
Copilot tools — the LLM orchestrates, the graph computes.
Every tool executes deterministic graph queries; the model can never invent numbers.
"""
from __future__ import annotations

from typing import Callable

import services

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "blast_radius",
            "description": "Downstream blast radius of an ingredient batch: affected kitchens, dishes, orders, exposed consumers, GMV at risk, severity score, order status distribution.",
            "parameters": {
                "type": "object",
                "properties": {"batch_id": {"type": "string", "description": "e.g. BATCH-PAN-1042"}},
                "required": ["batch_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "reverse_trace",
            "description": "Upstream root-cause trace from a customer order back to the supplier/farm (7 hops).",
            "parameters": {
                "type": "object",
                "properties": {"order_id": {"type": "string", "description": "e.g. ORD-8660"}},
                "required": ["order_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "network_summary",
            "description": "Current Delhi NCR network state: clusters, kitchens + statuses, batches + statuses, active incident.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cross_contamination",
            "description": "Batches that shared a temperature-breached (>8 deg C) shipment with the given batch.",
            "parameters": {
                "type": "object",
                "properties": {"batch_id": {"type": "string"}},
                "required": ["batch_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recommend_containment",
            "description": "Flags the batch as an incident (if not already) and returns the surgical containment boundary: severity model + zone directives (FREEZE_PREP / INTERCEPT_DISPATCH / NOTIFY_CONSUMER).",
            "parameters": {
                "type": "object",
                "properties": {"batch_id": {"type": "string"}},
                "required": ["batch_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "execute_containment",
            "description": "Executes one containment action for incident INC-2026-003. action must be FREEZE_PREP, INTERCEPT_DISPATCH or NOTIFY_CONSUMER.",
            "parameters": {
                "type": "object",
                "properties": {"action": {"type": "string", "enum": ["FREEZE_PREP", "INTERCEPT_DISPATCH", "NOTIFY_CONSUMER"]}},
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fssai_report",
            "description": "Generates the FSSAI chain-of-custody incident report (markdown narrative) for a batch.",
            "parameters": {
                "type": "object",
                "properties": {"batch_id": {"type": "string"}},
                "required": ["batch_id"],
            },
        },
    },
]


def _compact_blast(r: dict) -> dict:
    """Trim large payloads before feeding back to the LLM."""
    out = dict(r)
    m = out.get("metrics", {})
    out["orders_sample"] = out.get("orders", [])[:3]
    out.pop("orders", None)
    out.pop("customer_sample", None)
    out["kitchens"] = [{"id": k["id"], "name": k["name"], "status": k["status"]} for k in out.get("kitchens", [])]
    out["dishes"] = [{"name": d["name"], "grams_per_dish": d.get("grams_per_dish")} for d in out.get("dishes", [])]
    out["shipments"] = [{"id": s["id"], "avg_temp_c": s["avg_temp_c"]} for s in out.get("shipments", [])]
    out["metrics"] = m
    return out


def execute_tool(name: str, args: dict, graph, audit: Callable[[str, str], dict]) -> dict:
    """Run one tool deterministically against the graph."""
    try:
        if name == "blast_radius":
            return {"ok": True, "result": _compact_blast(services.blast_radius_data(graph, args["batch_id"]))}
        if name == "reverse_trace":
            return {"ok": True, "result": services.reverse_trace_data(graph, args["order_id"])}
        if name == "network_summary":
            s = services.network_summary_data(graph)
            s["kitchens"] = [{"id": k["id"], "cluster": k["cluster"], "status": k["status"]} for k in s["kitchens"]]
            s["batches"] = [{"id": b["id"], "ingredient_name": b["ingredient_name"], "status": b["status"]} for b in s["batches"]]
            return {"ok": True, "result": s}
        if name == "cross_contamination":
            return {"ok": True, "result": services.cross_contamination_data(graph, args.get("batch_id", "BATCH-PAN-1042"))}
        if name == "recommend_containment":
            audit("COPILOT_CONTAINMENT", f"copilot requested containment plan for {args.get('batch_id')}")
            return {"ok": True, "result": services.create_incident_core(graph, args.get("batch_id", "BATCH-PAN-1042"))}
        if name == "execute_containment":
            res = services.quarantine_core(graph, "INC-2026-003", args["action"], [])
            audit("COPILOT_EXECUTED", f"copilot executed {args['action']}")
            return {"ok": True, "result": res}
        if name == "fssai_report":
            from . import report
            return {"ok": True, "result": report.generate(graph, args.get("batch_id", "BATCH-PAN-1042"))}
        return {"ok": False, "error": f"unknown tool '{name}'"}
    except services.NotFoundError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001 — surfaced to the LLM as a tool error
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def tool_summary(name: str, result: dict) -> str:
    """One-line human/UI summary of a tool result (shown in chat tool chips)."""
    if not result.get("ok"):
        return f"error: {result.get('error')}"
    r = result["result"]
    if name == "blast_radius":
        m = r["metrics"]
        return f"{m['affected_orders']} orders · {m['affected_kitchens']} kitchens · {m['exposed_customers']} consumers · {services.fmt_inr(m['gmv_at_risk_inr'])} at risk · {r['severity']['score']} {r['severity']['class']}"
    if name == "reverse_trace":
        v = r["verdict"]
        return ("root cause " + v["root_cause_batch"] if v["contaminated"] else "path clean") + f" · {r['hops_count']} hops · {r['traversal_ms']} ms"
    if name == "network_summary":
        return f"{len(r['kitchens'])} kitchens · {len(r['batches'])} batches · incident: {'ACTIVE' if r['incident'] else 'none'}"
    if name == "cross_contamination":
        return f"{len(r['co_shipped_batches'])} co-shipped batches on breached vehicle"
    if name == "recommend_containment":
        return f"severity {r['severity_model']['score']} ({r['severity_model']['class']}) · {len(r['containment_boundary'])} zones"
    if name == "execute_containment":
        if r["action"] == "FREEZE_PREP":
            return f"KDS locked: {len(r.get('locked_kitchens', []))} kitchens"
        if r["action"] == "INTERCEPT_DISPATCH":
            return f"{r.get('orders_intercepted', 0)} riders intercepted"
        return f"{r.get('notifications_queued', 0)} consumers alerted"
    if name == "fssai_report":
        return "chain-of-custody report generated"
    return "done"
