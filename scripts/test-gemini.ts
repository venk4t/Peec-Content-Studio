import { config } from "dotenv";
import { resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";

config({ path: resolve(process.cwd(), ".env.local") });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY in .env.local");
  process.exit(1);
}

const PROMPT =
  'Return ONLY valid JSON matching {layman: string, technicalWhy: string} for one suggestion about a smartphone article.';

async function main() {
  const ai = new GoogleGenAI({ apiKey: apiKey! });

  console.log("Calling gemini-2.5-flash with strict-JSON prompt...\n");

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: PROMPT,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          layman: { type: "string" },
          technicalWhy: { type: "string" },
        },
        required: ["layman", "technicalWhy"],
      },
    },
  });

  const raw = res.text ?? "";
  console.log("--- raw response ---");
  console.log(raw);
  console.log("--- end raw ---\n");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("✗ JSON.parse failed:", (err as Error).message);
    process.exit(2);
  }

  console.log("✓ Parsed JSON:");
  console.log(JSON.stringify(parsed, null, 2));

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).layman !== "string" ||
    typeof (parsed as Record<string, unknown>).technicalWhy !== "string"
  ) {
    console.error(
      "\n✗ Shape mismatch: expected { layman: string, technicalWhy: string }",
    );
    process.exit(3);
  }
  console.log("\n✓ Shape matches { layman, technicalWhy }.");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Unexpected error:");
  console.error(err);
  process.exit(99);
});
