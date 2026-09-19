"""
TracePulse NCR — Graph Core Engine
==================================
A faithful, hackathon-portable emulation of Neo4j-style *index-free adjacency*.

Nodes are records; relationships are first-class objects that store DIRECT
pointers (native ids) to their start/end nodes. Traversal cost is therefore
O(local subgraph degree) — independent of total dataset size — exactly the
property Neo4j gives you physically on disk.

Swap-in for production: replace `GraphStore` calls with the official async
Neo4j driver + the parameterized Cypher shipped in `cypher_reference.py`.
The REST contract stays identical.
"""
from __future__ import annotations

import itertools
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Core records
# ---------------------------------------------------------------------------

_rel_seq = itertools.count(1)


@dataclass
class Relationship:
    type: str
    start: int                      # node id of start node (direct pointer)
    end: int                        # node id of end node (direct pointer)
    props: Dict[str, Any] = field(default_factory=dict)
    id: int = field(default_factory=lambda: next(_rel_seq))


class Node:
    __slots__ = ("id", "label", "props", "out_rels", "in_rels")

    def __init__(self, id: int, label: str, props: Dict[str, Any]):
        self.id = id
        self.label = label
        self.props = props
        self.out_rels: List[Relationship] = []   # physical adjacency lists
        self.in_rels: List[Relationship] = []

    def to_dict(self) -> Dict[str, Any]:
        return {"label": self.label, **self.props}


class GraphStore:
    """Property-graph store with unique-constraint enforcement + MERGE."""

    def __init__(self) -> None:
        self.nodes: Dict[int, Node] = {}
        self.labels: Dict[str, Dict[str, int]] = {}   # label -> {id_prop: node_id}
        self.rels: Dict[int, Relationship] = {}
        self._seq = itertools.count(1)
        self.created_at = time.time()

    # -- schema --------------------------------------------------------------
    def create_node(self, label: str, props: Dict[str, Any]) -> Node:
        """CREATE with unique-constraint enforcement on `id` (FSSAI-grade)."""
        pid = props.get("id")
        if pid is not None:
            bucket = self.labels.setdefault(label, {})
            if pid in bucket:
                raise ValueError(f"Unique constraint violation: :{label} {{id:'{pid}'}}")
        node = Node(next(self._seq), label, dict(props))
        if pid is not None:
            self.labels.setdefault(label, {})[pid] = node.id
        self.nodes[node.id] = node
        return node

    def merge_node(self, label: str, props: Dict[str, Any]) -> Tuple[Node, bool]:
        """Idempotent MERGE on (label, id). Returns (node, created?)."""
        pid = props.get("id")
        if pid is not None:
            existing = self.labels.get(label, {}).get(pid)
            if existing is not None:
                node = self.nodes[existing]
                node.props.update({k: v for k, v in props.items() if v is not None})
                return node, False
        return self.create_node(label, props), True

    def merge_rel(self, type: str, start: Node, end: Node,
                  props: Optional[Dict[str, Any]] = None) -> Tuple[Relationship, bool]:
        """Idempotent relationship MERGE keyed on (type, start, end)."""
        for r in start.out_rels:
            if r.type == type and r.end == end.id:
                if props:
                    r.props.update(props)
                return r, False
        rel = Relationship(type, start.id, end.id, dict(props or {}))
        self.rels[rel.id] = rel
        start.out_rels.append(rel)
        end.in_rels.append(rel)
        return rel, True

    # -- lookups -------------------------------------------------------------
    def find(self, label: str, id_value: str) -> Optional[Node]:
        nid = self.labels.get(label, {}).get(id_value)
        return self.nodes.get(nid) if nid is not None else None

    def nodes_by_label(self, label: str) -> Iterable[Node]:
        for nid in self.labels.get(label, {}).values():
            yield self.nodes[nid]

    def counts(self) -> Dict[str, int]:
        by_label: Dict[str, int] = {}
        for n in self.nodes.values():
            by_label[n.label] = by_label.get(n.label, 0) + 1
        return {"nodes": len(self.nodes), "relationships": len(self.rels), "by_label": by_label}

    # -- traversals (the money operations) ------------------------------------
    def neighbors(self, node: Node, rel_type: Optional[str] = None,
                   direction: str = "out", target_label: Optional[str] = None) -> List[Tuple[Relationship, Node]]:
        """One pointer-dereference hop. O(degree of node)."""
        pool = node.out_rels if direction == "out" else node.in_rels if direction == "in" else node.out_rels + node.in_rels
        out = []
        for r in pool:
            if rel_type and r.type != rel_type:
                continue
            other = self.nodes[r.end if direction != "in" else r.start]
            if direction == "in":
                other = self.nodes[r.start]
            if target_label and other.label != target_label:
                continue
            out.append((r, other))
        return out

    def bfs_downstream(self, start: Node, edge_plan: List[Tuple[str, Optional[str]]],
                       hop_delay_ms: float = 0.0) -> Tuple[List[dict], List[dict]]:
        """
        Deterministic cascade traversal following the supply-chain DAG:
          Batch ->(STORED_AT|SHIPPED_VIA)-> ... -> Customer
        edge_plan entries: (rel_type, end_label). Returns (visited_nodes, visited_edges)
        in BFS hop order so the UI can replay the traversal animated.
        """
        visited_nodes: List[dict] = []
        visited_edges: List[dict] = []
        seen_nodes = {start.id}
        visited_nodes.append({"hop": 0, **start.to_dict()})
        frontier = [start]
        for hop, (rel_type, end_label) in enumerate(edge_plan, start=1):
            if hop_delay_ms:
                time.sleep(hop_delay_ms / 1000.0)
            nxt: List[Node] = []
            for node in frontier:
                for rel, other in self.neighbors(node, rel_type=rel_type, direction="out", target_label=end_label):
                    visited_edges.append({
                        "hop": hop, "type": rel.type,
                        "source": node.props.get("id"), "target": other.props.get("id"),
                        "props": rel.props,
                    })
                    if other.id not in seen_nodes:
                        seen_nodes.add(other.id)
                        visited_nodes.append({"hop": hop, **other.to_dict()})
                        nxt.append(other)
            frontier = nxt
            if not frontier:
                break
        return visited_nodes, visited_edges


