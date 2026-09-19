"""
LLM provider abstraction — OpenAI-compatible chat completions with tool calling.

Works with any OpenAI-compatible endpoint:
  * OpenAI      → AI_BASE_URL=https://api.openai.com/v1   AI_MODEL=gpt-4o-mini
  * Groq (fast) → AI_BASE_URL=https://api.groq.com/openai/v1  AI_MODEL=llama-3.1-70b-versatile
  * OpenRouter  → AI_BASE_URL=https://openrouter.ai/api/v1    AI_MODEL=…

No key configured → the copilot runs in deterministic FALLBACK mode (demo never breaks).
"""
from __future__ import annotations

import json
import os
from typing import AsyncIterator, Dict, List, Optional

import httpx

DEFAULT_BASE = "https://api.openai.com/v1"


def get_config() -> Dict[str, str]:
    api_key = os.getenv("AI_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
    return {
        "api_key": api_key,
        "base_url": os.getenv("AI_BASE_URL", DEFAULT_BASE).rstrip("/"),
        "model": os.getenv("AI_MODEL", "gpt-4o-mini"),
        "enabled": bool(api_key),
    }


async def chat_stream(messages: List[dict], tools: Optional[List[dict]] = None) -> AsyncIterator[dict]:
    """
    Streams normalized events:
      {"type":"delta","content":str}
      {"type":"tool_calls","calls":[{id,name,args}]}   (terminal)
      {"type":"finish"}                                 (terminal, no tool calls)
    """
    cfg = get_config()
    payload: dict = {"model": cfg["model"], "messages": messages, "stream": True, "temperature": 0.2}
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}

    acc: Dict[int, dict] = {}

    async with httpx.AsyncClient(timeout=90) as client:
        async with client.stream("POST", f"{cfg['base_url']}/chat/completions",
                                 json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                delta = choice.get("delta") or {}
                if delta.get("content"):
                    yield {"type": "delta", "content": delta["content"]}
                for tc in delta.get("tool_calls") or []:
                    idx = tc.get("index", 0)
                    slot = acc.setdefault(idx, {"id": "", "name": "", "args": ""})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        slot["name"] += fn["name"]
                    if fn.get("arguments"):
                        slot["args"] += fn["arguments"]
                if choice.get("finish_reason") == "tool_calls":
                    yield {"type": "tool_calls", "calls": _finalize(acc)}
                    return

    if acc:
        yield {"type": "tool_calls", "calls": _finalize(acc)}
    else:
        yield {"type": "finish"}


async def chat_once(messages: List[dict]) -> str:
    """Non-streaming completion (used by the AI report generator)."""
    cfg = get_config()
    payload = {"model": cfg["model"], "messages": messages, "temperature": 0.3}
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(f"{cfg['base_url']}/chat/completions", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"] or ""


def _finalize(acc: Dict[int, dict]) -> List[dict]:
    calls = []
    for idx in sorted(acc):
        slot = acc[idx]
        try:
            args = json.loads(slot["args"] or "{}")
        except json.JSONDecodeError:
            args = {}
        calls.append({"id": slot["id"] or f"call_{idx}", "name": slot["name"], "args": args})
    return calls
