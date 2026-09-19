"""
TracePulse NCR — Reference Cypher
=================================
These are the EXACT parameterized queries used against Neo4j AuraDB in
production mode. The embedded graph core in graphcore.py executes the
identical traversal semantics so the demo runs with zero external deps.

SECURITY: every dynamic value is a $parameter — zero string interpolation.
"""

BLAST_RADIUS = """
// Downstream blast radius — deterministic counts (<200 ms)
MATCH (b:Batch {id: $batch_id})
OPTIONAL MATCH (b)-[:SHIPPED_VIA]->(sh:Shipment)-[:DELIVERED_TO]->(k:Kitchen)
OPTIONAL MATCH (b)<-[:USES_BATCH]-(d:Dish)
OPTIONAL MATCH (o:Order)-[:CONTAINS_ITEM]->(d)
OPTIONAL MATCH (o)-[:PLACED_BY]->(c:Customer)
RETURN b.id AS batch_id,
       count(DISTINCT k) AS affected_kitchens,
       count(DISTINCT d) AS affected_dishes,
       count(DISTINCT o) AS affected_orders,
       count(DISTINCT c) AS exposed_customers,
       sum(DISTINCT o.total_inr) AS gmv_at_risk_inr,
       collect(DISTINCT k.cluster) AS ncr_clusters;
"""

REVERSE_TRACE = """
// Upstream root-cause: from a customer order back to the dairy farm
MATCH (o:Order {id: $order_id})-[:CONTAINS_ITEM]->(d:Dish)-[:USES_BATCH]->(b:Batch)
MATCH (s:Supplier)-[:SUPPLIED]->(b)
OPTIONAL MATCH (b)-[:STORED_AT]->(w:Warehouse)
OPTIONAL MATCH (b)-[:SHIPPED_VIA]->(sh:Shipment)-[:DELIVERED_TO]->(k:Kitchen)
WHERE (o)-[:FULFILLED_AT]->(k)
RETURN o.id AS order_id, d.name AS dish, b.id AS batch_id, b.status AS batch_status,
       s.name AS supplier, s.location AS origin, w.name AS warehouse,
       sh.id AS shipment, sh.avg_temp_c AS transit_temp_c, k.name AS kitchen;
"""

CROSS_CONTAMINATION = """
// Batches that shared a temperature-breached shipment (> 8 deg C)
MATCH (b1:Batch {id: $batch_id})-[:SHIPPED_VIA]->(sh:Shipment)
MATCH (b2:Batch)-[:SHIPPED_VIA]->(sh)
WHERE b1 <> b2 AND sh.avg_temp_c > 8.0
RETURN b2.id AS batch_id, b2.ingredient_name AS ingredient,
       sh.id AS shared_shipment, sh.vehicle_plate AS vehicle, sh.avg_temp_c AS temp_c;
"""

CONTAINMENT_INTERCEPT = """
// Flip OUT_FOR_DELIVERY orders on affected dishes to INTERCEPTED
MATCH (inc:Incident {id: $incident_id})-[:FLAGGED_AS]->(b:Batch)<-[:USES_BATCH]-(d:Dish)
MATCH (o:Order)-[:CONTAINS_ITEM]->(d)
WHERE o.status = 'OUT_FOR_DELIVERY'
SET o.status = 'INTERCEPTED'
RETURN count(o) AS orders_intercepted;
"""

AUDIT_PATH = """
// FSSAI chain-of-custody: shortest physical path farm -> consumer
MATCH (s:Supplier)-[:SUPPLIED]->(b:Batch {id: $batch_id})
MATCH (c:Customer {id: $customer_id})
MATCH path = shortestPath((s)-[*..8]-(c))
RETURN [n IN nodes(path) | labels(n)[0] + ':' + coalesce(n.name, n.id)] AS audit_trail,
       length(path) AS total_hops;
"""
