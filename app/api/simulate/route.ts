import { cookies } from "next/headers";
import { z } from "zod";
import { extractEntities } from "@/lib/pioneer";
import { getRelevantContext, setCurrentProject } from "@/lib/peec";
import {
  PROJECT_COOKIE_NAME,
  isValidProjectId,
} from "@/lib/peec-project-cookie";
import {
  generatePromptCandidates,
  scorePromptCandidates,
} from "@/lib/gemini";
import type {
  SimulatorEvent,
  SimulatorStepKey,
} from "@/lib/simulator-types";

const RequestSchema = z.object({
  articleTitle: z.string(),
  articleText: z.string(),
});

const ENTITY_LABELS = [
  "BRAND",
  "PRODUCT",
  "COMPETITOR",
  "CITABLE_CLAIM",
] as const;

/**
 * Total budget = observed landed latency (~13.4s) × 1.2 buffer = 16s.
 * Pioneer ~1s + Peec ~0s + Flash ~1.5s + Pro scoring 8 candidates ~11s
 * was the locked configuration after Phase 5.2 calibration + trim work.
 */
const TOTAL_BUDGET_MS = 16_000;
const MIN_TEXT_LENGTH = 60;
const CANDIDATE_COUNT = 8;

class TaggedError extends Error {
  constructor(
    public readonly source: SimulatorStepKey | "validation" | "timeout" | "unknown",
    message: string,
  ) {
    super(message);
  }
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("validation", "Body must be valid JSON", 400);
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return jsonError("validation", `Invalid request: ${issues}`, 400);
  }

  const { articleTitle, articleText } = parsed.data;

  // Resolve the selected project from the cookie so peec accessors load
  // the right snapshot. API routes bypass the dashboard layout's
  // ensureProjectSelected(), so we must resolve it ourselves.
  const store = await cookies();
  const rawProjectId = store.get(PROJECT_COOKIE_NAME)?.value;
  const projectId = isValidProjectId(rawProjectId) ? rawProjectId : undefined;
  if (projectId) setCurrentProject(projectId);

  if (articleText.trim().length < MIN_TEXT_LENGTH) {
    return jsonError("validation", "Article text too short to simulate", 400);
  }

  const encoder = new TextEncoder();
  const t0 = performance.now();
  console.log(
    `[simulate] ▶ title="${articleTitle.slice(0, 60)}${articleTitle.length > 60 ? "…" : ""}" text=${articleText.length}ch`,
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: SimulatorEvent) => {
        const eventName =
          event.type === "step"
            ? "step"
            : event.type === "result"
              ? "result"
              : "error";
        // SSE wire: `event:` + `data:` + blank line.
        const chunk = `event: ${eventName}\ndata: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      // Hard 12s budget — emit timeout error and close stream.
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () =>
            reject(
              new TaggedError(
                "timeout",
                `Simulator exceeded ${TOTAL_BUDGET_MS}ms budget`,
              ),
            ),
          TOTAL_BUDGET_MS,
        );
      });

      try {
        await Promise.race([
          runPipeline(articleTitle, articleText, send, projectId),
          timeoutPromise,
        ]);
      } catch (err) {
        const tagged =
          err instanceof TaggedError
            ? err
            : new TaggedError("unknown", String((err as Error).message ?? err));
        console.error(
          `[simulate] ✗ ${tagged.source.toUpperCase()} after ${(performance.now() - t0).toFixed(0)}ms — ${tagged.message}`,
        );
        send({
          type: "error",
          source: tagged.source,
          message: tagged.message,
        });
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const totalMs = performance.now() - t0;
        console.log(`[simulate] ─ TOTAL ${totalMs.toFixed(0)}ms`);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Drives the four phases in order, emitting SSE events at each transition.
 * Throws TaggedError on any provider failure so the start() handler can
 * dispatch a single `event: error`.
 */
async function runPipeline(
  articleTitle: string,
  articleText: string,
  send: (event: SimulatorEvent) => void,
  projectId: string | undefined,
) {
  // ── 1. Pioneer ────────────────────────────────────────────────────────
  send({ type: "step", key: "pioneer", status: "running" });
  let entities;
  const t1 = performance.now();
  try {
    entities = await extractEntities(articleText, [...ENTITY_LABELS]);
  } catch (err) {
    throw new TaggedError(
      "pioneer",
      String((err as Error).message ?? err),
    );
  }
  const ms1 = Math.round(performance.now() - t1);
  console.log(
    `[simulate]   pioneer     ${ms1.toString().padStart(5)}ms  ${entities.entities.length} entit(ies)`,
  );
  send({
    type: "step",
    key: "pioneer",
    status: "complete",
    ms: ms1,
    detail: `${entities.entities.length} entities extracted`,
  });

  // ── 2. Peec (instant; cached for 5 min) ──────────────────────────────
  send({ type: "step", key: "peec", status: "running" });
  const t2 = performance.now();
  let peecContext;
  try {
    peecContext = getRelevantContext(articleTitle, projectId);
  } catch (err) {
    throw new TaggedError("peec", String((err as Error).message ?? err));
  }
  const ms2 = Math.round(performance.now() - t2);
  console.log(`[simulate]   peec        ${ms2.toString().padStart(5)}ms`);
  send({
    type: "step",
    key: "peec",
    status: "complete",
    ms: ms2,
    detail: `${peecContext.metrics.topCompetitors.length} competitors · ${peecContext.relevantPrompts.length} relevant prompts`,
  });

  // ── 3. Gemini Flash — generate 15 candidates ──────────────────────────
  send({ type: "step", key: "gemini-flash", status: "running" });
  const t3 = performance.now();
  let candidates: string[];
  try {
    candidates = await generatePromptCandidates({
      article: articleText,
      entities,
      peecContext,
      count: CANDIDATE_COUNT,
    });
  } catch (err) {
    throw new TaggedError(
      "gemini-flash",
      String((err as Error).message ?? err),
    );
  }
  const ms3 = Math.round(performance.now() - t3);
  console.log(
    `[simulate]   gemini-flash ${ms3.toString().padStart(4)}ms  ${candidates.length} candidates`,
  );
  send({
    type: "step",
    key: "gemini-flash",
    status: "complete",
    ms: ms3,
    detail: `${candidates.length} candidate prompts`,
  });

  // ── 4. Gemini Pro — score and pick top 5 ──────────────────────────────
  send({ type: "step", key: "gemini-pro", status: "running" });
  const t4 = performance.now();
  let scored;
  try {
    scored = await scorePromptCandidates({
      candidates,
      peecContext,
      entities,
    });
  } catch (err) {
    throw new TaggedError(
      "gemini-pro",
      String((err as Error).message ?? err),
    );
  }
  const ms4 = Math.round(performance.now() - t4);
  console.log(
    `[simulate]   gemini-pro  ${ms4.toString().padStart(5)}ms  top ${scored.length}`,
  );
  send({
    type: "step",
    key: "gemini-pro",
    status: "complete",
    ms: ms4,
    detail: `Top ${scored.length} prompts`,
  });

  // ── Result ────────────────────────────────────────────────────────────
  send({ type: "result", topPrompts: scored });
}

function jsonError(
  source: "validation" | "unknown",
  message: string,
  status: number,
) {
  return new Response(JSON.stringify({ source, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
