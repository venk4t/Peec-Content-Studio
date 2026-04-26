"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PeecProject {
  id: string;
  name: string;
  status?: string;
}

type StepKey = "auth" | "brands" | "metrics" | "save";
type StepStatus = "pending" | "running" | "complete" | "error";

interface StepInfo {
  key: StepKey;
  label: string;
}

const STEPS: StepInfo[] = [
  { key: "auth", label: "Authenticating with Peec…" },
  { key: "brands", label: "Fetching brand data…" },
  { key: "metrics", label: "Fetching prompts and metrics…" },
  { key: "save", label: "Saving locally…" },
];

/** Map each backend fetch phase key onto one of the 4 UI step keys. */
const BACKEND_TO_UI: Record<string, StepKey> = {
  projectProfile: "brands",
  brands: "brands",
  topics: "metrics",
  tags: "metrics",
  prompts: "metrics",
  brandReportOverall: "metrics",
  brandReportByModel: "metrics",
  shareOfVoice: "metrics",
  topPromptsBrandCited: "metrics",
  urlReports: "metrics",
  sentimentData: "metrics",
  actions: "metrics",
  historicalTrends: "save",
};

type Phase = "picker" | "fetching" | "done" | "error";

export function SetupClient() {
  const router = useRouter();

  const [projects, setProjects] = useState<PeecProject[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");

  const [phase, setPhase] = useState<Phase>("picker");
  const [steps, setSteps] = useState<Record<StepKey, StepStatus>>({
    auth: "pending",
    brands: "pending",
    metrics: "pending",
    save: "pending",
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── load project list ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/peec/projects")
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((d: { projects: PeecProject[] }) => {
        if (cancelled) return;
        setProjects(d.projects);
        if (d.projects.length > 0 && !selected) {
          setSelected(d.projects[0].id);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setProjectsError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── start fetch flow ─────────────────────────────────────────────────
  const start = () => {
    if (!selected) return;
    setPhase("fetching");
    setErrorMessage(null);
    setSteps({
      auth: "running",
      brands: "pending",
      metrics: "pending",
      save: "pending",
    });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    streamFetch(selected, ctrl.signal, {
      onPhase: (key, status, _detail) => {
        const ui = BACKEND_TO_UI[key];
        if (!ui) return;
        setSteps((prev) => {
          const next = { ...prev };
          // Auth completes when the first backend phase starts.
          if (next.auth !== "complete") next.auth = "complete";
          if (status === "running") {
            // Mark all earlier UI groups complete (they passed already).
            const stepOrder: StepKey[] = ["auth", "brands", "metrics", "save"];
            const idx = stepOrder.indexOf(ui);
            for (let i = 1; i < idx; i++) next[stepOrder[i]] = "complete";
            next[ui] = "running";
          } else if (status === "complete") {
            next[ui] = "running"; // stays running until the final phase in the group lands
          } else if (status === "error") {
            next[ui] = "error";
          }
          return next;
        });
      },
      onResult: async ({ projectId }) => {
        setSteps({
          auth: "complete",
          brands: "complete",
          metrics: "complete",
          save: "complete",
        });
        // Persist the cookie so the dashboard SSR can read it.
        try {
          await fetch("/api/peec/current", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
          });
        } catch {
          /* ignore — even without cookie the user can still access /setup */
        }
        setPhase("done");
        setTimeout(() => router.replace("/"), 600);
      },
      onError: (msg) => {
        setSteps((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next) as StepKey[]) {
            if (next[k] === "running") next[k] = "error";
          }
          return next;
        });
        setErrorMessage(msg);
        setPhase("error");
      },
    });
  };

  const retry = () => {
    if (abortRef.current) abortRef.current.abort();
    setErrorMessage(null);
    setPhase("picker");
  };

  // ── render ───────────────────────────────────────────────────────────
  const selectedName = useMemo(
    () => projects?.find((p) => p.id === selected)?.name ?? "",
    [projects, selected],
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6 py-10">
      <div className="w-full max-w-[440px] bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-7 pt-7 pb-2">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-md bg-emerald-50 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Peec Content Studio
            </span>
          </div>
          <h1 className="text-[20px] font-semibold text-gray-900 tracking-tight leading-tight">
            Connect to Peec to begin
          </h1>
          <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
            Pick a Peec project to power your Content Studio. We&rsquo;ll fetch
            your real GEO data — this takes about a minute.
          </p>
        </div>

        <div className="px-7 py-5">
          {phase === "picker" && (
            <Picker
              projects={projects}
              error={projectsError}
              selected={selected}
              onSelect={setSelected}
              onSubmit={start}
            />
          )}

          {(phase === "fetching" ||
            phase === "done" ||
            phase === "error") && (
            <Progress
              steps={steps}
              selectedName={selectedName}
              error={errorMessage}
              done={phase === "done"}
              onRetry={retry}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Picker
// ─────────────────────────────────────────────────────────────────────────

function Picker({
  projects,
  error,
  selected,
  onSelect,
  onSubmit,
}: {
  projects: PeecProject[] | null;
  error: string | null;
  selected: string;
  onSelect: (id: string) => void;
  onSubmit: () => void;
}) {
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 flex gap-2">
        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
        <div className="text-[12px] text-red-800 leading-relaxed min-w-0">
          <p className="font-medium">Couldn&rsquo;t list projects</p>
          <p className="mt-1 text-red-700 break-words">{error}</p>
        </div>
      </div>
    );
  }

  if (!projects) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-gray-500 py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading your projects…
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="text-[13px] text-gray-700 leading-relaxed">
        No projects found in your Peec account.
      </div>
    );
  }

  return (
    <>
      <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500 mb-1.5">
        Project
      </label>
      <div className="relative mb-4">
        <select
          value={selected}
          onChange={(e) => onSelect(e.target.value)}
          className="w-full h-10 pl-3 pr-9 rounded-md border border-gray-200 bg-white text-[13px] text-gray-900 appearance-none focus:outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
      <button
        onClick={onSubmit}
        type="button"
        disabled={!selected}
        className={cn(
          "w-full h-10 rounded-md text-[13px] font-medium transition-colors",
          selected
            ? "bg-gray-900 text-white hover:bg-gray-800"
            : "bg-gray-100 text-gray-400 cursor-not-allowed",
        )}
      >
        Fetch data
      </button>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Progress
// ─────────────────────────────────────────────────────────────────────────

function Progress({
  steps,
  selectedName,
  error,
  done,
  onRetry,
}: {
  steps: Record<StepKey, StepStatus>;
  selectedName: string;
  error: string | null;
  done: boolean;
  onRetry: () => void;
}) {
  return (
    <>
      {selectedName && (
        <p className="text-[11px] text-gray-500 mb-3">
          Project: <span className="text-gray-900">{selectedName}</span>
        </p>
      )}
      <ol className="space-y-2.5">
        {STEPS.map((s, i) => (
          <StepRow key={s.key} index={i + 1} label={s.label} status={steps[s.key]} />
        ))}
      </ol>

      {done && (
        <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50/50 p-3 text-[12px] text-emerald-900">
          ✓ Done. Loading your dashboard…
        </div>
      )}

      {error && (
        <>
          <div className="mt-5 rounded-md border border-red-200 bg-red-50 p-3 flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-[12px] text-red-800 leading-relaxed min-w-0">
              <p className="font-medium">Fetch failed</p>
              <p className="mt-1 text-red-700 break-words">{error}</p>
            </div>
          </div>
          <button
            onClick={onRetry}
            className="mt-3 w-full h-9 rounded-md text-[12.5px] font-medium border border-gray-200 hover:bg-gray-50 transition-colors text-gray-700"
          >
            Try again
          </button>
        </>
      )}
    </>
  );
}

function StepRow({
  index,
  label,
  status,
}: {
  index: number;
  label: string;
  status: StepStatus;
}) {
  return (
    <li className="flex items-center gap-3">
      <StatusIcon status={status} index={index} />
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
    </li>
  );
}

function StatusIcon({
  status,
  index,
}: {
  status: StepStatus;
  index: number;
}) {
  const base =
    "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium shrink-0";
  if (status === "pending")
    return <div className={cn(base, "bg-gray-100 text-gray-400")}>{index}</div>;
  if (status === "running")
    return (
      <div className={cn(base, "bg-emerald-50 text-emerald-700")}>
        <Loader2 className="w-3 h-3 animate-spin" />
      </div>
    );
  if (status === "complete")
    return (
      <div className={cn(base, "bg-emerald-500 text-white")}>
        <Check className="w-3 h-3" />
      </div>
    );
  return (
    <div className={cn(base, "bg-red-500 text-white")}>
      <AlertCircle className="w-3 h-3" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SSE consumer
// ─────────────────────────────────────────────────────────────────────────

interface PhaseEvent {
  key: string;
  status: "running" | "complete" | "error";
  ms?: number;
  detail?: string;
}

interface ResultEvent {
  projectId: string;
  outputPath: string;
  totalMs: number;
}

async function streamFetch(
  projectId: string,
  signal: AbortSignal,
  cb: {
    onPhase: (key: string, status: PhaseEvent["status"], detail?: string) => void;
    onResult: (r: ResultEvent) => void;
    onError: (message: string) => void;
  },
) {
  let res: Response;
  try {
    res = await fetch("/api/peec/fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ projectId }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    cb.onError((err as Error).message);
    return;
  }

  if (!res.ok || !res.headers.get("content-type")?.includes("text/event-stream")) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    cb.onError(
      `Fetch endpoint returned ${res.status} ${res.statusText}` +
        (body ? ` — ${body.slice(0, 240)}` : ""),
    );
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    cb.onError("Response had no body reader");
    return;
  }

  const decoder = new TextDecoder("utf-8");
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const records = buf.split(/\r?\n\r?\n/);
      buf = records.pop() ?? "";
      for (const rec of records) {
        const evt = parseSSE(rec);
        if (!evt) continue;
        if (evt.event === "phase") {
          const data = evt.data as { key?: string; status?: PhaseEvent["status"]; detail?: string };
          if (data.key && data.status) cb.onPhase(data.key, data.status, data.detail);
        } else if (evt.event === "result") {
          cb.onResult(evt.data as ResultEvent);
        } else if (evt.event === "error") {
          const data = evt.data as { source?: string; message?: string };
          cb.onError(`${data.source ?? "error"}: ${data.message ?? "(unknown)"}`);
          return;
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    cb.onError((err as Error).message);
  }
}

function parseSSE(record: string): { event: string; data: unknown } | null {
  const lines = record.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}
