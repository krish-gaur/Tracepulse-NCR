"""
TracePulse NCR — Realistic Delhi NCR seed dataset + deterministic loader.

Matches the blueprint exactly:
  * Batch B-1042 (Malai Paneer, Amrit Dairies Murthal) -> WH-KUN-01 Kundli
  * 4 cold-chain shipments (SH-201/204/209/212, SH-209 has a 9.4 deg C breach)
  * 6 cloud kitchens across NOIDA / GURUGRAM / SOUTH_DELHI clusters
  * 3 paneer dishes, 342 affected orders (48 PREPARING / 82 OUT_FOR_DELIVERY / 212 DELIVERED)
  * 489 exposed consumers, Rs 1,24,000 GMV at risk
"""
from __future__ import annotations

import hashlib
import random
from datetime import date, datetime, timedelta, timezone

from graphcore import GraphStore, containment_directives, severity_score

INCIDENT = {
    "id": "INC-2026-003",
    "batch_id": "BATCH-PAN-1042",
    "reason": "Listeria monocytogenes — FSSAI lab confirm",
    "severity": "CRITICAL",
    "pathogen": "listeria",
    "created_at": "2026-09-19T14:02:11+05:30",
    "flagged_by": "QA-OFFICER-07",
    "lab_report_ref": "FSSAI/LAB/2026/4471",
}

# ---------------------------------------------------------------------------
# Static entities
# ---------------------------------------------------------------------------

SUPPLIERS = [
    {"id": "SUP-MUR-01", "name": "Amrit Dairies Ltd", "category": "DAIRY", "location": "Murthal, Sonipat, Haryana", "fssai_license": "10819005000123", "rating": 4.8},
    {"id": "SUP-BUL-02", "name": "Ganga Fresh Agro", "category": "PRODUCE", "location": "Bulandshahr, Western UP", "fssai_license": "12720011000456", "rating": 4.5},
    {"id": "SUP-GAZ-03", "name": "Delhi-NCR Poultry Farms", "category": "POULTRY", "location": "Ghazipur, Delhi", "fssai_license": "13318001000789", "rating": 4.2},
]

WAREHOUSES = [
    {"id": "WH-KUN-01", "name": "Kundli Cold Storage Gateway", "zone": "NORTH_NCR", "capacity_sqft": 45000},
    {"id": "WH-GNO-02", "name": "Greater Noida Logistics Hub", "zone": "EAST_NCR", "capacity_sqft": 60000},
    {"id": "WH-OKH-03", "name": "Okhla Industrial Cold Unit", "zone": "SOUTH_NCR", "capacity_sqft": 30000},
]

KITCHENS = [
    {"id": "KIT-NOI-62", "name": "Noida Sector 62 Cloud Kitchen", "cluster": "NOIDA", "latitude": 28.6280, "longitude": 77.3649, "status": "OPERATIONAL"},
    {"id": "KIT-NOI-18", "name": "Atta Market Cloud Kitchen", "cluster": "NOIDA", "latitude": 28.5708, "longitude": 77.3261, "status": "OPERATIONAL"},
    {"id": "KIT-GUR-CYB", "name": "DLF Cyber Hub Kitchen", "cluster": "GURUGRAM", "latitude": 28.4952, "longitude": 77.0895, "status": "OPERATIONAL"},
    {"id": "KIT-GUR-GCR", "name": "Golf Course Extension Hub", "cluster": "GURUGRAM", "latitude": 28.4138, "longitude": 77.0712, "status": "OPERATIONAL"},
    {"id": "KIT-DEL-HAU", "name": "Hauz Khas Cloud Kitchen", "cluster": "SOUTH_DELHI", "latitude": 28.5494, "longitude": 77.2001, "status": "OPERATIONAL"},
    {"id": "KIT-DEL-OKH", "name": "Okhla Phase-2 Dark Kitchen", "cluster": "SOUTH_DELHI", "latitude": 28.5120, "longitude": 77.2780, "status": "OPERATIONAL"},
]

