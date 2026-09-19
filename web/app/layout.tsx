import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TracePulse NCR — AI Contamination Quarantine Engine",
  description:
    "Sub-second food contamination blast radius + graph-grounded AI copilot for Delhi NCR cloud kitchens. Neo4j-style index-free adjacency, FastAPI, Next.js.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='17' fill='%23071018' stroke='%2322d3ee' stroke-width='2'/%3E%3Cpath d='M8 20 L14 20 L17 13 L21 27 L24 18 L26 20 L32 20' fill='none' stroke='%2322d3ee' stroke-width='2.4' stroke-linecap='round'/%3E%3Ccircle cx='20' cy='20' r='2.4' fill='%23ef4444'/%3E%3C/svg%3E"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
