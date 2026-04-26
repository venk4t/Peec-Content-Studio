/**
 * Wire types shared between the streaming /api/simulate route and the
 * SimulatorModal component.
 */

export type SimulatorStepKey =
  | "pioneer"
  | "gemini-flash"
  | "peec"
  | "gemini-pro";

export type SimulatorStepStatus = "pending" | "running" | "complete" | "error";

export interface SimulatorStepDescriptor {
  key: SimulatorStepKey;
  label: string;
}

export const SIMULATOR_STEPS: SimulatorStepDescriptor[] = [
  { key: "pioneer", label: "Extracting entities from your draft…" },
  { key: "gemini-flash", label: "Generating candidate prompts…" },
  { key: "peec", label: "Querying your GEO baseline…" },
  { key: "gemini-pro", label: "Scoring citation likelihood…" },
];

/** SSE event payloads (event name = type field). */
export type SimulatorEvent =
  | { type: "step"; key: SimulatorStepKey; status: SimulatorStepStatus; ms?: number; detail?: string }
  | { type: "result"; topPrompts: ScoredPrompt[] }
  | { type: "error"; source: SimulatorStepKey | "validation" | "timeout" | "unknown"; message: string };

/** Per-prompt scoring output produced by gemini-pro in step 4. */
export interface ScoredCompetitor {
  name: string;
  likelihood: number; // 0-100
}

export interface ScoredPrompt {
  prompt: string;
  ownLikelihood: number; // 0-100
  competitors: ScoredCompetitor[]; // up to 3
  reasoning: string;
  confidence: "high" | "medium" | "low";
}