SHIPMENTS = [
    {"id": "SH-201", "vehicle_plate": "DL-1L-AA-5512", "temp_monitored": True, "avg_temp_c": 5.2, "dispatched_at": "2026-09-19T06:40:00+05:30", "delivered_at": "2026-09-19T08:05:00+05:30"},
    {"id": "SH-204", "vehicle_plate": "HR-38B-7741", "temp_monitored": True, "avg_temp_c": 4.8, "dispatched_at": "2026-09-19T06:55:00+05:30", "delivered_at": "2026-09-19T08:20:00+05:30"},
    {"id": "SH-209", "vehicle_plate": "DL-9C-BB-2203", "temp_monitored": True, "avg_temp_c": 9.4, "dispatched_at": "2026-09-19T07:10:00+05:30", "delivered_at": "2026-09-19T08:45:00+05:30"},
    {"id": "SH-212", "vehicle_plate": "UP-16D-4478", "temp_monitored": True, "avg_temp_c": 5.9, "dispatched_at": "2026-09-19T07:25:00+05:30", "delivered_at": "2026-09-19T09:00:00+05:30"},
]

# batch -> kitchens it was delivered to (via which shipment)
BATCH_ROUTES = {
    "BATCH-PAN-1042": [("SH-201", ["KIT-NOI-62", "KIT-NOI-18"]),
                       ("SH-204", ["KIT-GUR-CYB", "KIT-GUR-GCR"]),
                       ("SH-209", ["KIT-DEL-HAU"]),
                       ("SH-212", ["KIT-DEL-OKH"])],
    "BATCH-CHK-3011": [("SH-201", ["KIT-NOI-62"]), ("SH-212", ["KIT-DEL-OKH"])],
    "BATCH-TOM-2088": [("SH-204", ["KIT-GUR-CYB"]), ("SH-209", ["KIT-DEL-HAU"])],
    "BATCH-CRM-1150": [("SH-209", ["KIT-DEL-HAU"])],
    "BATCH-BUT-1204": [("SH-209", ["KIT-DEL-HAU"])],
}

BATCHES = [
    {"id": "BATCH-PAN-1042", "ingredient_name": "Malai Paneer", "supplier": "SUP-MUR-01", "mfg_date": "2026-09-17", "expiry_date": "2026-09-22", "quantity_kg": 500.0, "storage_temp_target_c": 4.0, "status": "SUSPECT"},
    {"id": "BATCH-CHK-3011", "ingredient_name": "Fresh Broiler Cuts", "supplier": "SUP-GAZ-03", "mfg_date": "2026-09-18", "expiry_date": "2026-09-21", "quantity_kg": 400.0, "storage_temp_target_c": 1.0, "status": "CLEAR"},
    {"id": "BATCH-TOM-2088", "ingredient_name": "Hybrid Tomatoes", "supplier": "SUP-BUL-02", "mfg_date": "2026-09-16", "expiry_date": "2026-09-24", "quantity_kg": 1200.0, "storage_temp_target_c": 12.0, "status": "CLEAR"},
    {"id": "BATCH-CRM-1150", "ingredient_name": "Malai Cream", "supplier": "SUP-MUR-01", "mfg_date": "2026-09-17", "expiry_date": "2026-09-21", "quantity_kg": 180.0, "storage_temp_target_c": 4.0, "status": "SUSPECT"},
    {"id": "BATCH-BUT-1204", "ingredient_name": "White Butter Blocks", "supplier": "SUP-MUR-01", "mfg_date": "2026-09-17", "expiry_date": "2026-09-25", "quantity_kg": 220.0, "storage_temp_target_c": 4.0, "status": "SUSPECT"},
]

DISHES = [
    {"id": "DISH-PAN-BUTTER", "name": "Paneer Butter Masala Box", "category": "MAIN_COURSE", "shelf_life_hours": 4, "grams_per_dish": 220},
    {"id": "DISH-PAN-TIKKA", "name": "Tandoori Paneer Tikka Platter", "category": "APPETIZER", "shelf_life_hours": 3, "grams_per_dish": 250},
    {"id": "DISH-MUG-ROLL", "name": "Mughlai Paneer Kathi Roll", "category": "ROLL", "shelf_life_hours": 4, "grams_per_dish": 150},
    # unaffected lines — proof of surgical containment
    {"id": "DISH-CHK-BIRYANI", "name": "Dum Chicken Biryani", "category": "MAIN_COURSE", "shelf_life_hours": 6, "grams_per_dish": 300},
    {"id": "DISH-DAL-MAKHANI", "name": "Dal Makhani Bowl", "category": "MAIN_COURSE", "shelf_life_hours": 8, "grams_per_dish": 260},
]

# dish -> batch usage (the critical [:USES_BATCH] link)
DISH_BATCH_USE = {
    "DISH-PAN-BUTTER": "BATCH-PAN-1042",
    "DISH-PAN-TIKKA": "BATCH-PAN-1042",
    "DISH-MUG-ROLL": "BATCH-PAN-1042",
    "DISH-CHK-BIRYANI": "BATCH-CHK-3011",
    "DISH-DAL-MAKHANI": "BATCH-BUT-1204",
}

