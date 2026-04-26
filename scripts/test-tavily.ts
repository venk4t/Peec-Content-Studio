import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local") });

const apiKey = process.env.TAVILY_API_KEY;
if (!apiKey) {
  console.error("Missing TAVILY_API_KEY in .env.local");
  process.exit(1);
}

const QUERY = "Nothing Phone reviews 2026";

async function main() {
  console.log(`Calling Tavily search: "${QUERY}" (max_results=3)...\n`);

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: QUERY,
      max_results: 3,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`✗ HTTP ${res.status} ${res.statusText}`);
    console.error(text);
    process.exit(2);
  }

  let body: { results?: Array<{ title: string; url: string; content: string }> };
  try {
    body = JSON.parse(text);
  } catch {
    console.error("✗ Response was not JSON. Raw body:\n" + text);
    process.exit(3);
  }

  const results = body.results ?? [];
  console.log(`✓ Got ${results.length} result(s):\n`);

  for (const [i, r] of results.entries()) {
    console.log(`──────── #${i + 1} ────────`);
    console.log(`title:   ${r.title}`);
    console.log(`url:     ${r.url}`);
    const snippet = (r.content ?? "").replace(/\s+/g, " ").slice(0, 240);
    console.log(`snippet: ${snippet}${r.content && r.content.length > 240 ? "…" : ""}`);
    console.log("");
  }

  process.exit(results.length > 0 ? 0 : 4);
}

main().catch((err) => {
  console.error("✗ Unexpected error:");
  console.error(err);
  process.exit(99);
});