# ---------------------------------------------------------------------------
# Containment Boundary Engine (deterministic rules — no LLMs, no vibes)
# ---------------------------------------------------------------------------

ZONE_META = {
    "ZONE1_FREEZE_PREP": {
        "action": "FREEZE_PREP",
        "title": "KDS Prep Lock",
        "desc": "Electronic lock on kitchen display stations assembling affected SKUs only.",
    },
    "ZONE2_INTERCEPT_DISPATCH": {
        "action": "INTERCEPT_DISPATCH",
        "title": "Rider Intercept",
        "desc": "Automated recall ping to riders — do not hand over, return to kitchen.",
    },
    "ZONE3_NOTIFY_CONSUMER": {
        "action": "NOTIFY_CONSUMER",
        "title": "Consumer Safety Alert",
        "desc": "Batch SMS/WhatsApp to delivered customers via privacy-safe phone hashes.",
    },
}

STATUS_WEIGHTS = {"PREPARING": 2.0, "OUT_FOR_DELIVERY": 3.0, "DELIVERED": 1.5}
PATHOGEN_SEVERITY = {
    "listeria": 1.0, "salmonella": 1.0, "e_coli": 1.0,
    "spoilage": 0.6, "packaging_defect": 0.3, "cold_chain_failure": 0.8,
}


def severity_score(prep: int, transit: int, delivered: int,
                   pathogen: str = "listeria", temp_breach: bool = False) -> dict:
    s_bio = PATHOGEN_SEVERITY.get(pathogen, 0.5)
    base = prep * STATUS_WEIGHTS["PREPARING"] + transit * STATUS_WEIGHTS["OUT_FOR_DELIVERY"] + delivered * STATUS_WEIGHTS["DELIVERED"]
    c_temp = 1.5 if temp_breach else 1.0
    score = s_bio * base * c_temp
    if score >= 700:
        cls = "CRITICAL"
    elif score >= 350:
        cls = "HIGH"
    elif score >= 120:
        cls = "MEDIUM"
    else:
        cls = "LOW"
    return {
        "score": round(score, 1), "class": cls,
        "formula": f"{s_bio} × ({prep}×2.0 + {transit}×3.0 + {delivered}×1.5) × {c_temp}",
        "components": {
            "S_bio": s_bio, "orders_prep": prep, "orders_transit": transit,
            "orders_delivered": delivered, "C_temp_breach": c_temp,
        },
    }


def containment_directives(status_counts: Dict[str, int], kitchens: List[str], dishes: List[str]) -> List[dict]:
    zones = []
    prep = status_counts.get("PREPARING", 0)
    transit = status_counts.get("OUT_FOR_DELIVERY", 0)
    delivered = status_counts.get("DELIVERED", 0)
    if prep:
        zones.append({
            "zone": "ZONE1_FREEZE_PREP", **ZONE_META["ZONE1_FREEZE_PREP"],
            "scope": {"orders": prep, "kitchens": kitchens, "dishes_locked": dishes},
            "directive": f"Halt assembly of {len(dishes)} paneer SKUs at {len(kitchens)} stations; non-affected lines (biryani, dal, breads) remain LIVE.",
        })
    if transit:
        zones.append({
            "zone": "ZONE2_INTERCEPT_DISPATCH", **ZONE_META["ZONE2_INTERCEPT_DISPATCH"],
            "scope": {"orders": transit},
            "directive": f"Push recall ping to {transit} active riders; mark orders INTERCEPTED.",
        })
    if delivered:
        zones.append({
            "zone": "ZONE3_NOTIFY_CONSUMER", **ZONE_META["ZONE3_NOTIFY_CONSUMER"],
            "scope": {"orders": delivered},
            "directive": f"Fire safety SMS webhook to {delivered} delivered orders via phone_hash list.",
        })
    return zones