ALL_CUSTOMERS = [
    {"id": "CUST-DEL-401", "sector": "Noida Sector 62"},
    {"id": "CUST-DEL-402", "sector": "Noida Sector 18"},
    {"id": "CUST-GUR-501", "sector": "DLF Phase 3"},
    {"id": "CUST-GUR-502", "sector": "Sohna Road"},
    {"id": "CUST-NOI-601", "sector": "Indirapuram"},
    {"id": "CUST-DEL-771", "sector": "Hauz Khas"},
    {"id": "CUST-DEL-772", "sector": "Saket"},
    {"id": "CUST-NOI-655", "sector": "Vaishali"},
]

FIRST_NAMES = ["Rahul", "Priya", "Aman", "Sneha", "Vikram", "Pooja", "Arjun", "Neha", "Karan", "Ishita", "Rohit", "Meera"]
LAST_NAMES = ["Sharma", "Verma", "Gupta", "Singh", "Mehta", "Iyer", "Khan", "Chopra", "Reddy", "Bansal", "Joshi", "Kapoor"]

PRICE_BANDS = {
    "DISH-PAN-BUTTER": (329, 419), "DISH-PAN-TIKKA": (299, 389), "DISH-MUG-ROLL": (179, 229),
    "DISH-CHK-BIRYANI": (389, 479), "DISH-DAL-MAKHANI": (259, 329),
}

# deterministic affected-order blueprint numbers
AFFECTED_TOTAL, AFFECTED_PREP, AFFECTED_TRANSIT, AFFECTED_DELIVERED = 342, 48, 82, 212
AFFECTED_CUSTOMERS, AFFECTED_GMV = 489, 124000.0
CLEAN_ORDERS = 220

ORDER_START = datetime(2026, 9, 19, 11, 5, tzinfo=timezone.utc)


def _mask(rng: random.Random) -> str:
    return f"{rng.choice(FIRST_NAMES)[0]}***** {rng.choice(LAST_NAMES)[0]}*****"


def _phone_hash(cid: str, salt: int) -> str:
    return hashlib.sha256(f"+91-98{salt:06d}{cid}".encode()).hexdigest()[:20]


