import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const apiKey = process.env.PIONEER_API_KEY;
const modelId = process.env.PIONEER_MODEL_ID;

if (!apiKey || !modelId) {
  console.error("Missing PIONEER_API_KEY or PIONEER_MODEL_ID in .env.local");
  process.exit(1);
}

const TEXT =
  "Apple's iPhone 15 competes with Samsung Galaxy and Nothing Phone 2 in the premium smartphone market.";
const LABELS = ["BRAND", "PRODUCT"];

async function main() {
  console.log(`POST https://api.pioneer.ai/inference`);
  console.log(`  model_id: ${modelId}`);
  console.log(`  task:     extract_entities`);
  console.log(`  labels:   ${JSON.stringify(LABELS)}`);
  console.log(`  text:     ${TEXT}\n`);

  const res = await fetch("https://api.pioneer.ai/inference", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey!,
    },
    body: JSON.stringify({
      task: "extract_entities",
      model_id: modelId,
      text: TEXT,
      schema: LABELS,
      include_confidence: true,
      include_spans: true,
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status} ${res.statusText}`);
    console.error(raw);
    process.exit(2);
  }

  let body: {
    result?: unknown;
    model_used?: string;
    latency_ms?: number;
    token_usage?: number;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    console.error("✗ Response was not JSON. Raw body:\n" + raw);
    process.exit(3);
  }

  console.log(`✓ HTTP 200 — model_used=${body.model_used}, latency=${body.latency_ms}ms, tokens=${body.token_usage}`);
  console.log("\n--- raw result payload ---");
  console.log(JSON.stringify(body.result, null, 2));
  console.log("--- end ---");

  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Unexpected error:");
  console.error(err);
  process.exit(99);
});
