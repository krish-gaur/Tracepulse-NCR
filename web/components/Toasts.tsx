"use client";
import { useEffect, useState } from "react";
import type { ToastKind } from "@/lib/toast";

interface ToastItem { id: number; html: string; kind: ToastKind; bye?: boolean }
let seq = 1;

export default function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const { html, kind, ttl } = (e as CustomEvent).detail as { html: string; kind: ToastKind; ttl: number };
      const id = seq++;
      setItems((prev) => [...prev.slice(-3), { id, html, kind }]);
      setTimeout(() => setItems((prev) => prev.map((t) => (t.id === id ? { ...t, bye: true } : t))), ttl);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), ttl + 500);
    };
    window.addEventListener("tp:toast", onToast);
    return () => window.removeEventListener("tp:toast", onToast);
  }, []);

  return (
    <div id="toast-stack">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind} ${t.bye ? "bye" : ""}`} dangerouslySetInnerHTML={{ __html: t.html }} />
      ))}
    </div>
  );
}
