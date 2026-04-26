import { GoogleGenAI } from "@google/genai";
import { getEnv } from "./env";
import type {
  ExtractedEntities,
  Suggestion,
  TavilyResult,
} from "./types";
import type { PeecContext } from "./peec";

const PRO_MODEL = "gemini-2.5-pro";
const FLASH_MODEL = "gemini-2.5-flash";

let _client: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: getEnv().GEMINI_API_KEY });
  }
  return _client;
}

// ── Schemas (responseSchema for strict-JSON mode) ──────────────────────────

const SUGGESTION_TYPES = [
  "add_entity",
  "strengthen_claim",
  "add_citation",
  "reframe",
  "competitor_gap",
] as const;

const SEVERITIES = ["high", "medium", "low"] as const;

const suggestionsSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      type: { type: "string", enum: [...SUGGESTION_TYPES] },
      severity: { type: "string", enum: [...SEVERITIES] },
      range: {
        type: "object",
        properties: {
          from: { type: "integer" },
          to: { type: "integer" },
        },
        required: ["from", "to"],
      },
      layman: { type: "string" },
      technicalWhy: { type: "string" },
      suggestedEdit: { type: "string" },
    },
    required: [
      "id",
      "type",
      "severity",
      "range",
      "layman",
      "technicalWhy",
    ],
  },
};

const promptsSchema = {
  type: "array",
  items: { type: "string" },
};

const scoredPromptSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      ownLikelihood: { type: "number" },
      competitors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            likelihood: { type: "number" },
          },
          required: ["name", "likelihood"],
        },
      },
      reasoning: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["prompt", "ownLikelihood", "competitors", "reasoning", "confidence"],
  },
};

// ── System prompts ─────────────────────────────────────────────────────────

const SUGGESTIONS_SYSTEM = `You are a Generative Engine Optimization (GEO) advisor inside a writing tool called Peec Content Studio.

YOUR USER
The user is a marketer or content writer drafting an article — NOT an engineer. Speak to them like a teammate, not a technical document.

YOUR JOB
Read their draft plus the supporting context, then produce 3 to 7 GEO suggestions (NEVER more) that improve the article's chances of being cited by LLMs (ChatGPT, Gemini, Claude, Perplexity).

INPUTS YOU RECEIVE
- title:          the article title
- article:        the article body, as PLAIN TEXT — character offsets are 0-indexed into this string
- peecContext:    own brand profile + GEO metrics + top competitors + relevant prompt and gap-URL data
- tavilyResults:  live web search results for the topic (what LLMs are likely indexing)
- entities:       BRAND and PRODUCT entities the NER pipeline already extracted from the draft, with character spans

OUTPUT SHAPE
A JSON array of suggestion objects. Schema is enforced separately.

FIELD-BY-FIELD RULES

id
  Short kebab-case slug, unique within the response. Example: "add-apple-comparison".

type
  Exactly one of: "add_entity", "strengthen_claim", "add_citation", "reframe", "competitor_gap".

severity
  "high"   — backed by strong Peec data. Examples that warrant high:
              • a competitor in \`entities\` ALSO appears in peecContext.metrics.topCompetitors
              • a competitor with > 15% share-of-voice on a topic relevant to this article
              • the user's own brand (peecContext.brandProfile.name) is missing entirely from the draft
  "medium" — partial signal (mid-tier competitor; secondary citation opportunity)
  "low"    — best practice / hygiene (e.g., add a citation where any claim is unsupported)

range
  Character offsets into the article BODY (NOT title). \`from\` < \`to\`. Both must be valid indices in the article string.
  The substring article.slice(from, to) must be text actually present in the body.
  If your suggestion applies generally with no specific span, point at the FIRST sentence's range.
  NEVER invent ranges or point at text not in the article.

layman
  ONE actionable sentence in plain marketer English. NO numbers, NO percentages, NO jargon.
  Tell them WHAT to do — not why. Imperative voice.
  Good: "Mention Apple here — they dominate this query in ChatGPT."
  Good: "Add a quote from a published earbuds review to back this claim."
  Bad:  "Apple holds 23% share of voice, so consider mentioning them."
  Bad:  "This sentence lacks an authoritative citation per E-E-A-T."

technicalWhy
  Detailed analyst-level explanation. THIS is where jargon, numbers, and Peec metrics live.
  Cite SPECIFIC peecContext values: SoV %, visibility %, mention counts, prompt-level data, dateRange.
  3 to 5 sentences. Reference exact numbers ONLY from peecContext.

suggestedEdit (optional)
  When you can offer a concrete one-click replacement, provide it as a string.
  This will REPLACE the substring article.slice(from, to). It should read naturally in flow.
  Omit (or set "") when the change is too contextual for a one-line replacement.

HARD RULES — DO NOT BREAK
1. NEVER hallucinate metrics. Every number in technicalWhy must come from peecContext.
2. NEVER include metrics, percentages, or technical terms in layman.
3. NEVER produce more than 7 suggestions. Better 3 strong than 7 weak.
4. NEVER produce ranges that don't exist in the article body.
5. If entities is empty AND article body is short (<60 characters), return an empty array — do not invent suggestions about content that isn't there.
6. Prefer suggestions tied to peecContext.relevantPrompts and peecContext.relevantGapUrls when relevant — these are the user's biggest GEO gaps.
7. If \`entities\` contains a brand that's also in peecContext.metrics.topCompetitors, that is a HIGH severity opportunity to flag (likely type="competitor_gap" or "add_entity").`;

