import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import fs from "node:fs";
import path from "node:path";
import {
  PROJECT_COOKIE_NAME,
  isValidProjectId,
  projectFilename,
} from "@/lib/peec-project-cookie";
import { SetupClient } from "./SetupClient";

/**
 * Onboarding entry point. If a project is already selected AND its data
 * exists on disk, send the user straight into the dashboard. Otherwise
 * render the picker + fetch flow.
 */
export default async function SetupPage() {
  const store = await cookies();
  const cookieValue = store.get(PROJECT_COOKIE_NAME)?.value;

  if (isValidProjectId(cookieValue)) {
    const filePath = path.join(
      process.cwd(),
      "data",
      projectFilename(cookieValue),
    );
    if (fs.existsSync(filePath)) {
      redirect("/");
    }
  }

  return <SetupClient />;
}
