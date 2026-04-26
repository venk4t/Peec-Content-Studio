"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Check,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SIMULATOR_STEPS,
  type ScoredPrompt,
  type SimulatorStepKey,
  type SimulatorStepStatus,
} from "@/lib/simulator-types";
import { SimulatorResults } from "@/components/simulator/SimulatorResults";

interface SimulatorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the modal opens — caller starts the SSE stream here. */
  articleTitle: string;
  articleText: string;
}

type StepState = Record<SimulatorStepKey, { status: SimulatorStepStatus; ms?: number; detail?: string }>;

const initialState = (): StepState => ({
  pioneer: { status: "pending" },
  "gemini-flash": { status: "pending" },
  peec: { status: "pending" },
  "gemini-pro": { status: "pending" },
});

export function SimulatorModal({
  open,
  onOpenChange,
  articleTitle,
  articleText,
}: SimulatorModalProps) {
  const [steps, setSteps] = useState<StepState>(initialState);
  const [results, setResults] = useState<ScoredPrompt[] | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // Restart the run every time the modal opens.
  useEffect(() => {
    if (!open) return;

    setSteps(initialState());
    setResults(null);
    setGlobalError(null);
    setTotalMs(null);
    startTimeRef.current = performance.now();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    runSimulation({
      articleTitle,
      articleText,
      signal: ctrl.signal,
      onStep: (key, status, ms, detail) =>
        setSteps((prev) => ({ ...prev, [key]: { status, ms, detail } })),
      onResult: (top) => {
        setResults(top);
        setTotalMs(performance.now() - startTimeRef.current);
      },
      onError: (msg, source) => {
        setSteps((prev) => {
          const next = { ...prev };
          // Prefer flipping the explicitly-tagged source; otherwise flip
          // whichever step is currently "running".
          const targets =
            source && source in next
              ? [source as SimulatorStepKey]
              : (Object.keys(next) as SimulatorStepKey[]).filter(
                  (k) => next[k].status === "running",
                );
          for (const k of targets) {
            next[k] = { ...next[k], status: "error" };
          }
          return next;
        });
        setGlobalError(msg);
      },
    });

    return () => ctrl.abort();
  }, [open, articleTitle, articleText]);

  const hasResults = !!results;
  const showCompactSteps = hasResults; // collapse step list once results arrive

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "p-0 overflow-hidden transition-all",
          hasResults ? "max-w-[760px]" : "max-w-[640px]",
        )}
        showCloseButton={true}
      >
        <div className="px-6 pt-5 pb-4 border-b border-gray-200">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[15px] font-semibold text-gray-900">
              <Sparkles className="w-4 h-4 text-emerald-600" />
              GEO Simulator
            </DialogTitle>
            <DialogDescription className="text-[12px] text-gray-500">
              {hasResults
                ? "Estimated citation likelihood across the prompts an LLM is most likely to receive about this topic."
                : "Estimating how likely your article is to be cited by ChatGPT, Gemini, Claude, and Perplexity."}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-5 max-h-[72vh] overflow-y-auto">
          {showCompactSteps ? (
            <CompactSteps steps={steps} totalMs={totalMs} />
          ) : (
            <ol className="space-y-3">
              {SIMULATOR_STEPS.map((step, i) => {
                const s = steps[step.key];
                return (
                  <StepRow
                    key={step.key}
                    index={i + 1}
                    label={step.label}
                    status={s.status}
                    ms={s.ms}
                    detail={s.detail}
                  />
                );
              })}
            </ol>
          )}

          {globalError && (
            <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="text-[12px] text-red-800 leading-relaxed">
                <p className="font-medium">Simulator failed</p>
                <p className="mt-1 text-red-700 break-words">{globalError}</p>
              </div>
            </div>
          )}

          {results && (
            <div className="mt-5">
              <SimulatorResults
                topPrompts={results}
                totalMs={totalMs ?? undefined}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompactSteps({
  steps,
  totalMs,
}: {
  steps: StepState;
  totalMs: number | null;
}) {
  const completed = SIMULATOR_STEPS.filter(
    (s) => steps[s.key].status === "complete",
  ).length;
  return (
    <div className="flex items-center gap-2 text-[11px] text-gray-500 -mt-1 mb-1">
      <Check className="w-3 h-3 text-emerald-600" />
      <span>
        Completed {completed} of {SIMULATOR_STEPS.length} steps
      </span>
      {typeof totalMs === "number" && (
        <span className="ml-auto tabular-nums">
          {(totalMs / 1000).toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function StepRow({
  index,
  label,
  status,
  ms,
  detail,
}: {
  index: number;
  label: string;
  status: SimulatorStepStatus;
  ms?: number;
  detail?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <StatusIcon status={status} index={index} />
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[13px]",
              status === "pending" && "text-gray-400",
              status === "running" && "text-gray-900 font-medium",
              status === "complete" && "text-gray-700",
              status === "error" && "text-red-700",
            )}
          >
            {label}
          </span>
          {typeof ms === "number" && status === "complete" && (
            <span className="text-[11px] text-gray-400 tabular-nums">
              {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
            </span>
          )}
        </div>
        {detail && (
          <p
            className={cn(
              "mt-0.5 text-[11px]",
              status === "error" ? "text-red-600" : "text-gray-500",
            )}
          >
            {detail}
          </p>
        )}
      </div>
    </li>
  );
}

function StatusIcon({
  status,
  index,
}: {
  status: SimulatorStepStatus;
  index: number;
}) {
  const base =
    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0";
  if (status === "pending") {
    return (
      <div className={cn(base, "bg-gray-100 text-gray-400")}>{index}</div>
    );
  }
  if (status === "running") {
    return (
      <div className={cn(base, "bg-emerald-50 text-emerald-700")}>
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  }
  if (status === "complete") {
    return (
      <div className={cn(base, "bg-emerald-500 text-white")}>
        <Check className="w-3 h-3" />
      </div>
    );
  }
  return (
    <div className={cn(base, "bg-red-500 text-white")}>
      <AlertCircle className="w-3 h-3" />
    </div>
  );
}

/**
 * Open an SSE stream to /api/simulate and translate events into callbacks.
 * The endpoint is wired in Phase 5.2 — for Phase 5.1 the modal still renders
 * correctly, just terminates with an error if the route returns 501.
 */
async function runSimulation({
  articleTitle,
  articleText,
  signal,
  onStep,
  onResult,
  onError,
}: {
  articleTitle: string;
  articleText: string;
  signal: AbortSignal;
  onStep: (
    key: SimulatorStepKey,
    status: SimulatorStepStatus,
    ms?: number,
    detail?: string,
  ) => void;
  onResult: (top: ScoredPrompt[]) => void;
  onError: (message: string, source?: string) => void;
}) {
  // Optimistic: mark the first step as running immediately.
  onStep("pioneer", "running");

  let res: Response;
  try {
    res = await fetch("/api/simulate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ articleTitle, articleText }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError((err as Error).message);
    return;
  }

  // Server may answer with non-stream JSON (validation errors, etc).
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !contentType.includes("text/event-stream")) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    onError(
      `Simulator endpoint returned ${res.status} ${res.statusText}` +
        (text ? ` — ${text.slice(0, 240)}` : ""),
      "validation",
    );
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onError("Streaming response has no body reader");
    return;
  }

  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split buffer on the SSE record separator (blank line).
      const records = buffer.split(/\r?\n\r?\n/);
      buffer = records.pop() ?? "";

      for (const record of records) {
        const evt = parseSSE(record);
        if (!evt) continue;
        if (evt.type === "step") {
          onStep(evt.key, evt.status, evt.ms, evt.detail);
        } else if (evt.type === "result") {
          onResult(evt.topPrompts);
        } else if (evt.type === "error") {
          onError(`${evt.source}: ${evt.message}`, evt.source);
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError((err as Error).message);
  }
}

function parseSSE(record: string):
  | { type: "step"; key: SimulatorStepKey; status: SimulatorStepStatus; ms?: number; detail?: string }
  | { type: "result"; topPrompts: ScoredPrompt[] }
  | { type: "error"; source: string; message: string }
  | null {
  const lines = record.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");
  try {
    const parsed = JSON.parse(data);
    if (event === "step") return { type: "step", ...parsed };
    if (event === "result") return { type: "result", ...parsed };
    if (event === "error") return { type: "error", ...parsed };
  } catch {
    return null;
  }
  return null;
}