const SCORE_SYSTEM = `You score candidate user prompts for a GEO (Generative Engine Optimization) simulator inside Peec Content Studio.

YOUR INPUTS
- candidates:    a list of conversational user prompts that an LLM might receive about this article's topic
- peecContext:   the user's brand profile + GEO metrics + relevantPrompts (tracked prompts where their brand is already cited) + topCompetitors + relevantGapUrls
- entities:      BRAND and PRODUCT entities NER-extracted from the draft

YOUR JOB
Score every candidate prompt for:
  1. ownLikelihood       — 0-100, the probability the user's brand will be cited by an LLM answering this prompt
  2. competitors         — up to 3 entries, each { name, likelihood (0-100) }. Names MUST come from peecContext.metrics.topCompetitors only. NEVER invent a competitor.
  3. reasoning           — exactly one sentence in this shape: "Strong because: <Peec-grounded reason>. Weak because: <Peec-grounded reason>."
  4. confidence          — "high" | "medium" | "low"

GROUNDING — NON-NEGOTIABLE
Every score MUST reference signal from peecContext. Specifically:
- If a candidate prompt resembles an entry in peecContext.relevantPrompts (same brand pair, same intent, similar phrasing), use THAT entry's actual visibility and mention_count to set ownLikelihood. Do NOT invent.
- If the candidate maps to a topic where competitor SoV from peecContext.metrics.topCompetitors is high (>15%), the competitor likelihoods on that prompt should be high.
- If peecContext.relevantGapUrls has high-citation gap URLs covering the candidate's topic, that's strong negative signal for own brand (competitors are cited there, brand isn't).
- If NO matching peecContext entry exists for a candidate (no similar relevantPrompt, no relevant gap URL), set confidence: "low" and put a literal disclaimer at the end of reasoning: "(Limited Peec data on this query — score is directional only.)"

NUMBER DISCIPLINE
- Scores 80-100: very high (matches a tracked prompt with visibility ≥ 0.8 OR strong own-brand cited URLs)
- Scores 50-79: moderate (some signal — partial match, mid-tier competitor presence)
- Scores 20-49: low (no own-brand cited URLs, competitors dominate)
- Scores 0-19:  very low (clear miss — competitor stronghold)
Calibrate competitor likelihoods the same way using their topCompetitors.share_of_voice and visibility.

CALIBRATION REALISM — IMPORTANT
Even brand-owned queries rarely score 100/0. Real LLM answers cite adjacent or competing brands for context, comparison, or "similar to" references. For example, an answer about Nothing's glyph interface will likely also mention Apple's Dynamic Island for comparison; an answer about a brand's design philosophy will cite competitors for context.

Therefore: unless a query is hyper-specific to a proprietary brand asset that no LLM would mention competitors for, ALWAYS assign at least one competitor a non-zero likelihood (typically 15-40 for adjacent context). A 100/0/0/0 score should be rare — reserve it for queries about non-public proprietary IP (e.g., internal roadmaps, unreleased SKUs).

DEDUPLICATION RULE — Pixel vs Google
For prompts where the relevant competitor would be Google's Pixel phone, do NOT separately score "Pixel" AND "Google" — they are effectively the same product family in this dataset. Pick whichever name is more specific to the prompt context (use "Pixel" when discussing the phone product directly, "Google" when discussing the broader ecosystem or software).

OUTPUT
A JSON array containing one object per candidate prompt, scoring ALL inputs. The caller takes the top 5. Do not pre-filter or rank — return them in the order received.`;

