# Claude Code Prompt: Peec Content Studio (Hackathon Prototype)

## Your Role
You are building a hackathon prototype called **Peec Content Studio** — a "Grammarly for GEO (Generative Engine Optimization)" feature that will be demoed as a "could-be" feature inside Peec's existing dashboard. The user is a beginner who will rely on you to write all code. Be surgical, no hallucinations, no placeholder code that "the user will fill in later."

## Critical Rules (read these first, follow them always)

1. **No mock data unless explicitly told.** Every API call must be real. If a key is missing, fail loudly with a clear error message — don't fall back to fake data.
2. **Pixel-perfect to Peec's design language.** The user will provide screenshots in `./design-refs/`. Match colors, typography, spacing, border radii, shadows, and icon style exactly. Light mode only.
3. **Make surgical edits.** When modifying files, change only what's necessary. Never rewrite a whole file when a 3-line edit will do.
4. **Ask before assuming.** If a requirement is ambiguous, ask the user one specific question rather than guessing.
5. **Verify your work.** After each meaningful change, run the dev server and confirm it compiles. Catch errors before reporting "done."
6. **Keep the file tree shallow.** Don't over-engineer folders. This is a 48-hour prototype, not a production app.

## What You're Building

A Next.js app with two main surfaces:

### Surface 1: Peec Dashboard Clone (light reskin)
- Recreate Peec's existing dashboard using their design language
- Add a new "Content Studio" item to the sidebar nav
- On the Actions page (Owned/Earned tabs), add a **"Draft"** button next to each action item — this is the entry point to Surface 2

### Surface 2: The Content Studio Editor
A Grammarly-style writing interface with:
- **Center:** Tiptap-based rich text editor (title + body, like Notion/Medium)
- **Right sidebar:** Live GEO suggestions, each with a "Technical Why?" expandable dropdown
- **Top-right:** A prominent **"Run GEO Simulator"** button
- **Header:** Article title, save indicator, back-to-dashboard link

## Tech Stack (locked — do not deviate)

