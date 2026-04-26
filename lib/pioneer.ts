import { getEnv } from "./env";
import type { ExtractedEntities, ExtractedEntity } from "./types";

const PIONEER_INFERENCE_URL = "https://api.pioneer.ai/inference";

export interface ExtractEntitiesOptions {
  /** Override the model id (defaults to PIONEER_MODEL_ID env var). */
  modelId?: string;
  /** Abort after this many ms. Default 6000. */
  timeoutMs?: number;
}

interface PioneerEntityHit {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

interface PioneerResult {
  entities?: Record<string, PioneerEntityHit[]>;
}

interface PioneerApiResponse {
  result?: PioneerResult;
  model_used?: string;
  latency_ms?: number;
  token_usage?: number;
}

/**
 * Run Pioneer's GLiNER inference (`task=extract_entities`) and flatten
 * the per-label buckets into a single sorted list of entities with their
 * label preserved. Throws on non-200 or invalid JSON.
 */
export async function extractEntities(
  text: string,
  labels: readonly string[],
  opts: ExtractEntitiesOptions = {},
): Promise<ExtractedEntities> {
  const cleaned = text.trim();
  if (!cleaned || labels.length === 0) {
    return { entities: [] };
  }

  const env = getEnv();
  const modelId = opts.modelId ?? env.PIONEER_MODEL_ID;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 6000,
  );

  let res: Response;
  try {
    res = await fetch(PIONEER_INFERENCE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": env.PIONEER_API_KEY,
      },
      body: JSON.stringify({
        task: "extract_entities",
        model_id: modelId,
        text: cleaned,
        schema: [...labels],
        include_confidence: true,
        include_spans: true,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(
      `Pioneer ${res.status} ${res.statusText} — ${raw.slice(0, 400)}`,
    );
  }

  let parsed: PioneerApiResponse;
  try {
    parsed = JSON.parse(raw) as PioneerApiResponse;
  } catch {
    throw new Error(
      `Pioneer returned non-JSON. Raw (first 400): ${raw.slice(0, 400)}`,
    );
  }

  const buckets = parsed.result?.entities ?? {};
  const flat: ExtractedEntity[] = [];
  for (const [label, hits] of Object.entries(buckets)) {
    for (const h of hits ?? []) {
      flat.push({
        text: h.text,
        label,
        start: h.start,
        end: h.end,
        confidence: typeof h.confidence === "number" ? h.confidence : 0,
      });
    }
  }
  flat.sort((a, b) => a.start - b.start);
  return { entities: flat };
}
