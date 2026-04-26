import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import {
  isValidProjectId,
  projectFilename,
} from "@/lib/peec-project-cookie";
import { clearProjectCache } from "@/lib/peec";

export const maxDuration = 90; // Vercel runtime cap (seconds)

const SCRIPT_REL = path.join("vendor", "peec_full_fetch.py");
const TIMEOUT_MS = 80_000; // < maxDuration so we can emit a clean error event

const RequestSchema = z.object({
  projectId: z.string().refine(isValidProjectId, {
    message: "Invalid Peec project id",
  }),
});

type SsePayload =
  | { type: "phase"; key: string; status: "running" | "complete" | "error"; ms?: number; detail?: string }
  | { type: "log"; line: string }
  | { type: "result"; projectId: string; outputPath: string; totalMs: number }
  | { type: "error"; source: string; message: string };

/**
 * POST /api/peec/fetch  body: { projectId: string }
 *
 * Spawns `python3 vendor/peec_full_fetch.py --project-id <id> --output …`
 * and streams its stderr line-by-line as SSE so the onboarding UI can
 * render real-time progress.
 *
 * Wire format:
 *   event: phase   data: {key, status, ms?, detail?}
 *   event: log     data: {line}                        (anything not phase-shaped)
 *   event: result  data: {projectId, outputPath, totalMs}
 *   event: error   data: {source, message}             (terminal; closes stream)
 */
export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return jsonError("validation", "Body must be valid JSON", 400);
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(
      "validation",
      `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      400,
    );
  }

  const { projectId } = parsed.data;
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, SCRIPT_REL);
  const outputAbs = path.join(cwd, "data", projectFilename(projectId));
  const outputRel = path.join("data", projectFilename(projectId));

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: SsePayload) => {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      const t0 = Date.now();
      console.log(`[peec-fetch] ▶ projectId=${projectId} → ${outputRel}`);

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(
          "python3",
          [
            scriptPath,
            "--project-id",
            projectId,
            "--output",
            outputAbs,
          ],
          {
            cwd,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      } catch (err) {
        send("error", {
          type: "error",
          source: "spawn",
          message: `Failed to spawn python3: ${(err as Error).message}`,
        });
        controller.close();
        return;
      }

      let stderrBuf = "";
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const timer = setTimeout(() => {
        if (closed) return;
        try {
          proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        send("error", {
          type: "error",
          source: "timeout",
          message: `Fetch exceeded ${TIMEOUT_MS}ms; aborting.`,
        });
        close();
      }, TIMEOUT_MS);

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split(/\r?\n/);
        // Keep the last (possibly partial) line in the buffer.
        stderrBuf = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const evt = parseFetchLine(raw);
          if (evt) {
            send(evt.type, evt);
          } else {
            // Forward verbatim so debugging is straightforward.
            send("log", { type: "log", line: raw });
          }
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        send("error", {
          type: "error",
          source: "spawn",
          message: `python3 failed to start: ${err.message}`,
        });
        close();
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        // Drain any remaining buffered stderr line.
        if (stderrBuf.trim()) {
          const evt = parseFetchLine(stderrBuf);
          if (evt) send(evt.type, evt);
          else send("log", { type: "log", line: stderrBuf });
          stderrBuf = "";
        }
        const totalMs = Date.now() - t0;
        if (code === 0) {
          console.log(
            `[peec-fetch] ✓ projectId=${projectId} totalMs=${totalMs}`,
          );
          // Invalidate any cached snapshot for this project so the next read
          // picks up the freshly-written JSON.
          try {
            clearProjectCache(projectId);
          } catch {
            /* lib not yet loaded — fine */
          }
          send("result", {
            type: "result",
            projectId,
            outputPath: outputRel,
            totalMs,
          });
        } else {
          console.error(
            `[peec-fetch] ✗ projectId=${projectId} exit=${code}`,
          );
          send("error", {
            type: "error",
            source: "python",
            message: `peec_full_fetch.py exited with code ${code}`,
          });
        }
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Parse a single stderr line from peec_full_fetch.py into a structured event.
 * Returns null when the line doesn't match a known phase format.
 *
 * Supported shapes:
 *   [fetch] phase=<key> status=running
 *   [fetch] phase=<key> status=complete  ms=<n>  detail=<free>
 *   [fetch] phase=<key> status=error     ms=<n>  detail=<free>
 *   [fetch] DONE  total_ms=<n>  output=<path>
 *   [fetch] FAIL  [<section>] <message>
 */
function parseFetchLine(line: string): SsePayload | null {
  const trimmed = line.trim();

  // Phase line.
  const m = /^\[fetch\]\s+phase=(\S+)\s+status=(running|complete|error)(.*)$/.exec(trimmed);
  if (m) {
    const [, key, status, rest] = m;
    const result: SsePayload = { type: "phase", key, status: status as never };
    const msMatch = /\bms=(\d+)/.exec(rest);
    if (msMatch) result.ms = Number(msMatch[1]);
    const detailMatch = /\bdetail=(.+)$/.exec(rest);
    if (detailMatch) result.detail = detailMatch[1].trim();
    return result;
  }

  // FAIL line.
  const failMatch = /^\[fetch\]\s+FAIL\s+(.+)$/.exec(trimmed);
  if (failMatch) {
    return {
      type: "error",
      source: "python",
      message: failMatch[1],
    };
  }

  // DONE / START / other [fetch] lines — surface as log so the UI can show context.
  if (trimmed.startsWith("[fetch]")) {
    return { type: "log", line: trimmed };
  }

  return null;
}

function jsonError(source: string, message: string, status: number) {
  return new Response(JSON.stringify({ source, error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
