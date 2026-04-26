# Peec Content Studio

> **Grammarly for GEO** — a writing companion that tells human authors *which phrases to use* so their text gets cited by ChatGPT, Perplexity, Gemini and other AI models. Generative Engine Optimization at the phrase level.

Built at the **Big Berlin Hack** (Tech Europe, April 2026) for the **Peec AI** track.

---

## The thesis

AI-generated writing is slop. Everybody knows it — including, we suspect, the Peec AI team judging this track.

So we did not build another content generator. We built the opposite: a tool that takes the words a *human* writer has already typed and tells them, line by line, how to phrase things so AI engines pick them up. The author stays in the driver's seat. The model only suggests what to highlight, what entity to name, where a citation would lock the claim in.

Think Grammarly's right-rail suggestions — but instead of "passive voice," each card says *"Mention Stripe in this sentence — they hold 34% share of voice on this query in ChatGPT, and co-mention boosts your citation probability by ~18%."*

---

## What it does

Two surfaces, one workflow.

### 1. A live Peec dashboard clone

- Sidebar + header reskin of the Peec product, light mode, pixel-matched to the design refs.
- An **Actions** page with Owned / Earned tabs powered by **live Peec MCP data** for the selected project.
- Every action card has a **Draft** button that opens it in the editor.

Peec Dashboard

### 2. The Content Studio editor

- Tiptap rich-text editor (title + body, Notion/Medium feel).
- Right-rail **GEO suggestions**, debounced 800ms after typing, each with an expandable **"Technical Why?"** drawer that explains the data behind the suggestion (share of voice, competitor dominance, citation lift).
- Inline document highlights mapped to Tiptap doc positions, with one-click **Apply edit** when a `suggestedEdit` is present.
- A prominent **Run GEO Simulator** button in the top right.

Content Studio Editor

### The GEO Simulator

A 4-step pipeline that runs in 5–8 seconds and tells the writer how their draft would actually perform across AI engines:

GEO Simulator

1. **Extract entities** from the draft → Pioneer (GLiNER fine-tune)
2. **Generate 15 candidate prompts** users might ask → Gemini Flash
3. **Pull the brand's GEO baseline** for those prompts → Peec MCP
4. **Score citation likelihood** for the top 5 → Gemini Pro

The result is a horizontal bar chart per prompt with the user's brand vs. its top 3 competitors, plus a one-line reason why.

---

## Partner technologies used

This project uses **3** Big Berlin Hack partner technologies (the minimum required for submission):


| Partner                                  | Where it's used                                                                                                                          | File             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **Google DeepMind — Gemini Pro & Flash** | Pro generates the inline GEO suggestions and scores prompts in the simulator. Flash bulk-generates candidate prompts.                    | `lib/gemini.ts`  |
| **Tavily**                               | Live SERP + competitor content lookup for the topic of the article being written. Cached per-article, refreshable on demand.             | `lib/tavily.ts`  |
| **Fastino — Pioneer (GLiNER fine-tune)** | Fast, cheap entity extraction (brands, competitors, products, citable claims) before every Gemini call so the LLM gets structured input. | `lib/pioneer.ts` |


The **Peec AI MCP** powers the dashboard data and the GEO baseline lookup in the simulator (`vendor/peec_full_fetch.py` + `lib/peec.ts`).

---

## Data pipeline

### Insights

Feeds data in the insights panel which creates actionable suggestions for your drafted text. 

Insights Panel

### GEO Simulation

Feeds data in the GEO simulator which is a reverse-engineered AI-Crawler.

GEO Generator Pipeline

---

## Tech stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** primitives
- **Tiptap 3** with StarterKit + a custom decoration extension for inline suggestion highlights
- **Zustand** for editor state, **TanStack React Query** for API calls
- **Recharts** for the simulator visualization
- **Zod** for env-var validation
- **Python 3** (`httpx`) for the Peec MCP integration: OAuth + transport in `data/peec_mcp_auth.py`, project listing and 13-section snapshot fetcher wrappers in `vendor/`

---

## Setup

### Prerequisites

- Node 20+
- Python 3.10+ — must be reachable as `python3` (macOS/Linux) or `python` / `py` (Windows). The Next.js app auto-detects whichever exists; set `PYTHON_BIN` in `.env.local` if your interpreter lives elsewhere.
- A modern browser (the Peec OAuth flow opens a browser tab once)

### 1. Clone and install

```bash
git clone <REPO_URL>
cd Peec-Content-Studio
npm install
```

Then install the two Python dependencies (`httpx`, `python-dotenv`). Pick the line that matches your platform:

```bash
# macOS / Linux
python3 -m pip install -r vendor/requirements.txt

# Windows (PowerShell or cmd)
py -3 -m pip install -r vendor/requirements.txt
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Required runtime keys:

```
GEMINI_API_KEY=          # Google AI Studio key
TAVILY_API_KEY=          # tavily.com
PIONEER_API_KEY=         # pioneer.ai (Fastino)
PIONEER_MODEL_ID=        # the fine-tuned GLiNER model id
PEEC_MCP_TOKEN=          # just your Peec api key
```

The app uses Zod (`lib/env.ts`) to validate these at startup. **Missing keys fail loudly** — there is no silent fallback to mock data.

The `.env.example` template also contains three optional fields you can leave blank for the standard path:

- `PEEC_MCP_URL` / `PEEC_MCP_TOKEN` — legacy direct-token MCP transport. The current Peec data path uses OAuth (DCR + PKCE), see step 3.
- `USE_FALLBACK_SNAPSHOT` — set to `true` to use the static demo snapshot when no live JSON exists (see [Offline demo mode](#offline-demo-mode)).
- `PYTHON_BIN` — explicit Python interpreter override, e.g. `PYTHON_BIN="py -3"`. Only set when auto-detection misses your install.

### 3. Authenticate with Peec (one time per machine)

```bash
# macOS / Linux
python3 vendor/list_projects.py

