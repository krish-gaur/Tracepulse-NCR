"""
TracePulse NCR — Service layer
==============================
Pure functions over the graph store. Shared by:
  * the REST API (app.py)
  * the AI Copilot tool executors (ai/tools.py)
Single source of truth — the LLM can never invent numbers.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from data import INCIDENT
from graphcore import GraphStore, containment_directives, severity_score


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def fmt_inr(v: float) -> str:
    """₹ with Indian digit grouping (1,24,000)."""
    n = str(int(round(v)))
    if len(n) <= 3:
        return "₹" + n
    last3, rest = n[-3:], n[:-3]
    parts = [last3]
    while len(rest) > 2:
        parts.insert(0, rest[-2:])
        rest = rest[:-2]
    if rest:
        parts.insert(0, rest)
    return "₹" + ",".join(parts)


class NotFoundError(Exception):
    pass


# ---------------------------------------------------------------------------
# Network / health
# ---------------------------------------------------------------------------

def network_summary_data(g: GraphStore) -> dict:
    counts = g.counts()
    kitchens = [k.to_dict() for k in g.nodes_by_label("Kitchen")]
    clusters: Dict[str, dict] = {}
    for k in kitchens:
        c = clusters.setdefault(k["cluster"], {"cluster": k["cluster"], "kitchens": 0, "flagged": 0, "ids": []})
        c["kitchens"] += 1
        c["ids"].append(k["id"])
        if k["status"] != "OPERATIONAL":
            c["flagged"] += 1
    return {
        "suppliers": counts["by_label"].get("Supplier", 0),
        "warehouses": [w.to_dict() for w in g.nodes_by_label("Warehouse")],
        "kitchens": kitchens,
        "clusters": list(clusters.values()),
        "batches": [b.to_dict() for b in g.nodes_by_label("Batch")],
        "shipments": [s.to_dict() for s in g.nodes_by_label("Shipment")],
        "orders_total": counts["by_label"].get("Order", 0),
        "incident": INCIDENT if g.find("Incident", INCIDENT["id"]) else None,
    }


# ---------------------------------------------------------------------------
# Blast radius
# ---------------------------------------------------------------------------

def downstream_subgraph(g: GraphStore, batch_id: str) -> dict:
    batch = g.find("Batch", batch_id)
    if batch is None:
        raise NotFoundError(f"Batch {batch_id} not found")

    shipments, kitchens, dishes = [], [], []
    for rel, sh in g.neighbors(batch, "SHIPPED_VIA", "out", "Shipment"):
        shipments.append((rel, sh))
        for r2, k in g.neighbors(sh, "DELIVERED_TO", "out", "Kitchen"):
            kitchens.append((r2, k))
    for rel, d in g.neighbors(batch, "USES_BATCH", "in", "Dish"):
        dishes.append((rel, d))

    orders: Dict[str, Any] = {}
    for _, d in dishes:
        for rel, o in g.neighbors(d, "CONTAINS_ITEM", "in", "Order"):
            orders[o.props["id"]] = o

    customers: Dict[str, Any] = {}
    for o in orders.values():
        for rel, c in g.neighbors(o, "PLACED_BY", "out", "Customer"):
            customers[c.props["id"]] = c

    status_counts = {"PREPARING": 0, "OUT_FOR_DELIVERY": 0, "DELIVERED": 0, "INTERCEPTED": 0}
    gmv = 0.0
    order_rows = []
    for o in sorted(orders.values(), key=lambda x: x.props["ordered_at"]):
        st = o.props["status"]
        status_counts[st] = status_counts.get(st, 0) + 1
        gmv += o.props["total_inr"]
        dish_name = next((g.nodes[r.start].props["name"] for r in o.in_rels if r.type == "CONTAINS_ITEM"), "")
        kit = next((g.nodes[r.end].props for r in o.out_rels if r.type == "FULFILLED_AT"), None)
        order_rows.append({
            "order_id": o.props["id"], "status": st, "total_inr": o.props["total_inr"],
            "dish": dish_name, "kitchen": kit["name"] if kit else None,
            "cluster": kit["cluster"] if kit else None, "ordered_at": o.props["ordered_at"],
        })

    clusters = sorted({k.props["cluster"] for _, k in kitchens})
    return {
        "batch": batch.to_dict(),
        "shipments": [sh.to_dict() for _, sh in shipments],
        "warehouses": [w.to_dict() for _, w in g.neighbors(batch, "STORED_AT", "out", "Warehouse")],
        "kitchens": [k.to_dict() for _, k in kitchens],
        "dishes": [{**d.to_dict(), "grams_per_dish": rel.props.get("grams_per_dish")} for rel, d in dishes],
        "orders": order_rows,
        "status_counts": status_counts,
        "customers_exposed": len(customers),
        "customer_sample": [c.to_dict() for c in list(customers.values())[:12]],
        "metrics": {
            "affected_kitchens": len({k.props["id"] for _, k in kitchens}),
            "affected_dishes": len(dishes),
            "affected_orders": len(orders),
            "exposed_customers": len(customers),
            "gmv_at_risk_inr": round(gmv, 2),
            "clusters": clusters,
            "hops": 5,
        },
    }


def blast_radius_data(g: GraphStore, batch_id: str) -> dict:
    import time
    t0 = time.perf_counter()
    sub = downstream_subgraph(g, batch_id)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    m = sub["metrics"]
    m["traversal_ms"] = round(elapsed_ms, 3)
    sc = sub["status_counts"]
    breach = any(s["avg_temp_c"] > 8 for s in sub["shipments"])
    sev = severity_score(sc.get("PREPARING", 0), sc.get("OUT_FOR_DELIVERY", 0),
                         sc.get("DELIVERED", 0), "listeria", breach)
    return {
        "batch_id": batch_id,
        "incident": INCIDENT if batch_id == INCIDENT["batch_id"] else None,
        "metrics": m,
        "status_counts": sc,
        "severity": sev,
        "temp_breach": breach,
        "breach_shipment": next((s["id"] for s in sub["shipments"] if s["avg_temp_c"] > 8), None),
        "orders": sub["orders"][:80],
        "orders_returned": min(len(sub["orders"]), 80),
        "customer_sample": sub["customer_sample"],
        "dishes": sub["dishes"],
        "kitchens": sub["kitchens"],
        "shipments": sub["shipments"],
    }


def trace_graph_data(g: GraphStore, batch_id: str, depth: int = 5) -> dict:
    from data import AFFECTED_CUSTOMERS
    batch = g.find("Batch", batch_id)
    if batch is None:
        raise NotFoundError(f"Batch {batch_id} not found")

    nodes: Dict[str, dict] = {}
    edges: List[dict] = []

    def add(node, hop, ring):
        nid = node.props["id"]
        if nid not in nodes:
            nodes[nid] = {"id": nid, "label": node.label, "hop": hop, "ring": ring, **node.to_dict()}
        return nid

    bid = add(batch, 0, 0)
    frontier = [(batch, 0)]
    plan = [("SHIPPED_VIA", "Shipment"), ("DELIVERED_TO", "Kitchen"), ("PREPARED", "Dish")]
    for hop, (rt, lbl) in enumerate(plan[: max(1, min(depth, 5))], start=1):
        nxt = []
        for node, _ in frontier:
            for rel, other in g.neighbors(node, rt, "out", lbl):
                oid = add(other, hop, hop)
                edges.append({"source": node.props["id"], "target": oid, "type": rt, "props": rel.props})
                nxt.append((other, hop))
        frontier = nxt

    dishes = [n for n in nodes.values() if n["label"] == "Dish"]
    for d in dishes:
        dnode = g.find("Dish", d["id"])
        edges.append({"source": d["id"], "target": bid, "type": "USES_BATCH", "props": {}})
        order_nodes: Dict[str, int] = {}
        for rel, o in g.neighbors(dnode, "CONTAINS_ITEM", "in", "Order"):
            order_nodes[o.props["status"]] = order_nodes.get(o.props["status"], 0) + 1
        for status, cnt in order_nodes.items():
            cid = f"COHORT-{batch_id}-{status}"
            if cid not in nodes:
                nodes[cid] = {"id": cid, "label": "OrderCohort", "status": status, "count": cnt, "hop": 4, "ring": 4}
            edges.append({"source": d["id"], "target": cid, "type": "CONTAINS_ITEM", "props": {"count": cnt}})

    total_orders = sum(n.get("count", 0) for n in nodes.values() if n["label"] == "OrderCohort")
    if total_orders:
        nodes["CONSUMERS"] = {"id": "CONSUMERS", "label": "Consumers", "count": AFFECTED_CUSTOMERS, "hop": 5, "ring": 5}
        for cid in [n["id"] for n in nodes.values() if n["label"] == "OrderCohort"]:
            edges.append({"source": cid, "target": "CONSUMERS", "type": "PLACED_BY", "props": {}})

    return {"batch_id": batch_id, "nodes": list(nodes.values()), "edges": edges, "depth": depth}


# ---------------------------------------------------------------------------
# Reverse trace
# ---------------------------------------------------------------------------

def reverse_trace_data(g: GraphStore, order_id: str) -> dict:
    import time
    t0 = time.perf_counter()
    order = g.find("Order", order_id)
    if order is None:
        raise NotFoundError(f"Order {order_id} not found")

    hops: List[dict] = [{"entity": "Order", "hop": 0, **order.to_dict()}]
    dish = next((g.nodes[r.end] for r in order.out_rels if r.type == "CONTAINS_ITEM"), None)
    if dish:
        hops.append({"entity": "Dish", "hop": 1, **dish.to_dict()})
        kitchen = next((g.nodes[r.end] for r in order.out_rels if r.type == "FULFILLED_AT"), None)
        batch = next((g.nodes[r.end] for r in dish.out_rels if r.type == "USES_BATCH"), None)
        if kitchen:
            hops.append({"entity": "Kitchen", "hop": 2, **kitchen.to_dict()})
        if batch:
            shipment = next(
                (g.nodes[r.end] for r in batch.out_rels if r.type == "SHIPPED_VIA"
                 and any(rr.type == "DELIVERED_TO" and kitchen and rr.end == kitchen.id
                         for rr in g.nodes[r.end].out_rels)),
                next((g.nodes[r.end] for r in batch.out_rels if r.type == "SHIPPED_VIA"), None))
            if shipment:
                hops.append({"entity": "Shipment", "hop": 3, **shipment.to_dict()})
            warehouse = next((g.nodes[r.end] for r in batch.out_rels if r.type == "STORED_AT"), None)
            if warehouse:
                hops.append({"entity": "Warehouse", "hop": 4, **warehouse.to_dict()})
            hops.append({"entity": "Batch", "hop": 5, **batch.to_dict()})
            supplier = next((g.nodes[r.start] for r in batch.in_rels if r.type == "SUPPLIED"), None)
            if supplier:
                hops.append({"entity": "Supplier", "hop": 6, **supplier.to_dict()})

    flagged = next((h for h in hops if h["entity"] == "Batch" and h.get("status") != "CLEAR"), None)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    return {
        "order_id": order_id,
        "hops": hops,
        "hops_count": len(hops),
        "verdict": {
            "contaminated": bool(flagged),
            "root_cause_batch": flagged["id"] if flagged else None,
            "root_cause_supplier": next((h["name"] for h in hops if h["entity"] == "Supplier"), None),
            "incident": INCIDENT if flagged and flagged["id"] == INCIDENT["batch_id"] else None,
        },
        "traversal_ms": round(elapsed_ms, 3),
    }


# ---------------------------------------------------------------------------
# Cross-contamination (cold-chain breach correlation)
# ---------------------------------------------------------------------------

def cross_contamination_data(g: GraphStore, batch_id: str) -> dict:
    batch = g.find("Batch", batch_id)
    if batch is None:
        raise NotFoundError(f"Batch {batch_id} not found")
    rows = []
    for rel, ship in g.neighbors(batch, "SHIPPED_VIA", "out", "Shipment"):
        if ship.props.get("avg_temp_c", 0) <= 8:
            continue
        for r2 in ship.in_rels:
            if r2.type != "SHIPPED_VIA":
                continue
            other = g.nodes[r2.start]
            if other.label != "Batch" or other.id == batch.id:
                continue
            rows.append({
                "batch_id": other.props["id"], "ingredient": other.props["ingredient_name"],
                "status": other.props["status"], "shared_shipment": ship.props["id"],
                "vehicle": ship.props["vehicle_plate"], "temp_c": ship.props["avg_temp_c"],
            })
    return {"batch_id": batch_id, "breach_threshold_c": 8.0, "co_shipped_batches": rows}


# ---------------------------------------------------------------------------
# Incidents & containment
# ---------------------------------------------------------------------------

def create_incident_core(g: GraphStore, batch_id: str, reason: str = "Listeria monocytogenes",
                         severity: str = "CRITICAL", operator_id: str = "QA-OFFICER-07") -> dict:
    batch = g.find("Batch", batch_id)
    if batch is None:
        raise NotFoundError(f"Batch {batch_id} not found")
    inc, created = g.merge_node("Incident", {
        "id": INCIDENT["id"], "reason": reason, "severity": severity,
        "created_at": now_iso(), "flagged_by": operator_id,
    })
    g.merge_rel("FLAGGED_AS", inc, batch, {"flagged_by": operator_id, "lab_report_ref": INCIDENT["lab_report_ref"]})
    batch.props["status"] = "QUARANTINED"

    sub = downstream_subgraph(g, batch_id)
    sc = sub["status_counts"]
    breach = any(s["avg_temp_c"] > 8 for s in sub["shipments"])
    sev = severity_score(sc.get("PREPARING", 0), sc.get("OUT_FOR_DELIVERY", 0),
                         sc.get("DELIVERED", 0), "listeria", breach)
    zones = containment_directives(sc, [k["id"] for k in sub["kitchens"]], [d["name"] for d in sub["dishes"]])
    return {
        "incident_id": inc.props["id"], "created": created,
        "batch_id": batch_id, "severity_model": sev,
        "blast_summary": sub["metrics"], "status_counts": sc,
        "containment_boundary": zones, "temp_breach": breach,
    }


def quarantine_core(g: GraphStore, incident_id: str, action: str, target_kitchen_ids: List[str]) -> dict:
    inc = g.find("Incident", incident_id)
    if inc is None:
        raise NotFoundError("Incident not found")
    batch = next((g.nodes[r.end] for r in inc.out_rels if r.type == "FLAGGED_AS"), None)
    result: Dict[str, Any] = {"incident_id": incident_id, "action": action, "executed_at": now_iso()}

    if action == "FREEZE_PREP":
        locked = []
        candidates = target_kitchen_ids or [k.props["id"] for k in g.nodes_by_label("Kitchen")]
        for kid in candidates:
            k = g.find("Kitchen", kid)
            if k and k.props["status"] == "OPERATIONAL":
                k.props["status"] = "PARTIAL_HOLD"
                locked.append(kid)
        result["locked_kitchens"] = locked
        result["note"] = "Only paneer SKU lines frozen — biryani/dal/breads remain LIVE"

    elif action == "INTERCEPT_DISPATCH":
        n = 0
        dishes = [g.nodes[r.start] for r in batch.in_rels if r.type == "USES_BATCH"] if batch else []
        for d in dishes:
            for r in d.in_rels:
                if r.type != "CONTAINS_ITEM":
                    continue
                o = g.nodes[r.start]
                if o.props["status"] == "OUT_FOR_DELIVERY":
                    o.props["status"] = "INTERCEPTED"
                    n += 1
        result["orders_intercepted"] = n

    elif action == "NOTIFY_CONSUMER":
        sub = downstream_subgraph(g, batch.props["id"]) if batch else {"status_counts": {}}
        delivered = sub["status_counts"].get("DELIVERED", 0)
        result["notifications_queued"] = delivered
        result["channel"] = "SMS/WhatsApp webhook (simulated)"
        result["message"] = "URGENT: Your order contains recalled Batch B-1042 (Malai Paneer). Do not consume. Refund initiated."
    else:
        raise ValueError(f"Unknown action {action}")

    return result
