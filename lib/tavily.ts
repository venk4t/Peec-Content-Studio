import { getEnv } from "./env";
import type { TavilyResult } from "./types";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_MAX_RESULTS = 5;

export interface SearchTopicOptions {
  /** Max results to return (Tavily caps this around 20). Default 5. */
  maxResults?: number;
  /** "basic" (faster) or "advanced" (deeper crawl). Default "basic". */
  searchDepth?: "basic" | "advanced";
  /** Abort after this many ms. Default 8000. */
  timeoutMs?: number;
}

interface TavilyApiResponse {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
  query?: string;
  response_time?: number;
}

/**
 * Run a Tavily web search and normalize results to { title, url, snippet }.
 * Throws (with the upstream error body) on non-200 responses or invalid JSON.
 */
export async function searchTopic(
  query: string,
  opts: SearchTopicOptions = {},
): Promise<TavilyResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 8000,
  );

  let res: Response;
  try {
    res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query: trimmed,
        max_results: opts.maxResults ?? DEFAULT_MAX_RESULTS,
        search_depth: opts.searchDepth ?? "basic",
        include_answer: false,
        include_raw_content: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const body = await res.text();
  if (!res.ok) {
    throw new Error(
      `Tavily ${res.status} ${res.statusText} — ${body.slice(0, 400)}`,
    );
  }

  let parsed: TavilyApiResponse;
  try {
    parsed = JSON.parse(body) as TavilyApiResponse;
  } catch {
    throw new Error(
      `Tavily returned non-JSON. Raw (first 400): ${body.slice(0, 400)}`,
    );
  }

  return (parsed.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: (r.content ?? "").replace(/\s+/g, " ").trim(),
  }));
}
