"""
Copilot agent — unified streaming event protocol for LLM mode and fallback mode.

Event stream (SSE), consumed by the Next.js CopilotDrawer:
  {"type":"mode", "mode":"llm"|"fallback", "model":str}
  {"type":"tool_start", "name":str, "args":dict}
  {"type":"tool_done",  "name":str, "summary":str}
  {"type":"delta", "content":str}
  {"type":"done"}
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator, Callable, List

from . import provider, tools
from .fallback import route_fallback

MAX_ITERATIONS = 4

SYSTEM_PROMPT = """You are TracePulse Copilot, the incident-response AI for Delhi NCR cloud kitchens.
You operate on a Neo4j-style contamination knowledge graph (Supplier → Batch → Warehouse → Shipment → Kitchen → Dish → Order → Customer).

RULES:
1. NEVER invent numbers, IDs, or statuses. Every fact must come from a tool result. If you lack data, call the right tool.
2. Prefer tools proactively: batch impact questions → blast_radius; sick-customer/order questions → reverse_trace;
   shutdown/freeze/intercept questions → recommend_containment or execute_containment; temperature/truck/shared-shipment
   questions → cross_contamination; report/audit/FSSAI → fssai_report; general state → network_summary.
3. Answers: terse, operational, markdown. Lead with the number that matters, then the action. Use ₹ INR formatting.
4. When containment is discussed, stress SURGICAL scope: only paneer SKUs lock; biryani/dal/breads stay LIVE.
Current context: Saturday 2026-09-19 ~14:00 IST. Active suspect batch BATCH-PAN-1042 (Malai Paneer, Amrit Dairies Murthal).
Incident id is INC-2026-003. Known order ids look like ORD-8600…ORD-8941 (affected) and ORD-9300+ (clean)."""


async def stream_chat(graph, user_messages: List[dict], audit: Callable[[str, str], dict]) -> AsyncIterator[dict]:
    cfg = provider.get_config()
    if not cfg["enabled"]:
        async for ev in _fallback_stream(graph, user_messages, audit):
            yield ev
        return

    yield {"type": "mode", "mode": "llm", "model": cfg["model"]}
    messages = [{"role": "system", "content": SYSTEM_PROMPT}] + user_messages[-14:]

    for _ in range(MAX_ITERATIONS):
        content_buf = ""
        pending_calls = None
        try:
            async for ev in provider.chat_stream(messages, tools.TOOL_SCHEMAS):
                if ev["type"] == "delta":
                    content_buf += ev["content"]
                    yield {"type": "delta", "content": ev["content"]}
                elif ev["type"] == "tool_calls":
                    pending_calls = ev["calls"]
                    break
        except Exception as e:  # noqa: BLE001 — degrade live, never crash the demo
            audit("COPILOT_LLM_ERROR", str(e))
            yield {"type": "delta", "content": f"\n\n> ⚠ LLM provider error ({type(e).__name__}) — switching to deterministic copilot.\n\n"}
            async for ev in _fallback_stream(graph, user_messages, audit, skip_mode=True):
                yield ev
            return

        if not pending_calls:
            break

        # record assistant tool-call turn, then execute each tool
        messages.append({
            "role": "assistant", "content": content_buf or None,
            "tool_calls": [{"id": c["id"], "type": "function",
                            "function": {"name": c["name"], "arguments": json.dumps(c["args"])}} for c in pending_calls],
        })
        for call in pending_calls:
            yield {"type": "tool_start", "name": call["name"], "args": call["args"]}
            audit("COPILOT_TOOL", f"{call['name']}({json.dumps(call['args'])})")
            result = await asyncio.to_thread(tools.execute_tool, call["name"], call["args"], graph, audit)
            yield {"type": "tool_done", "name": call["name"], "summary": tools.tool_summary(call["name"], result)}
            messages.append({
                "role": "tool", "tool_call_id": call["id"],
                "content": json.dumps(result, default=str)[:12000],
            })

    yield {"type": "done"}


async def _fallback_stream(graph, user_messages, audit, skip_mode=False) -> AsyncIterator[dict]:
    """Deterministic intent-router copilot: same tools, same numbers, zero API keys."""
    if not skip_mode:
        yield {"type": "mode", "mode": "fallback", "model": "deterministic-intent-router"}
    last_user = next((m["content"] for m in reversed(user_messages) if m.get("role") == "user"), "")
    plan = route_fallback(last_user)
    audit("COPILOT_FALLBACK", f"intent={plan['intent']}")

    results = {}
    for name, args in plan["tools"]:
        yield {"type": "tool_start", "name": name, "args": args}
        result = await asyncio.to_thread(tools.execute_tool, name, args, graph, audit)
        key = f"{name}:{args.get('action')}" if name == "execute_containment" else name
        results[key] = result
        yield {"type": "tool_done", "name": name, "summary": tools.tool_summary(name, result)}
        await asyncio.sleep(0.25)

    text = plan["render"](results, graph)
    # stream word-ish chunks for authentic feel
    words = text.split(" ")
    chunk = ""
    for i, w in enumerate(words):
        chunk += (" " if chunk else "") + w
        if i % 4 == 3 or i == len(words) - 1:
            yield {"type": "delta", "content": chunk + " "}
            chunk = ""
            await asyncio.sleep(0.03)
    yield {"type": "done"}
