"use client";
import { useEffect, useRef, useState } from "react";
import type { AiEvent, ChatMessage } from "@/lib/types";
import { md } from "@/lib/markdown";

const SUGGESTIONS = [
  "What's the blast radius of batch B-1042?",
  "A customer is sick from order ORD-8660 — trace it",
  "Which other batches shared the breached truck?",
  "Should I shut down Noida Sector 62 kitchen?",
  "Freeze prep, halt riders and notify consumers now",
  "Generate the FSSAI report",
];

const TOOL_ICON: Record<string, string> = {
  blast_radius: "◎", reverse_trace: "⇄", network_summary: "▦",
  cross_contamination: "❄", recommend_containment: "⛨", execute_containment: "⚡", fssai_report: "🗎",
};

export default function Copilot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiInfo, setAiInfo] = useState<{ mode: string; model: string } | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/v1/ai/status").then((r) => r.json()).then(setAiInfo).catch(() => {});
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput("");
    setBusy(true);
    const history: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages([...history, { role: "assistant", content: "", tools: [], streaming: true }]);

    try {
      const res = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) throw new Error(`chat failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      const patch = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = fn(next[next.length - 1]);
          return next;
        });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            let ev: AiEvent;
            try { ev = JSON.parse(line.slice(5).trim()) as AiEvent; } catch { continue; }
            if (ev.type === "tool_start") {
              patch((m) => ({ ...m, tools: [...(m.tools || []), { name: ev.name!, args: ev.args, status: "running" }] }));
            } else if (ev.type === "tool_done") {
              patch((m) => {
                const tools = [...(m.tools || [])];
                const i = [...tools].reverse().findIndex((t) => t.name === ev.name && t.status === "running");
                if (i >= 0) tools[tools.length - 1 - i] = { ...tools[tools.length - 1 - i], status: "done", summary: ev.summary };
                return { ...m, tools };
              });
            } else if (ev.type === "delta") {
              patch((m) => ({ ...m, content: m.content + (ev.content || "") }));
            } else if (ev.type === "error") {
              patch((m) => ({ ...m, content: m.content + `\n\n⚠ ${ev.message}` }));
            }
          }
        }
      }
      patch((m) => ({ ...m, streaming: false }));
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `⚠ Copilot unavailable — ${(e as Error).message}. Is the FastAPI backend running?`, streaming: false };
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`copilot-drawer ${open ? "open" : ""}`}>
      <div className="cd-head">
        <div className="cd-orb">◈</div>
        <div>
          <div className="cd-title">TracePulse Copilot</div>
          <div className="cd-sub">GRAPH-GROUNDED · TOOL-CALLING · ZERO HALLUCINATED NUMBERS</div>
        </div>
        <span className="cd-model">
          {aiInfo ? (aiInfo.mode === "llm" ? `LLM · ${aiInfo.model}` : "DETERMINISTIC MODE") : "…"}
        </span>
        <button className="cd-close" onClick={onClose}>✕</button>
      </div>

      <div className="cd-feed" ref={feedRef}>
        {messages.length === 0 && (
          <div style={{ color: "var(--ink-faint)", fontSize: 12.5, lineHeight: 1.7, padding: "8px 4px" }}>
            I sit on top of the contamination knowledge graph and answer with <b style={{ color: "var(--ink)" }}>deterministic tool calls</b> — blast radius,
            reverse trace, cold-chain correlation, containment, FSSAI reports.
            <br /><br />
            Try a suggestion below, or ask in your own words.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`cmsg ${m.role}`}>
            <div className="bubble">
              {(m.tools || []).map((t, j) => (
                <span key={j} className={`tool-chip ${t.status}`}>
                  <span className="tc-ico">{t.status === "running" ? <span className="spin">⟳</span> : TOOL_ICON[t.name] || "⚙"}</span>
                  {t.name}
                  {t.args && Object.keys(t.args).length > 0 && (
                    <span className="tc-sum">({Object.values(t.args).map(String).join(", ")})</span>
                  )}
                  {t.status === "done" && t.summary && <span className="tc-sum">→ {t.summary}</span>}
                </span>
              ))}
              {m.content && <div dangerouslySetInnerHTML={{ __html: md(m.content) }} />}
              {m.streaming && <span className="caret"></span>}
            </div>
          </div>
        ))}
      </div>

      <div className="cd-suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggest-chip" onClick={() => send(s)} disabled={busy}>{s}</button>
        ))}
      </div>

      <div className="cd-input-row">
        <textarea
          className="cd-input"
          rows={1}
          placeholder="Ask the copilot… (Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
          }}
        />
        <button className="cd-send" onClick={() => send(input)} disabled={busy || !input.trim()}>➤</button>
      </div>
    </div>
  );
}
