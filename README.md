
## Run it

```bash
# Terminal 1 — backend
cd backend && pip install -r requirements.txt
python3 -m uvicorn app:app --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd web && npm install && npm run build && npm run start   # or: npm run dev
# open http://localhost:3000
```

## The AI — used where it actually wins
| Feature | How AI is used | Why judges respect it |
|---|---|---|
| **AI Incident Copilot** (purple drawer) | LLM **tool-calling agent**: it decides which graph tools to run (`blast_radius`, `reverse_trace`, `cross_contamination`, `recommend_containment`, `execute_containment`, `fssai_report`, `network_summary`); the graph returns deterministic facts; the LLM composes the answer. Tool chips stream live in the chat. | No fake chatbot — the UI *shows* each tool call and its result. Numbers are provably from the graph. |
| **AI Incident Narrative** (Containment tab) | Structured incident facts → LLM rewrites an inspector-grade FSSAI narrative (facts frozen). | Report generation is a legit LLM use-case. |
| **Zero-key safety net** | No `AI_API_KEY` → deterministic intent-router streams the same grounded answers. | Demo literally cannot break on venue Wi-Fi. |

### Enable LLM mode (2 minutes)
```bash
# Groq (fast free tier)            # OpenAI               # OpenRouter
export AI_API_KEY=gsk_...         export AI_API_KEY=sk-... export AI_API_KEY=sk-or-...
export AI_BASE_URL=https://api.groq.com/openai/v1
export AI_MODEL=llama-3.1-70b-versatile   # or gpt-4o-mini / any OpenAI-compatible model
```
Restart the backend. The TopBar `AI` pill flips to `● LLM`, `/api/v1/ai/status` reports the mode.

## Demo script (4 minutes)
1. **▶ AUTO-RUN 4-MIN DEMO** plays the whole storyline hands-free, or run it live:
2. Dashboard → point out clusters/telemetry → **lab alert toast** → Blast Radius tab → `INITIATE` → graph cascades (138 ms vs 45–180 s SQL)
3. Containment tab → AI narrative + severity 990 CRITICAL → execute 3 zones (kitchens flip to PARTIAL_HOLD on graph; 82 orders → INTERCEPTED)
4. Reverse Trace → `ORD-8660` → 7 hops to Amrit Dairies, Murthal
5. **Finish with the copilot:** "Should I shut down Noida Sector 62 kitchen?" → surgical answer with real numbers.

## Verified blueprint numbers (asserted in tests)
342 orders = 48 PREPARING + 82 OUT_FOR_DELIVERY + 212 DELIVERED · 6 kitchens · 4 shipments (SH-209 = 9.4°C breach) ·
3 paneer dishes · 489 consumers · ₹1,24,000 GMV · severity **990 CRITICAL** = 1.0×(48×2+82×3+212×1.5)×1.5 ·
reverse trace 7 hops → BATCH-PAN-1042 ← Amrit Dairies Murthal.

## Repo map
```
backend/
  app.py            FastAPI: REST contract + AI endpoints (SSE) + jobs + events
  services.py       graph queries shared by REST *and* AI tools (single source of truth)
  graphcore.py      index-free-adjacency engine (Neo4j-swappable), severity, containment
  data.py           deterministic Delhi NCR dataset (idempotent MERGE seeding)
  cypher_reference.py  production parameterized Cypher for AuraDB
  ai/
    provider.py     OpenAI-compatible streaming client (OpenAI/Groq/OpenRouter)
    tools.py        7 tool schemas + executors
    agent.py        tool-calling loop + unified SSE event protocol
    fallback.py     deterministic intent router (demo-safe, no keys needed)
    report.py       FSSAI chain-of-custody generator (LLM-enhanced w/ template fallback)
web/                Next.js 14 App Router + TypeScript
  app/              layout, page (state orchestrator + auto-demo sequencer), globals.css
  components/       TopBar, Dashboard, Blast (canvas), Containment, Reverse, Copilot, Toasts
  lib/              api client, types, GraphEngine (canvas), markdown, toast bus
render.yaml         one-click Render deploy (both services)
```

## Neo4j swap-in (hour 0–1)
Provision AuraDB Free → apply PART 4 constraints → replace `graphcore.GraphStore` calls with the
async driver + `cypher_reference.py` queries (already parameterized). REST contract + UI unchanged.