const PROMPTS_SYSTEM = `Generate the requested number of candidate user prompts that someone would realistically type into an LLM (ChatGPT, Gemini, Claude, Perplexity) about this article's topic.

These prompts will feed a GEO simulator that estimates how often LLMs cite this article.

CRITERIA
- Each prompt must be a plausible, conversational user query (not a bare search keyword).
- Vary intent: comparison, recommendation, how-to, explainer, listicle, troubleshooting.
- Mix specificity: some broad, some narrow.
- Reference brands/products from entities or peecContext where natural.
- No duplicates — each prompt must explore a different angle.

OUTPUT
A JSON array of strings, length == the count specified in the user message. No keys, no preamble, no commentary.`;

// ── Public API ─────────────────────────────────────────────────────────────

export interface GenerateSuggestionsInput {
  article: string;
  title: string;
  peecContext: PeecContext;
  tavilyResults: TavilyResult[];
  entities: ExtractedEntities;
}

export async function generateSuggestions(
  input: GenerateSuggestionsInput,
): Promise<Suggestion[]> {
  const { article, title, peecContext, tavilyResults, entities } = input;

  const userPrompt = [
    `# Article title`,
    title || "(untitled)",
    ``,
    `# Article body (character-indexed for ranges)`,
    article,
    ``,
    `# peecContext`,
    JSON.stringify(peecContext, null, 2),
    ``,
    `# tavilyResults`,
    JSON.stringify(tavilyResults, null, 2),
    ``,
    `# entities (already extracted from the body — reuse spans where possible)`,
    JSON.stringify(entities, null, 2),
    ``,
    `Now produce 3-7 GEO suggestions per the system instructions. Return ONLY the JSON array.`,
  ].join("\n");

  const res = await client().models.generateContent({
    model: PRO_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: SUGGESTIONS_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: suggestionsSchema,
      temperature: 0.4,
      thinkingConfig: { thinkingBudget: 128 },
    },
  });

  const raw = res.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Gemini Pro returned non-JSON. Error: ${(err as Error).message}. Raw (first 500): ${raw.slice(0, 500)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Gemini Pro response is not an array. Got: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }
  return parsed as Suggestion[];
}

export interface GeneratePromptCandidatesInput {
  article: string;
  entities: ExtractedEntities;
  peecContext: PeecContext;
  /** Number of prompts to generate. Default 15. */
  count?: number;
}