- **Framework:** Next.js 15 (App Router) + TypeScript
- **Styling:** Tailwind CSS v4 + shadcn/ui (only for primitives: Button, Dialog, Tabs, Tooltip, Dropdown)
- **Editor:** Tiptap with StarterKit + custom decoration extension for inline suggestion highlights
- **State:** Zustand for editor state, React Query for API calls
- **Icons:** Lucide React (matches Peec's icon style based on screenshots)
- **Charts:** Recharts (for GEO Simulator visualization)
- **Deploy target:** Vercel

## Integrations (all live, all real)

### 1. Peec MCP
- Used to fetch the user's current GEO standing: brand mentions in LLMs, competitor mentions, share of voice per topic, owned vs earned breakdown
- Connect via MCP client in `lib/peec.ts`
- Cache responses for 5 minutes per topic key

### 2. Google Gemini (2.5 Pro + Flash)
- **Pro:** Generates the actual suggestions on the article (the "Grammarly-style" feedback)
- **Flash:** Generates candidate prompts in the GEO Simulator (cheaper, faster, used in bulk)
- Stream responses where possible
- System prompts must be tuned for *marketers and content writers*, not engineers. Layman language in the main suggestion. Technical detail goes inside "Technical Why?"

### 3. Tavily
- Used to fetch live SERP + competitor content for the topic being written about
- Called once per article (cached) and refreshed when the user explicitly hits "Refresh context"

### 4. Pioneer (GLiNER fine-tuned)
- Used for fast, cheap entity extraction from the draft: brands, competitors, products, citable claims
- Runs *before* Gemini calls so Gemini gets structured input
- Also runs as the first step of the GEO Simulator

## Environment Variables (all required, fail loudly if missing)

```
PEEC_MCP_URL=
PEEC_MCP_TOKEN=
GEMINI_API_KEY=
TAVILY_API_KEY=
PIONEER_API_KEY=
PIONEER_MODEL_ID=
```

Create `.env.example` with these keys and empty values. Never commit `.env.local`.

## Suggestion Engine — Output Contract

Every Gemini suggestion call must return JSON matching this exact shape:

```ts
type Suggestion = {
  id: string;
  type: 'add_entity' | 'strengthen_claim' | 'add_citation' | 'reframe' | 'competitor_gap';
  severity: 'high' | 'medium' | 'low';
  range: { from: number; to: number }; // Tiptap doc positions
  layman: string;        // Marketer-friendly: "Mention Stripe here — they dominate this topic in ChatGPT."
  technicalWhy: string;  // Detailed: "Stripe holds 34% share of voice for 'payment infrastructure' queries in ChatGPT (Peec data, last 7d). Co-mention boosts your citation probability ~18%."
  suggestedEdit?: string; // Optional one-click apply
};
```

## GEO Simulator — Behavior Spec

When user clicks the button, in this order:

1. Show a modal with a 4-step progress indicator:
   - "Extracting entities from your draft..." (GLiNER)
   - "Generating candidate prompts..." (Gemini Flash, generate 15)
   - "Querying your GEO baseline..." (Peec MCP)
   - "Scoring citation likelihood..." (Gemini Pro, scores all 15, returns top 5)

2. Each step's status updates in real-time as it completes.

3. Final view: Horizontal bar chart showing top 5 prompts. For each prompt:
   - The prompt text
   - Citation likelihood % (your brand)
   - Top 3 competitors' likelihood % (from Peec data)
   - One-line reasoning ("Strong because: you have 3 cited claims; Weak because: competitor X dominates this query")

4. Total time budget: 5-8 seconds. If any step exceeds 12s, abort with a clear error.

## Build Order (follow strictly — do not skip ahead)

### Phase 1: Foundation (1-2 hours)
1. Initialize Next.js 15 project with TypeScript, Tailwind, App Router
2. Install dependencies, set up shadcn/ui
3. Create `.env.example` and `lib/env.ts` (validates all keys at startup with zod)
4. Create folder structure:
   ```
   app/
     (dashboard)/
       page.tsx               # Dashboard home
       actions/page.tsx       # Owned/Earned tabs with Draft buttons
     studio/[articleId]/
       page.tsx               # Editor surface
     api/
       suggest/route.ts       # POST: returns suggestions
       simulate/route.ts      # POST: GEO simulator (streams progress)
   components/
     dashboard/               # Sidebar, header, action cards
     studio/                  # Editor, sidebar, suggestion card
     simulator/               # Modal, progress, results chart
     ui/                      # shadcn primitives
   lib/
     peec.ts                  # Peec MCP client + cache
     gemini.ts                # Gemini Pro + Flash wrappers
     tavily.ts                # Tavily client
     pioneer.ts               # GLiNER entity extraction
     env.ts
   ```

### Phase 2: Dashboard Clone (2-3 hours)
5. Review screenshots already present in ./design-refs/. If any critical view is missing (e.g., empty states, hover states), ask the user one specific question before proceeding.
6. Build the sidebar, header, and Actions page (Owned + Earned tabs) matching screenshots pixel-for-pixel
7. Add Draft buttons to action cards — clicking navigates to `/studio/[articleId]`

### Phase 3: Editor Surface (3-4 hours)
8. Build the Tiptap editor with title + body
9. Build the right sidebar shell (suggestion cards with expand/collapse)
10. Wire up the debounced suggestion API call (800ms)
11. Implement custom Tiptap decoration to highlight suggestion ranges in the doc
12. Wire "Apply edit" buttons (when `suggestedEdit` is present)

### Phase 4: Live Integrations (2-3 hours)
13. Implement `lib/peec.ts` (MCP client + cache)
14. Implement `lib/pioneer.ts` (GLiNER call)
15. Implement `lib/tavily.ts`
16. Implement `lib/gemini.ts` with the Suggestion JSON contract
17. Wire `/api/suggest/route.ts` end-to-end. Test with real keys.

### Phase 5: GEO Simulator (2-3 hours)
18. Build the modal + progress indicator UI
19. Build the streaming `/api/simulate/route.ts` (use Server-Sent Events for step updates)
20. Build the final results view with Recharts horizontal bars
21. Wire up the top-right button

### Phase 6: Polish (1-2 hours)
22. Empty states, loading skeletons, error toasts
23. Smooth transitions between dashboard ↔ studio
24. Test the full demo flow 3 times end-to-end. Fix any rough edges.

## Hard Constraints

- **Do not implement Gradium / TTS / STT.** It's not in scope.
- **Do not add authentication.** It's a demo. Use a hardcoded user ID.
- **Do not add a database.** Article state lives in Zustand + localStorage.
- **Do not add a landing page or marketing pages.** Skip straight to the dashboard.
- **Do not write tests.** Hackathon. We move fast and verify by running the app.

## Communication Protocol

- After each phase, summarize what's done in 3-5 bullets and confirm before moving on.
- If an API call fails during integration, surface the exact error and ask the user to verify the key — don't silently retry forever.
- If you find a screenshot ambiguous, ask one specific question: "In the Actions page, what's the exact background color of the card hover state?" Don't guess.