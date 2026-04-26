"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RefreshFromPeecButtonProps {
  /** When null, refresh is disabled (we're on the static fallback). */
  projectId: string | null;
}

type State = "idle" | "running" | "done" | "error";

export function RefreshFromPeecButton({ projectId }: RefreshFromPeecButtonProps) {
  const router = useRouter();
  const [state, setState] = useState<State>("idle");
  const [phaseText, setPhaseText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const disabled = !projectId || state === "running";

  const start = async () => {
    if (!projectId) return;
    setState("running");
    setPhaseText("starting…");
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let res: Response;
    try {
      res = await fetch("/api/peec/fetch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ projectId }),
        signal: ctrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setState("error");
      return;
    }

    if (
      !res.ok ||
      !res.headers.get("content-type")?.includes("text/event-stream")
    ) {
      const body = await res.text().catch(() => "");
      setError(
        `${res.status} ${res.statusText}` +
          (body ? ` — ${body.slice(0, 240)}` : ""),
      );
      setState("error");
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setError("Streaming response had no body reader");
      setState("error");
      return;
    }

    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let phaseIdx = 0;
    const totalPhases = 13;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const recs = buf.split(/\r?\n\r?\n/);
        buf = recs.pop() ?? "";
        for (const rec of recs) {
          const evt = parseSSE(rec);
          if (!evt) continue;
          if (evt.event === "phase") {
            const data = evt.data as { key?: string; status?: string };
            if (data.status === "complete" && data.key) {
              phaseIdx += 1;
              setPhaseText(`${data.key} · ${phaseIdx}/${totalPhases}`);
            } else if (data.status === "running" && data.key) {
              setPhaseText(`${data.key}…`);
            }
          } else if (evt.event === "result") {
            setState("done");
            setPhaseText("done");
            // Reload server-rendered data with the freshly written JSON.
            router.refresh();
            // Reset to idle after a beat.
            setTimeout(() => {
              setState("idle");
              setPhaseText("");
            }, 1800);
            return;
          } else if (evt.event === "error") {
            const data = evt.data as { source?: string; message?: string };
            setError(`${data.source ?? "error"}: ${data.message ?? "(unknown)"}`);
            setState("error");
            return;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setState("error");
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={start}
        disabled={disabled}
        title={
          !projectId
            ? "Select a real project to refresh — currently using demo data"
            : "Re-fetch live data from Peec"
        }
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[12px] transition-colors",
          state === "done"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : state === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : disabled
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
        )}
      >
        {state === "running" ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : state === "done" ? (
          <Check className="w-3.5 h-3.5" />
        ) : state === "error" ? (
          <AlertCircle className="w-3.5 h-3.5" />
        ) : (
          <RefreshCcw className="w-3.5 h-3.5" />
        )}
        <span>
          {state === "running"
            ? "Refreshing"
            : state === "done"
              ? "Refreshed"
              : state === "error"
                ? "Refresh failed"
                : "Refresh from Peec"}
        </span>
        {state === "running" && phaseText && (
          <span className="text-[10px] text-gray-500 tabular-nums ml-1">
            {phaseText}
          </span>
        )}
      </button>
      {error && state === "error" && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-[320px] rounded-md border border-red-200 bg-white p-3 shadow-md">
          <div className="flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <div className="text-[12px] text-red-800 leading-relaxed min-w-0">
              <p className="font-medium">Refresh failed</p>
              <p className="mt-1 text-red-700 break-words">{error}</p>
            </div>
          </div>
          <button
            onClick={() => {
              setError(null);
              setState("idle");
            }}
            className="mt-2 text-[11px] text-gray-600 hover:text-gray-900"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
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
