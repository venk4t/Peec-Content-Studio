import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import {
  PROJECT_COOKIE_NAME,
  isValidProjectId,
  projectFilename,
} from "@/lib/peec-project-cookie";
import { setCurrentProject, getOwnBrandName } from "@/lib/peec";

export interface ResolvedProject {
  projectId: string | null;
  projectName: string;
  /** True when we're using the static fallback snapshot, false for live data. */
  isFallback: boolean;
}

/**
 * Per-request resolver for which Peec project the server should hand back to
 * lib/peec accessors. Reads the cookie, verifies on-disk data exists, calls
 * `setCurrentProject` so subsequent sync accessors see the right project.
 *
 * Behavior:
 *   • cookie set + file exists                  → pin project, return its name
 *   • USE_FALLBACK_SNAPSHOT="true"              → pin null, accessors fall back
 *   • otherwise                                 → redirect("/setup")
 *
 * Call once at the top of any server page that uses peec accessors.
 */
export async function ensureProjectSelected(): Promise<ResolvedProject> {
  const store = await cookies();
  const value = store.get(PROJECT_COOKIE_NAME)?.value;

  if (isValidProjectId(value)) {
    const filePath = path.join(
      process.cwd(),
      "data",
      projectFilename(value),
    );
    if (fs.existsSync(filePath)) {
      setCurrentProject(value);
      let projectName = "";
      try {
        projectName = getOwnBrandName(value);
      } catch {
        projectName = "Project";
      }
      return { projectId: value, projectName, isFallback: false };
    }
  }

  if (process.env.USE_FALLBACK_SNAPSHOT === "true") {
    setCurrentProject(null);
    let projectName = "Demo project";
    try {
      projectName = getOwnBrandName();
    } catch {
      /* keep default */
    }
    return { projectId: null, projectName, isFallback: true };
  }

  redirect("/setup");
}
