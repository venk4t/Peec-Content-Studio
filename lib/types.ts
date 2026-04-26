export type SuggestionType =
  | "add_entity"
  | "strengthen_claim"
  | "add_citation"
  | "reframe"
  | "competitor_gap";

export type Severity = "high" | "medium" | "low";

export interface Suggestion {
  id: string;
  type: SuggestionType;
  severity: Severity;
  range: { from: number; to: number };
  layman: string;
  technicalWhy: string;
  suggestedEdit?: string;
}

export interface SuggestRequest {
  articleId: string;
  articleTitle: string;
  articleText: string;
}

export interface SuggestResponse {
  suggestions: Suggestion[];
}

export type SuggestErrorSource =
  | "validation"
  | "peec"
  | "tavily"
  | "pioneer"
  | "gemini"
  | "timeout";

export interface SuggestErrorBody {
  error: string;
  source: SuggestErrorSource;
}

// ── External integration shapes ─────────────────────────────────────────────

export interface TavilyResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ExtractedEntity {
  text: string;
  label: string;
  start: number;
  end: number;
  confidence: number;
}

export interface ExtractedEntities {
  entities: ExtractedEntity[];
}
