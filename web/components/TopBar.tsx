"use client";
import { useEffect, useState } from "react";
import type { Health } from "@/lib/types";

export default function TopBar({ netAlert, health }: { netAlert: boolean; health: Health | null }) {
  const [now, setNow] = useState("");
  const [date, setDate] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.toLocaleTimeString("en-IN", { hour12: false }));
      setDate(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() + " · DELHI NCR · IST");
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const ai = health?.components?.ai_copilot;

  return (
    <header id="topbar">
      <div className="brand">
        <div className="logo">
          <svg viewBox="0 0 40 40" width="34" height="34">
            <defs>
              <radialGradient id="lg" cx="50%" cy="50%">
                <stop offset="0%" stopColor="#67e8f9" />
                <stop offset="100%" stopColor="#0891b2" />
              </radialGradient>
            </defs>
            <circle cx="20" cy="20" r="17" fill="none" stroke="url(#lg)" strokeWidth="2" opacity=".9" />
            <path d="M6 20 L13 20 L16 12 L20 27 L23 17 L25 20 L34 20" fill="none" stroke="#22d3ee" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="20" cy="20" r="2.6" fill="#ef4444">
              <animate attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>
        <div className="brand-text">
          <div className="brand-name">TracePulse <span>NCR</span></div>
          <div className="brand-sub">Graph-Native Quarantine · AI Incident Copilot</div>
        </div>
      </div>

      <div className="top-status">
        <div className={`status-chip ${netAlert ? "alert" : ""}`}>
          <span className="pulse-dot"></span>
          <span>{netAlert ? "INCIDENT ACTIVE · INC-2026-003" : "NETWORK NOMINAL"}</span>
        </div>
        <div className="clock-box">
          <div className="clock-time">{now || "--:--:--"}</div>
          <div className="clock-date">{date || "DELHI NCR · IST"}</div>
        </div>
        <div className="health-mini" title="AI copilot status">
          <span className="hm-label">AI</span>
          <span className={`hm-val ${ai?.mode === "fallback" ? "warn" : ""}`}>
            {ai ? (ai.mode === "llm" ? "● LLM" : "● RULES") : "—"}
          </span>
        </div>
        <div className="health-mini" title="Graph engine status">
          <span className="hm-label">GRAPH</span>
          <span className="hm-val">{health ? "● LIVE" : "—"}</span>
        </div>
      </div>
    </header>
  );
}
