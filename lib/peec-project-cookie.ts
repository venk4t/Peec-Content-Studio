/**
 * Shared helpers for reading/writing the selected Peec project id.
 * Cookie name + format are kept in one place so /api/peec/* and any
 * server-side layout code agree.
 */

export const PROJECT_COOKIE_NAME = "peec_project_id";

/** Peec project ids look like `or_faaa7625-bc84-4f64-a754-a412d423c641`. */
const PROJECT_ID_RE = /^or_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Strict validation — also defends path-joining against traversal. */
export function isValidProjectId(id: unknown): id is string {
  return typeof id === "string" && PROJECT_ID_RE.test(id);
}

export function projectFilename(projectId: string): string {
  return `peec-live-${projectId}.json`;
}