def seed_graph(g: GraphStore) -> dict:
    """Load the full NCR dataset with idempotent MERGE semantics."""
    for s in SUPPLIERS:
        g.merge_node("Supplier", s)
    for w in WAREHOUSES:
        g.merge_node("Warehouse", w)
    for k in KITCHENS:
        g.merge_node("Kitchen", dict(k))
    for sh in SHIPMENTS:
        g.merge_node("Shipment", sh)
    for d in DISHES:
        grams = d.pop("grams_per_dish", None)
        g.merge_node("Dish", d)
        if grams is not None:
            d["grams_per_dish"] = grams

    # Suppliers -> Batches, Batches -> Warehouse (B-1042 via Kundli bay C-14)
    for b in BATCHES:
        bnode, _ = g.merge_node("Batch", {k: v for k, v in b.items() if k != "supplier"})
        sup = g.find("Supplier", b["supplier"])
        g.merge_rel("SUPPLIED", sup, bnode, {"supplied_date": b["mfg_date"]})
        wh = g.find("Warehouse", "WH-KUN-01" if b["id"].startswith(("BATCH-PAN", "BATCH-CRM", "BATCH-BUT")) else "WH-GNO-02")
        g.merge_rel("STORED_AT", bnode, wh, {"intake_date": f"{b['mfg_date']}T18:30:00+05:30", "bay_number": "C-14" if b["id"] == "BATCH-PAN-1042" else "A-03"})

    # Batch -> Shipment -> Kitchen routes
    for batch_id, routes in BATCH_ROUTES.items():
        bnode = g.find("Batch", batch_id)
        for ship_id, kitchen_ids in routes:
            ship = g.find("Shipment", ship_id)
            g.merge_rel("SHIPPED_VIA", bnode, ship, {"quantity_dispatched_kg": round(bnode.props["quantity_kg"] / len(routes), 1)})
            for kid in kitchen_ids:
                kit = g.find("Kitchen", kid)
                g.merge_rel("DELIVERED_TO", ship, kit, {"arrived_at": ship.props["delivered_at"], "dock_temp_c": ship.props["avg_temp_c"]})

    # Kitchen -> Dish prep lines + Dish -> Batch BOM
    for d in DISHES:
        dnode = g.find("Dish", d["id"])
        batch_id = DISH_BATCH_USE[d["id"]]
        bnode = g.find("Batch", batch_id)
        for kid in [k for k, routes in BATCH_ROUTES.items() if k == batch_id for _, ks in routes for k2 in ks]:
            pass  # (routes resolved below per kitchen)
        kitchens_with_batch = {kid for _, ks in BATCH_ROUTES.get(batch_id, []) for kid in ks}
        for kid in kitchens_with_batch:
            kit = g.find("Kitchen", kid)
            g.merge_rel("PREPARED", kit, dnode, {"prep_date": "2026-09-19", "shift": "LUNCH"})
        g.merge_rel("USES_BATCH", dnode, bnode, {"grams_per_dish": d.get("grams_per_dish", 200)})

    rng = random.Random(20260919)

    def make_orders(dish_pool, count, statuses, start_ord):
        rows = []
        for i in range(count):
            cust = rng.choice(ALL_CUSTOMERS)
            dish_id = rng.choice(dish_pool)
            lo, hi = PRICE_BANDS[dish_id]
            status = statuses[i % len(statuses)] if isinstance(statuses, list) else statuses
            rows.append({
                "id": f"ORD-{start_ord + i}",
                "customer": cust, "dish": dish_id, "status": status,
                "total_inr": float(rng.randrange(lo, hi, 10)),
                "ordered_at": (CLEAN_BASE + timedelta(minutes=int(i * 2.4))).isoformat(),
            })
        return rows

    # ---- affected paneer orders: exact blueprint distribution ----
    CLEAN_BASE = CLEAN_BASE = datetime(2026, 9, 19, 11, 5, tzinfo=timezone.utc)
    statuses = ["PREPARING"] * AFFECTED_PREP + ["OUT_FOR_DELIVERY"] * AFFECTED_TRANSIT + ["DELIVERED"] * AFFECTED_DELIVERED
    affected = make_orders(["DISH-PAN-BUTTER", "DISH-PAN-TIKKA", "DISH-MUG-ROLL"], AFFECTED_TOTAL, statuses, 8600)

    # scale GMV to the exact blueprint figure (deterministic)
    raw_gmv = sum(o["total_inr"] for o in affected)
    scale = AFFECTED_GMV / raw_gmv
    for o in affected:
        o["total_inr"] = round(o["total_inr"] * scale, 2)

    # ---- clean control orders (chicken / dal lines stay LIVE) ----
    clean = make_orders(["DISH-CHK-BIRYANI", "DISH-DAL-MAKHANI"], CLEAN_ORDERS, "DELIVERED", 9300)

    all_orders = affected + clean
    # 342 affected orders expose 489 consumers: first 147 orders serve +1 companion
    companions = AFFECTED_CUSTOMERS - AFFECTED_TOTAL
    for idx, o in enumerate(all_orders):
        onode, _ = g.merge_node("Order", {"id": o["id"], "ordered_at": o["ordered_at"], "status": o["status"], "total_inr": o["total_inr"]})
        dnode = g.find("Dish", o["dish"])
        g.merge_rel("CONTAINS_ITEM", onode, dnode, {"quantity": 1, "price_inr": o["total_inr"]})
        # fulfill kitchen = a kitchen that preps this dish
        preppers = [rel.start for rel in dnode.in_rels if rel.type == "PREPARED"]
        kit = g.nodes[preppers[idx % len(preppers)]] if preppers else g.find("Kitchen", "KIT-NOI-62")
        g.merge_rel("FULFILLED_AT", onode, kit, {})
        cust = o["customer"]
        cnode, _ = g.merge_node("Customer", {
            "id": f"CUST-{idx:05d}", "name_masked": _mask(rng),
            "phone_hash": _phone_hash(cust["id"], idx), "sector": cust["sector"],
        })
        g.merge_rel("PLACED_BY", onode, cnode, {"delivery_time": o["ordered_at"]})
        if idx < len(affected) and idx < companions:
            c2, _ = g.merge_node("Customer", {
                "id": f"CUST-C{idx:04d}", "name_masked": _mask(rng),
                "phone_hash": _phone_hash(cust["id"], 9000 + idx), "sector": cust["sector"],
            })
            g.merge_rel("PLACED_BY", onode, c2, {"delivery_time": o["ordered_at"]})

    return {"orders_affected": len(affected), "orders_clean": len(clean)}
