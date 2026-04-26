import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describePythonBin, getPythonBin } from "@/lib/python-bin";

const SCRIPT_REL = path.join("vendor", "list_projects.py");
const TIMEOUT_MS = 30_000;

/** Resolve to .venv python if available, else fall back to system python3. */
function resolvePython(): string {
  const venv = path.join(process.cwd(), ".venv", "bin", "python3");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

interface PeecProject {
  id: string;
  name: string;
  status?: string;
}

/**
 * GET /api/peec/projects
 *   Spawns `<python> vendor/list_projects.py`, captures stdout JSON.
 *   → 200 { projects: PeecProject[] }
 *   → 500 { error: string }   (with the python stderr verbatim)
 *
 * The Python interpreter is resolved cross-platform via `getPythonBin()`
 * (honors PYTHON_BIN, falls back to python3 → python → py -3 on Windows).
 */
export async function GET() {
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, SCRIPT_REL);

  let py;
  try {
    py = getPythonBin();
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
  const pyDesc = describePythonBin(py);

  let stdout = "";
  let stderr = "";

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(resolvePython(), [scriptPath], {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        reject(
          new Error(
            `list_projects.py exceeded ${TIMEOUT_MS}ms — likely stuck on OAuth login. ` +
              `Run \`${pyDesc} ${SCRIPT_REL}\` from the project root to complete browser auth.`,
          ),
        );
      }, TIMEOUT_MS);

      proc.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn ${pyDesc}: ${err.message}`));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(
            new Error(
              `list_projects.py exited with code ${code}. stderr:\n${stderr.trim() || "(empty)"}`,
            ),
          );
          return;
        }
        resolve();
      });
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }

  let projects: PeecProject[];
  try {
    projects = JSON.parse(stdout) as PeecProject[];
  } catch {
    return NextResponse.json(
      {
        error: `list_projects.py returned non-JSON. stdout:\n${stdout.slice(0, 600)}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ projects });
}
