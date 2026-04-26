import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getRelevantContext, setCurrentProject } from "@/lib/peec";
import {
  PROJECT_COOKIE_NAME,
  isValidProjectId,
} from "@/lib/peec-project-cookie";
import { searchTopic } from "@/lib/tavily";
import { extractEntities } from "@/lib/pioneer";
import { generateSuggestions } from "@/lib/gemini";
import type {
  Suggestion,
  SuggestErrorBody,
  SuggestErrorSource,
} from "@/lib/types";

const RequestSchema = z.object({
  articleId: z.string().min(1),
  articleTitle: z.string(),
  articleText: z.string(),
});

const ENTITY_LABELS = [
  "BRAND",
  "PRODUCT",
  "COMPETITOR",
  "CITABLE_CLAIM",
] as const;

const TOTAL_BUDGET_MS = 15_000;
const MIN_TEXT_LENGTH = 60;

class TaggedError extends Error {
  constructor(
    public readonly source: SuggestErrorSource,
    message: string,
  ) {
    super(message);
  }
}

function errorResponse(
  source: SuggestErrorSource,
  message: string,
  status = 502,
): NextResponse<SuggestErrorBody> {
  return NextResponse.json({ error: message, source }, { status });
}

/**
 * Convert a plain-text character offset into a ProseMirror position for a
 * Tiptap doc whose body was produced via `editor.getText()` (default
 * blockSeparator `\n\n`).
 *
 * For that case the relationship is uniform: PM position = offset + 1.
 * The +1 accounts for the open of the very first paragraph; subsequent
 * paragraph boundaries (`\n\n`, 2 chars in plain) consume exactly 2 PM
 * positions (close-of-prev + open-of-next), so the delta stays at +1.
 *
 * docSize = plainText.length + 2 (one for the leading paragraph open,
 * one for the trailing paragraph close).
 */
function textOffsetToPMPosition(offset: number, docSize: number): number {
  const pos = offset + 1;
  // Clamp to valid range [1, docSize-1] (positions 0 and docSize are
  // outside any paragraph and not valid for inline decorations).
  if (pos < 1) return 1;
  if (pos > docSize - 1) return docSize - 1;
  return pos;
}

/**
 * Expand a plain-text [from, to) range outward until both ends sit on
 * whitespace boundaries (or text edges). Gemini occasionally hands back
 * ranges that bisect a word — without snapping, applying suggestedEdit
 * leaves seams like "anyone " ⇒ "anyo" + edit text.
 */
function snapToWordBoundaries(
  text: string,
  from: number,
  to: number,
): { from: number; to: number } {
  let f = Math.max(0, Math.min(from, text.length));
  let t = Math.max(0, Math.min(to, text.length));
  // Walk `from` left until the previous char is whitespace (or we hit start).
  while (f > 0 && /\S/.test(text[f - 1])) f--;
  // Walk `to` right until the current char is whitespace (or we hit end).
  while (t < text.length && /\S/.test(text[t])) t++;
  return { from: f, to: t };
}

function adjustRanges(
  suggestions: Suggestion[],
  text: string,
): Suggestion[] {
  const docSize = text.length + 2;
  const adjusted: Suggestion[] = [];
  for (const s of suggestions) {
    // Snap to word boundaries first (in plain-text coordinates), then
    // convert to ProseMirror positions.
    const snapped = snapToWordBoundaries(text, s.range.from, s.range.to);
    if (snapped.from >= snapped.to) continue;
    const from = textOffsetToPMPosition(snapped.from, docSize);
    const to = textOffsetToPMPosition(snapped.to, docSize);
    if (from >= to) continue; // drop degenerate
    adjusted.push({ ...s, range: { from, to } });
  }
  return adjusted;
}

async function timed<T>(
  label: string,
  fn: () => Promise<T> | T,
): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  return { value, ms };
}

