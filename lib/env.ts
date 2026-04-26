import { z } from "zod";

const EnvSchema = z.object({
  // Legacy direct-MCP env vars — kept optional because the new dynamic loader
  // uses OAuth tokens cached on disk by vendor/peec_mcp_auth.py (DCR + PKCE).
  // The TypeScript app no longer reads these; left here for backward compat
  // and for any future static-token codepath.
  PEEC_MCP_URL: z
    .string()
    .url("PEEC_MCP_URL must be a valid URL")
    .optional(),
  PEEC_MCP_TOKEN: z.string().min(1).optional(),

  // External API integrations (required at runtime).
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  TAVILY_API_KEY: z.string().min(1, "TAVILY_API_KEY is required"),
  PIONEER_API_KEY: z.string().min(1, "PIONEER_API_KEY is required"),
  PIONEER_MODEL_ID: z.string().min(1, "PIONEER_MODEL_ID is required"),

  // Dynamic project data loader: when set to "true", lib/peec.ts falls back
  // to the static data/peec-snapshot.ts when no live JSON exists for the
  // selected project. Useful for offline demos. Default: false.
  USE_FALLBACK_SNAPSHOT: z
    .union([z.literal("true"), z.literal("false")])
    .optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid or missing environment variables:\n${issues}\n\nCopy .env.example to .env.local and fill in real values.`,
    );
  }
  cached = parsed.data;
  return cached;
}