export async function generatePromptCandidates(
  input: GeneratePromptCandidatesInput,
): Promise<string[]> {
  const { article, entities, peecContext, count = 15 } = input;

  const userPrompt = [
    `# Article body`,
    article,
    ``,
    `# Entities`,
    JSON.stringify(entities, null, 2),
    ``,
    `# Brand context`,
    JSON.stringify(
      {
        ownBrand: peecContext.brandProfile,
        topCompetitors: peecContext.metrics.topCompetitors.map(
          (c) => c.brand_name,
        ),
      },
      null,
      2,
    ),
    ``,
    `Generate exactly ${count} candidate user prompts.`,
  ].join("\n");

  const res = await client().models.generateContent({
    model: FLASH_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: PROMPTS_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: promptsSchema,
      temperature: 0.7,
      // Flash allows 0 (unlike Pro which has a 128 minimum). Skipping
      // extended reasoning drops ~5–6s — fine since prompt-candidate
      // generation is a generative task, not analytical.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw = res.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Gemini Flash returned non-JSON. Error: ${(err as Error).message}. Raw (first 500): ${raw.slice(0, 500)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Gemini Flash response is not an array. Got: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }
  return (parsed as unknown[]).filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0,
  );
}

// ── scorePromptCandidates ──────────────────────────────────────────────────

export interface ScoredCompetitor {
  name: string;
  likelihood: number;
}

export interface ScoredPrompt {
  prompt: string;
  ownLikelihood: number;
  competitors: ScoredCompetitor[];
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

export interface ScorePromptCandidatesInput {
  candidates: string[];
  peecContext: PeecContext;
  entities: ExtractedEntities;
}

/**
 * Score 15 candidate prompts against the user's Peec context. Returns the
 * top 5 by ownLikelihood. Uses Gemini Pro with the same minimum thinking
 * budget as generateSuggestions (128) to keep latency tight.
 */
export async function scorePromptCandidates(
  input: ScorePromptCandidatesInput,
): Promise<ScoredPrompt[]> {
  const { candidates, peecContext, entities } = input;
  if (candidates.length === 0) return [];

  // Trim peecContext for the scoring call — Pro only needs the top signal
  // bands. The full peecContext stays available to Flash and the suggestion
  // engine. Cuts Pro's input tokens by ~40% which materially reduces latency.
  const trimmedPeecContext = {
    brandProfile: peecContext.brandProfile,
    metrics: {
      ownBrand: peecContext.metrics.ownBrand,
      topCompetitors: peecContext.metrics.topCompetitors.slice(0, 3),
    },
    relevantPrompts: peecContext.relevantPrompts.slice(0, 3),
    relevantGapUrls: peecContext.relevantGapUrls.slice(0, 3),
    dateRange: peecContext.dateRange,
  };

  const allowedCompetitors = trimmedPeecContext.metrics.topCompetitors.map(
    (c) => c.brand_name,
  );

  const userPrompt = [
    `# Candidate prompts to score (in order)`,
    JSON.stringify(candidates, null, 2),
    ``,
    `# peecContext (trimmed to top-3 signal bands for scoring)`,
    JSON.stringify(trimmedPeecContext, null, 2),
    ``,
    `# entities`,
    JSON.stringify(entities, null, 2),
    ``,
    `# Allowed competitor names (use ONLY these; do not invent)`,
    JSON.stringify(allowedCompetitors),
    ``,
    `Score every candidate. Return a JSON array, same length as the input list.`,
  ].join("\n");

  const res = await client().models.generateContent({
    model: PRO_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: SCORE_SYSTEM,
      responseMimeType: "application/json",
      responseSchema: scoredPromptSchema,
      temperature: 0.3,
      thinkingConfig: { thinkingBudget: 128 },
    },
  });

  const raw = res.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Gemini Pro (scoring) returned non-JSON. Error: ${(err as Error).message}. Raw (first 500): ${raw.slice(0, 500)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Gemini Pro (scoring) response is not an array. Got: ${JSON.stringify(parsed).slice(0, 300)}`,
    );
  }

  const allowed = new Set(allowedCompetitors);
  const cleaned: ScoredPrompt[] = (parsed as ScoredPrompt[]).map((s) => ({
    ...s,
    // Defensive: drop any competitor not on the allow-list (don't trust the model).
    competitors: (s.competitors ?? [])
      .filter((c) => allowed.has(c.name))
      .slice(0, 3),
  }));

  // Top 5 by ownLikelihood.
  return cleaned
    .slice()
    .sort((a, b) => b.ownLikelihood - a.ownLikelihood)
    .slice(0, 5);
}