# Windows
py -3 vendor/list_projects.py
```

A browser opens, you log into Peec, and tokens get cached to `data/.peec_tokens.json` (gitignored). They auto-refresh on subsequent runs.

You can also skip this step and let `/setup` (step 4) run the same script under the hood — but then the OAuth browser tab opens off the dev server's stdout, which is harder to debug.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/setup` to pick a Peec project. Selecting one:

1. Writes the project id to a cookie (`peec_project_id`).
2. Spawns `vendor/peec_full_fetch.py --project-id <id>` and streams the 13 fetch phases back over SSE.
3. Drops the snapshot at `data/peec-live-<id>.json`.
4. Forwards you to the dashboard.

Switching projects later: use the sidebar's project switcher (it clears the cookie and sends you back to `/setup`). The on-disk snapshot stays cached, so switching back is instant.

### Offline demo mode

If you can't run the Python fetcher (no network, expired tokens), set:

```
USE_FALLBACK_SNAPSHOT=true
```

`lib/peec.ts` will fall back to the static fixture at `data/peec-snapshot.ts` whenever the live JSON for the selected project is missing.

---

## Project structure

```
app/
  (dashboard)/
    page.tsx               Dashboard home
    actions/page.tsx       Owned / Earned tabs with Draft buttons
  studio/[articleId]/
    page.tsx               Editor surface
  setup/                   Project picker + live-fetch SSE UI
  api/
    suggest/route.ts       POST → returns inline GEO suggestions
    simulate/route.ts      POST → SSE stream of 4-step simulator
    peec/projects          GET → list_projects.py wrapper
    peec/fetch             POST → peec_full_fetch.py SSE stream
    peec/current           DELETE → clears project cookie
components/
  dashboard/               Sidebar, header, action cards, refresh button
  studio/                  Editor, suggestions sidebar, suggestion card
  simulator/               Modal, progress, results chart
  ui/                      shadcn primitives (Button, Dialog, Tabs, …)
lib/
  peec.ts                  Sync accessors + setCurrentProject + cache
  peec-server.ts           ensureProjectSelected() — cookie → snapshot → render
  peec-project-cookie.ts   Cookie name + strict project-id validator
  python-bin.ts            Cross-platform python3 / python / py -3 resolver
  gemini.ts                Gemini Pro + Flash wrappers, suggestion JSON contract
  tavily.ts                Live SERP / competitor lookup
  pioneer.ts               GLiNER entity extraction
  env.ts                   Zod-validated env loader
vendor/
  list_projects.py         Project listing wrapper (imports from data/)
  peec_full_fetch.py       13-section snapshot fetcher (SSE-streamed)
  requirements.txt         httpx + python-dotenv
data/
  peec_mcp_auth.py         OAuth (DCR + PKCE) + Streamable-HTTP MCP transport
  peec_client.py           Legacy slim fetcher (Python-only flows)
  peec-snapshot.ts         Static fallback (USE_FALLBACK_SNAPSHOT=true)
  peec-live-<id>.json      Per-project live snapshot (gitignored)
  .peec_tokens.json        Cached OAuth tokens (gitignored, auto-refreshed)
scripts/
  test-gemini.ts
  test-pioneer.ts
  test-tavily.ts
```

---

## Suggestion engine — output contract

Every Gemini suggestion call returns JSON matching this exact shape, consumed by the right rail and the inline decoration extension:

```ts
type Suggestion = {
  id: string;
  type: 'add_entity' | 'strengthen_claim' | 'add_citation' | 'reframe' | 'competitor_gap';
  severity: 'high' | 'medium' | 'low';
  range: { from: number; to: number };  // Tiptap doc positions
  layman: string;        // Marketer-friendly: "Mention Stripe here…"
  technicalWhy: string;  // The data: share of voice, citation lift, etc.
  suggestedEdit?: string;
};
```

`layman` is what shows on the card. `technicalWhy` lives behind the **Technical Why?** drawer. System prompts are tuned for marketers, not engineers — layman text first, data second.

---

## Demo

**2-minute video walkthrough:** [Watch on Loom](https://www.loom.com/share/b1970bde94d745c9b287caa47170bb71)

Demo flow:

1. Pick a Peec project → live data loads.
2. Open an action from the **Earned** tab → opens in the editor with article context pre-filled.
3. Type — watch the right rail populate with phrase-level GEO suggestions in <1s.
4. Expand a card's **Technical Why?** → see the Peec/Tavily data behind it.
5. Click **Apply edit** on a few suggestions.
6. Hit **Run GEO Simulator** → watch the 4-step pipeline → see top-5 prompt scoring vs. competitors.

---

## Hackathon submission


| Requirement                      | Status                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Public GitHub repository         | ✅                                                                            |
| Comprehensive README (this file) | ✅                                                                            |
| 2-minute video demo              | [Watch on Loom](https://www.loom.com/share/b1970bde94d745c9b287caa47170bb71) |
| ≥3 partner technologies          | ✅ Gemini (DeepMind) + Tavily + Pioneer (Fastino)                             |
| Track                            | Peec AI — *0 → 1 AI Marketer*                                                |
| Built newly at the hackathon     | ✅                                                                            |
| Team size ≤ 5                    | ✅                                                                            |


---

## Team

Max, Venkat & Lucas

Built at the **Big Berlin Hack** by Tech Europe, April 25–26 2026, at The Delta Campus & CODE University, Berlin.

---