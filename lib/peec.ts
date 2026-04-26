// Dynamic project loader. Each project has its own snapshot at
//   data/peec-live-<projectId>.json
// produced by `vendor/peec_full_fetch.py --project-id <id> --output …`.
//
// All accessor functions accept an optional `projectId` argument. When
// omitted they use the module-level "current project" (set via
// `setCurrentProject`). When neither is set, they fall back to the static
// snapshot at data/peec-snapshot.ts iff USE_FALLBACK_SNAPSHOT=true.

import fs from "node:fs";
import path from "node:path";
import { peecSnapshot as fallbackSnapshot } from "../data/peec-snapshot";

// ═══════════════════════════════════════════════════════════════════════════
// TYPE DEFINITIONS (matching snapshot structure exactly)
// ═══════════════════════════════════════════════════════════════════════════

export interface ProjectProfile {
  project_id: string;
  profile: {
    name: string;
    occupation: string;
    industry: string;
    brandPresentation: string[];
    targetMarkets: Array<{ marketSize: string; location: string }>;
    audienceDistribution: Record<string, number>;
    productsAndServices: string[];
    usedPreparedProfile: boolean;
  };
}

export interface Brand {
  id: string;
  name: string;
  domains: string[];
  aliases: string[] | null;
  is_own: boolean;
}

