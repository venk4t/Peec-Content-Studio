import { spawnSync } from "node:child_process";

/**
 * Cross-platform Python 3 executable resolver.
 *
 * Background:
 *   On macOS/Linux the canonical Python 3 binary is `python3`. On Windows the
 *   binary is typically `python.exe` (or `py.exe -3`); `python3.exe` only
 *   exists if Python was installed via the Microsoft Store. Hard-coding
 *   `python3` makes the Peec OAuth + fetch routes fail with ENOENT on a
 *   fresh Windows clone, which would dead-end the /setup flow.
 *
 * Resolution order:
 *   1. `PYTHON_BIN` env var (parsed as `cmd [arg...]`) — explicit override.
 *   2. Probe candidates with `--version` and pick the first that exits 0.
 *      On Windows: python → py -3 → python3.
 *      On POSIX:   python3 → python.
 *   3. Throws if none work — caller surfaces the message verbatim to the UI.
 *
 * The result is memoised so we only probe once per server process.
 */

export interface PythonBin {
  /** Executable name or absolute path. */
  cmd: string;
  /** Leading args to prepend before the user's script path. */
  args: string[];
}

let cached: PythonBin | null = null;

function probe(cmd: string, args: readonly string[]): boolean {
  try {
    const res = spawnSync(cmd, [...args, "--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 5_000,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/** Parse `PYTHON_BIN="py -3"` style overrides into {cmd, args}. */
function parseOverride(raw: string): PythonBin | null {
  const parts = raw.trim().split(/\s+/);
  if (!parts[0]) return null;
  return { cmd: parts[0], args: parts.slice(1) };
}

export function getPythonBin(): PythonBin {
  if (cached) return cached;

  const override = process.env.PYTHON_BIN;
  if (override) {
    const parsed = parseOverride(override);
    if (parsed) {
      cached = parsed;
      return cached;
    }
  }

  const candidates: PythonBin[] =
    process.platform === "win32"
      ? [
          { cmd: "python", args: [] },
          { cmd: "py", args: ["-3"] },
          { cmd: "python3", args: [] },
        ]
      : [
          { cmd: "python3", args: [] },
          { cmd: "python", args: [] },
        ];

  for (const candidate of candidates) {
    if (probe(candidate.cmd, candidate.args)) {
      cached = candidate;
      return cached;
    }
  }

  const tried = candidates.map((c) => describePythonBin(c)).join(", ");
  throw new Error(
    `No working Python 3 interpreter found. Tried: ${tried}. ` +
      `Install Python 3.10+ or set the PYTHON_BIN env var ` +
      `(e.g. PYTHON_BIN="/usr/bin/python3.11" or PYTHON_BIN="py -3").`,
  );
}

/** Human-readable rendering — used in error messages and logs. */
export function describePythonBin(py: PythonBin): string {
  return py.args.length > 0 ? `${py.cmd} ${py.args.join(" ")}` : py.cmd;
}

/** Test-only: drop the cache so a different PYTHON_BIN can be picked up. */
export function _resetPythonBinCache(): void {
  cached = null;
}