async function runSuggest(
  articleTitle: string,
  articleText: string,
  projectId: string | undefined,
): Promise<Suggestion[]> {
  // Phase 1 — three pre-calls in parallel. Use allSettled so we can attribute
  // the failure to a specific provider rather than getting the generic
  // first-rejection from Promise.all.
  const phaseStart = performance.now();
  const [peecRes, tavilyRes, pioneerRes] = await Promise.allSettled([
    timed("peec", () => getRelevantContext(articleTitle, projectId)),
    timed("tavily", () => searchTopic(articleTitle, { maxResults: 3 })),
    timed("pioneer", () =>
      extractEntities(articleText, [...ENTITY_LABELS]),
    ),
  ]);
  const parallelMs = performance.now() - phaseStart;

  if (peecRes.status === "rejected") {
    throw new TaggedError("peec", String(peecRes.reason?.message ?? peecRes.reason));
  }
  if (tavilyRes.status === "rejected") {
    throw new TaggedError(
      "tavily",
      String(tavilyRes.reason?.message ?? tavilyRes.reason),
    );
  }
  if (pioneerRes.status === "rejected") {
    throw new TaggedError(
      "pioneer",
      String(pioneerRes.reason?.message ?? pioneerRes.reason),
    );
  }

  console.log(
    `[suggest]   peec    ${peecRes.value.ms.toFixed(0).padStart(5)}ms  (cached or sync)`,
  );
  console.log(
    `[suggest]   tavily  ${tavilyRes.value.ms.toFixed(0).padStart(5)}ms  ${tavilyRes.value.value.length} result(s)`,
  );
  console.log(
    `[suggest]   pioneer ${pioneerRes.value.ms.toFixed(0).padStart(5)}ms  ${pioneerRes.value.value.entities.length} entit(ies)`,
  );
  console.log(
    `[suggest]   ─ parallel wall-clock: ${parallelMs.toFixed(0)}ms`,
  );

  // Phase 2 — Gemini Pro synthesis.
  let geminiResult: { value: Suggestion[]; ms: number };
  try {
    geminiResult = await timed("gemini", () =>
      generateSuggestions({
        article: articleText,
        title: articleTitle,
        peecContext: peecRes.value.value,
        tavilyResults: tavilyRes.value.value,
        entities: pioneerRes.value.value,
      }),
    );
  } catch (err) {
    throw new TaggedError(
      "gemini",
      String((err as Error).message ?? err),
    );
  }

  console.log(
    `[suggest]   gemini  ${geminiResult.ms.toFixed(0).padStart(5)}ms  ${geminiResult.value.length} suggestion(s)`,
  );

  // Phase 3 — convert plain-text offsets to ProseMirror positions.
  const adjusted = adjustRanges(geminiResult.value, articleText);
  if (adjusted.length !== geminiResult.value.length) {
    console.log(
      `[suggest]   ranges  pruned ${geminiResult.value.length - adjusted.length} degenerate range(s)`,
    );
  }

  return adjusted;
}

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return errorResponse("validation", "Body must be valid JSON", 400);
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return errorResponse("validation", `Invalid request: ${issues}`, 400);
  }

  const { articleId, articleTitle, articleText } = parsed.data;

  if (articleText.trim().length < MIN_TEXT_LENGTH) {
    // Not an error — just nothing meaningful to suggest yet.
    return NextResponse.json({ suggestions: [] });
  }

  const t0 = performance.now();
  console.log(
    `[suggest] ▶ ${articleId} title="${articleTitle.slice(0, 60)}${articleTitle.length > 60 ? "…" : ""}" text=${articleText.length}ch`,
  );

  // Hard 15s budget — abort whatever's still in flight if we exceed it.
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new TaggedError("timeout", `Request exceeded ${TOTAL_BUDGET_MS}ms budget`)),
      TOTAL_BUDGET_MS,
    );
  });

  // Read the selected project from the cookie so peec accessors load
  // the right snapshot. API routes don't go through the dashboard layout's
  // ensureProjectSelected(), so we must resolve it here.
  const store = await cookies();
  const rawProjectId = store.get(PROJECT_COOKIE_NAME)?.value;
  const projectId = isValidProjectId(rawProjectId) ? rawProjectId : undefined;
  if (projectId) setCurrentProject(projectId);

  try {
    const suggestions = await Promise.race([
      runSuggest(articleTitle, articleText, projectId),
      timeoutPromise,
    ]);
    const totalMs = performance.now() - t0;
    console.log(
      `[suggest] ✓ ${articleId} TOTAL ${totalMs.toFixed(0)}ms · ${suggestions.length} suggestion(s)`,
    );
    return NextResponse.json({ suggestions });
  } catch (err) {
    const totalMs = performance.now() - t0;
    if (err instanceof TaggedError) {
      console.error(
        `[suggest] ✗ ${articleId} ${err.source.toUpperCase()} after ${totalMs.toFixed(0)}ms — ${err.message}`,
      );
      const status = err.source === "timeout" ? 504 : 502;
      return errorResponse(err.source, err.message, status);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[suggest] ✗ ${articleId} UNKNOWN after ${totalMs.toFixed(0)}ms — ${message}`,
    );
    return errorResponse("gemini", message);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}