export interface Topic {
  id: string;
  name: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface Prompt {
  id: string;
  text: string;
  tag_ids: string[];
  topic_id: string;
  volume: "very low" | "low" | "medium" | "high";
}

export interface BrandReportOverallRow {
  brand_id: string;
  brand_name: string;
  visibility: number;
  visibility_count: number;
  visibility_total: number;
  mention_count: number;
  share_of_voice: number;
  sentiment: number | null;
  sentiment_sum: number | null;
  sentiment_count: number | null;
  position: number | null;
  position_sum: number | null;
  position_count: number | null;
}

export interface BrandReportByModelRow {
  brand_id: string;
  brand_name: string;
  model_id: string;
  visibility: number;
  visibility_count: number;
  visibility_total: number;
  mention_count: number;
  share_of_voice: number;
  sentiment: number | null;
  position: number | null;
}

export interface ShareOfVoiceEntry {
  brand_id: string;
  brand_name: string;
  share_of_voice: number;
  visibility: number;
  mention_count: number;
  sentiment: number;
  avg_position: number;
}

export interface TopPromptCitedRow {
  prompt_id: string;
  prompt_text: string;
  visibility: number;
  mention_count: number;
  sentiment: number;
  avg_position: number;
}

export interface CompetitorGapUrl {
  url: string;
  classification: string;
  title: string;
  citation_count: number;
  retrieval_count: number;
  citation_rate: number;
  competitor_brand_ids_present: string[];
}

export interface SentimentBrand {
  brand_name: string;
  sentiment: number;
}

export interface TopCitedUrl {
  url: string;
  classification: string;
  title: string;
  citation_count: number;
  retrieval_count: number;
  citation_rate: number;
  mentioned_brand_ids: string[];
}

export interface HistoricalTrendRow {
  date: string;
  brand_id: string;
  brand_name: string;
  visibility: number;
  visibility_count: number;
  visibility_total: number;
  mention_count: number;
  share_of_voice: number;
  sentiment: number;
  avg_position: number;
}

export interface ActionItem {
  id: string;
  text: string;
  type: string;
  opportunity_score: number;
}

// Internal "snapshot shape" — the live JSON has the same structure as the
// static fallback by construction (the Python fetcher mirrors the TS file).
// We treat the static one's type as the canonical shape.
type SnapshotData = typeof fallbackSnapshot;

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC LOADER — module-level current project + per-project file cache
// ═══════════════════════════════════════════════════════════════════════════

let _currentProjectId: string | null = null;
const _projectCache = new Map<string, SnapshotData>();

/** Set the project id used by accessors when none is passed explicitly. */
export function setCurrentProject(projectId: string | null): void {
  _currentProjectId = projectId;
}

/** Read the module-level current project id (or `null` if none set). */
export function getCurrentProject(): string | null {
  return _currentProjectId;
}

/** Drop the in-memory cache for one project, or all if `projectId` is omitted. */
export function clearProjectCache(projectId?: string): void {
  if (projectId) _projectCache.delete(projectId);
  else _projectCache.clear();
  // Context cache is keyed by projectId+title — flush it too so consumers
  // see fresh data after a re-fetch.
  contextCache.clear();
}

function _projectFilePath(projectId: string): string {
  return path.join(
    process.cwd(),
    "data",
    `peec-live-${projectId}.json`,
  );
}

/**
 * Read the per-project live JSON snapshot, with a 5-minute in-memory cache
 * keyed by projectId. If the file is missing and `USE_FALLBACK_SNAPSHOT=true`
 * is set in the environment, returns the static snapshot. Otherwise throws.
 */
export function loadProjectData(projectId: string): SnapshotData {
  const cached = _projectCache.get(projectId);
  if (cached) return cached;

  const filePath = _projectFilePath(projectId);
  if (!fs.existsSync(filePath)) {
    if (process.env.USE_FALLBACK_SNAPSHOT === "true") {
      console.warn(
        `[peec] No live data for ${projectId}; falling back to static snapshot.`,
      );
      return fallbackSnapshot;
    }
    throw new Error(
      `No data for project '${projectId}' at ${filePath}. ` +
        `Run \`python3 vendor/peec_full_fetch.py --project-id ${projectId} ` +
        `--output ${filePath}\` first, or set USE_FALLBACK_SNAPSHOT=true in ` +
        `.env.local for offline demos.`,
    );
  }

  let parsed: unknown;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to read or parse ${filePath}: ${(err as Error).message}`,
    );
  }
  // The Python fetcher's output mirrors the static shape exactly (verified
  // in Step 2). The cast is safe.
  const data = parsed as SnapshotData;
  _projectCache.set(projectId, data);
  return data;
}

function _data(projectId?: string): SnapshotData {
  const id = projectId ?? _currentProjectId;
  if (!id) {
    if (process.env.USE_FALLBACK_SNAPSHOT === "true") return fallbackSnapshot;
    throw new Error(
      "No project selected. Either call setCurrentProject(projectId), " +
        "pass projectId to the accessor, or set USE_FALLBACK_SNAPSHOT=true.",
    );
  }
  return loadProjectData(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCESSOR FUNCTIONS — every function takes an optional projectId
// ═══════════════════════════════════════════════════════════════════════════

/** Get the project profile (name, industry, audience, products, etc.). */
export function getBrandProfile(projectId?: string): ProjectProfile {
  return _data(projectId).projectProfile as unknown as ProjectProfile;
}

/** Get own brand name. */
export function getOwnBrandName(projectId?: string): string {
  return _data(projectId).projectProfile.profile.name;
}

/** Get all brands (own + competitors). */
export function getAllBrands(projectId?: string): Brand[] {
  return _data(projectId).brands.rows as unknown as Brand[];
}

/** Get own brand object. */
export function getOwnBrand(projectId?: string): Brand {
  const own = _data(projectId).brands.rows.find((b) => b.is_own);
  if (!own) throw new Error("Own brand not found in snapshot");
  return own as unknown as Brand;
}

/** Get all competitor brands. */
export function getCompetitors(projectId?: string): Brand[] {
  return _data(projectId).brands.rows.filter((b) => !b.is_own) as unknown as Brand[];
}

/** Get all topics. */
export function getTopics(projectId?: string): Topic[] {
  return _data(projectId).topics.rows as unknown as Topic[];
}

/** Get all tags. */
export function getTags(projectId?: string): Tag[] {
  return _data(projectId).tags.rows as unknown as Tag[];
}

/** Get all tracked prompts. */
export function getPrompts(projectId?: string): Prompt[] {
  return _data(projectId).prompts.rows as unknown as Prompt[];
}

/** Get brand report for all brands (30-day overall). */
export function getBrandReportOverall(projectId?: string): BrandReportOverallRow[] {
  return _data(projectId).brandReportOverall.rows as unknown as BrandReportOverallRow[];
}

/** Get brand report split by LLM model. */
export function getBrandReportByModel(projectId?: string): BrandReportByModelRow[] {
  return _data(projectId).brandReportByModel.rows as unknown as BrandReportByModelRow[];
}

/** Get share of voice: own brand vs competitors. */
export function getShareOfVoice(projectId?: string): {
  ownBrand: ShareOfVoiceEntry;
  competitors: ShareOfVoiceEntry[];
} {
  const sov = _data(projectId).shareOfVoice;
  return {
    ownBrand: sov.ownBrand as unknown as ShareOfVoiceEntry,
    competitors: sov.competitors as unknown as ShareOfVoiceEntry[],
  };
}

/** Get top prompts where own brand is cited. */
export function getTopPromptsCited(projectId?: string): TopPromptCitedRow[] {
  return _data(projectId).topPromptsBrandCited.rows as unknown as TopPromptCitedRow[];
}

/** Get URLs with competitor mentions but no own brand mention (gap analysis). */
export function getCompetitorGapUrls(projectId?: string): CompetitorGapUrl[] {
  return _data(projectId).competitorGapUrls.rows as unknown as CompetitorGapUrl[];
}

/** Get sentiment: own brand vs competitors. */
export function getSentiment(projectId?: string): {
  ownBrand: { brand_id: string; brand_name: string; sentiment: number };
  byModel: Record<string, { sentiment: number }>;
  competitors: SentimentBrand[];
} {
  const sd = _data(projectId).sentimentData;
  return {
    ownBrand: sd.ownBrand as unknown as {
      brand_id: string;
      brand_name: string;
      sentiment: number;
    },
    byModel: sd.byModel,
    competitors: sd.competitors as unknown as SentimentBrand[],
  };
}

/** Get top cited URLs (all brands). */
export function getTopCitedUrls(projectId?: string): TopCitedUrl[] {
  return _data(projectId).topCitedUrls.rows as unknown as TopCitedUrl[];
}

/** Get historical trends: daily metrics. */
export function getHistoricalTrends(projectId?: string): HistoricalTrendRow[] {
  return _data(projectId).historicalTrends.rows as unknown as HistoricalTrendRow[];
}

/** Get date range of snapshot. */
export function getSnapshotDateRange(projectId?: string): {
  start: string;
  end: string;
} {
  const range = _data(projectId).brandReportOverall.dateRange;
  return { start: range.start, end: range.end };
}

/**
 * Get actions. Tolerates both shapes:
 *   • static fallback: { status, note, suggestedCall }
 *   • live JSON:       { status, items: ActionItem[] }
 * Always returns the union — callers should check `items` for live data.
 */
export function getActionsStatus(projectId?: string): {
  status: string;
  note?: string;
  suggestedCall?: Record<string, unknown>;
  items?: ActionItem[];
} {
  const a = _data(projectId).actions as unknown as {
    status: string;
    note?: string;
    suggestedCall?: Record<string, unknown>;
    items?: ActionItem[];
  };
  return {
    status: a.status ?? "unavailable",
    note: a.note,
    suggestedCall: a.suggestedCall,
    items: a.items,
  };
}

/** Get metrics for a specific brand by display name. */
export function getBrandMetrics(
  brandName: string,
  projectId?: string,
): BrandReportOverallRow | null {
  return (
    (_data(projectId).brandReportOverall.rows.find(
      (row) => row.brand_name === brandName,
    ) as unknown as BrandReportOverallRow) || null
  );
}

/** Get prompts for a specific topic. */
export function getPromptsByTopic(topicId: string, projectId?: string): Prompt[] {
  return _data(projectId).prompts.rows.filter(
    (p) => p.topic_id === topicId,
  ) as unknown as Prompt[];
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT BUILDER — used by /api/suggest to feed Gemini a compact snapshot
// of GEO state relevant to the article being drafted.
// ═══════════════════════════════════════════════════════════════════════════

export interface PeecContext {
  brandProfile: {
    name: string;
    industry: string;
    productsAndServices: string[];
    brandPresentation: string[];
  };
  metrics: {
    ownBrand: {
      share_of_voice: number;
      visibility: number;
      mention_count: number;
      sentiment: number;
      avg_position: number;
    };
    topCompetitors: Array<{
      brand_name: string;
      share_of_voice: number;
      visibility: number;
      mention_count: number;
      sentiment: number;
      avg_position: number;
    }>;
  };
  relevantPrompts: Array<{
    prompt_text: string;
    visibility: number;
    mention_count: number;
    sentiment: number;
    avg_position: number;
  }>;
  relevantGapUrls: Array<{
    url: string;
    title: string;
    classification: string;
    citation_count: number;
    citation_rate: number;
    competitor_count: number;
  }>;
  dateRange: { start: string; end: string };
}

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "but", "to", "in", "on", "for",
  "with", "without", "is", "are", "was", "were", "be", "been", "being",
  "by", "as", "at", "from", "this", "that", "these", "those", "your",
  "you", "we", "i", "it", "its", "their", "them", "they", "how", "what",
  "when", "where", "why", "which", "who", "do", "does", "did", "can",
  "could", "would", "should", "will", "may", "best", "vs", "versus",
]);

function tokenize(input: string): Set<string> {
  return new Set(
    input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

function relevanceScore(haystack: string, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const hayTokens = tokenize(haystack);
  let hits = 0;
  for (const t of queryTokens) if (hayTokens.has(t)) hits++;
  return hits;
}

interface CacheEntry {
  value: PeecContext;
  expiresAt: number;
}
const contextCache = new Map<string, CacheEntry>();
const CONTEXT_TTL_MS = 5 * 60_000;

/**
 * Get a compact, article-tailored snapshot of Peec GEO data.
 * Cached in-memory for 5 minutes per (projectId, lowercased title) pair.
 */
export function getRelevantContext(
  articleTitle: string,
  projectId?: string,
): PeecContext {
  const id = projectId ?? _currentProjectId ?? "_fallback";
  const key = `${id}::${articleTitle.trim().toLowerCase()}`;
  const now = Date.now();
  const hit = contextCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = buildContext(articleTitle, projectId);
  contextCache.set(key, { value, expiresAt: now + CONTEXT_TTL_MS });
  return value;
}

/** Clear the context cache (e.g., when underlying snapshot changes). */
export function clearContextCache(): void {
  contextCache.clear();
}

function buildContext(articleTitle: string, projectId?: string): PeecContext {
  const data = _data(projectId);
  const profile = data.projectProfile.profile;
  const sov = data.shareOfVoice;
  const range = data.brandReportOverall.dateRange;

  const tokens = tokenize(articleTitle);

  const ownMetrics = {
    share_of_voice: sov.ownBrand.share_of_voice,
    visibility: sov.ownBrand.visibility,
    mention_count: sov.ownBrand.mention_count,
    sentiment: sov.ownBrand.sentiment,
    avg_position: sov.ownBrand.avg_position,
  };

  const topCompetitors = sov.competitors
    .slice()
    .sort((a, b) => b.share_of_voice - a.share_of_voice)
    .slice(0, 5)
    .map((c) => ({
      brand_name: c.brand_name,
      share_of_voice: c.share_of_voice,
      visibility: c.visibility,
      mention_count: c.mention_count,
      sentiment: c.sentiment,
      avg_position: c.avg_position,
    }));

  const allPrompts = data.topPromptsBrandCited.rows;
  const scoredPrompts = allPrompts
    .map((p) => ({ row: p, score: relevanceScore(p.prompt_text, tokens) }))
    .sort((a, b) => b.score - a.score || b.row.visibility - a.row.visibility)
    .slice(0, 5)
    .map(({ row }) => ({
      prompt_text: row.prompt_text,
      visibility: row.visibility,
      mention_count: row.mention_count,
      sentiment: row.sentiment,
      avg_position: row.avg_position,
    }));

  const allGaps = data.competitorGapUrls.rows;
  const scoredGaps = allGaps
    .map((g) => ({
      row: g,
      score:
        relevanceScore(g.title || "", tokens) +
        relevanceScore(g.url, tokens),
    }))
    .sort((a, b) => b.score - a.score || b.row.citation_count - a.row.citation_count)
    .slice(0, 5)
    .map(({ row }) => ({
      url: row.url,
      title: row.title,
      classification: row.classification,
      citation_count: row.citation_count,
      citation_rate: row.citation_rate,
      competitor_count: row.competitor_brand_ids_present.length,
    }));

  return {
    brandProfile: {
      name: profile.name,
      industry: profile.industry,
      productsAndServices: [...profile.productsAndServices],
      brandPresentation: [...profile.brandPresentation],
    },
    metrics: { ownBrand: ownMetrics, topCompetitors },
    relevantPrompts: scoredPrompts,
    relevantGapUrls: scoredGaps,
    dateRange: { start: range.start, end: range.end },
  };
}
