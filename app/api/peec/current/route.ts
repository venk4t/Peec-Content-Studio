import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  PROJECT_COOKIE_NAME,
  isValidProjectId,
  projectFilename,
} from "@/lib/peec-project-cookie";
import fs from "node:fs";
import path from "node:path";

/**
 * GET /api/peec/current
 *   → 200 { projectId, hasData }   when a valid project cookie is set
 *   → 200 { projectId: null, hasData: false }   when not selected
 *
 * `hasData` reflects whether the on-disk JSON snapshot exists, so the
 * onboarding UI can decide between "redirect to dashboard" vs
 * "redirect to fetch flow".
 */
export async function GET() {
  const store = await cookies();
  const raw = store.get(PROJECT_COOKIE_NAME)?.value;
  if (!isValidProjectId(raw)) {
    return NextResponse.json({ projectId: null, hasData: false });
  }
  const filePath = path.join(process.cwd(), "data", projectFilename(raw));
  return NextResponse.json({
    projectId: raw,
    hasData: fs.existsSync(filePath),
  });
}

/**
 * POST /api/peec/current  body: { projectId: string }
 *   Sets the server-side cookie. Used after a successful fetch in /setup
 *   so subsequent server-rendered pages can pick it up.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const projectId = (body as { projectId?: unknown })?.projectId;
  if (!isValidProjectId(projectId)) {
    return NextResponse.json(
      { error: "projectId must match or_xxxxxxxx-...-xxxxxxxxxxxx" },
      { status: 400 },
    );
  }
  const store = await cookies();
  store.set(PROJECT_COOKIE_NAME, projectId, {
    httpOnly: false, // client-side hydration also needs to read it
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  return NextResponse.json({ projectId });
}

/**
 * DELETE /api/peec/current — clears the cookie (used by "Switch project").
 */
export async function DELETE() {
  const store = await cookies();
  store.delete(PROJECT_COOKIE_NAME);
  return NextResponse.json({ projectId: null });
}
