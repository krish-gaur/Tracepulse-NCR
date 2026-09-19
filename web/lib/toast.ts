/* Tiny event-bus toast system (no context plumbing needed) */

export type ToastKind = "ok" | "err" | "info";

export function toast(html: string, kind: ToastKind = "info", ttl = 5200) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tp:toast", { detail: { html, kind, ttl } }));
}
