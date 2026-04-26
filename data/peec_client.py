"""Peec MCP client + Gemini URL-content enrichment.

Replaces the previous REST workflow. Brand/prompt/URL/action data all comes
straight from the Peec MCP server (``peec-mcp`` at ``https://api.peec.ai/mcp``)
via ``peec_mcp_auth.MCPSession`` (DCR + PKCE, tokens cached on disk).

The public entry point ``fetch_peec_session(api_key, project_id, gemini_key)``
keeps the same signature as before so ``main.py`` doesn't need to change.

Standalone use (writes ``backend/user.json``):

    python peec_client.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import date, timedelta
from typing import Any

import httpx

from peec_mcp_auth import CACHE_FILE as MCP_CACHE_FILE, MCPSession


def _has_cached_mcp_token() -> bool:
    """Cheap pre-flight: do we have an OAuth token already on disk? If not,
    instantiating MCPSession would open a browser — bad for unattended
    server startup, fine for standalone CLI use."""
    try:
        return bool(json.loads(MCP_CACHE_FILE.read_text()).get("access_token"))
    except Exception:
        return False

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-flash-latest:generateContent"
)

# Map MCP action group types to the frontend's ``Action.type`` enum.
ACTION_TYPE_MAP = {
    "OWNED":     "owned",
    "EDITORIAL": "editorial",
    "UGC":       "ugc",
    "REFERENCE": "reference",
}


def _date_range(days: int = 90) -> tuple[str, str]:
    end = date.today()
    start = end - timedelta(days=days)
    return start.isoformat(), end.isoformat()


def _rows_to_dicts(result: dict) -> list[dict]:
    """Turn the columnar ``{columns, rows}`` MCP response into a list of dicts."""
    sc = result.get("structuredContent", result) if isinstance(result, dict) else {}
    if not isinstance(sc, dict) or "rows" not in sc:
        return []
    cols = sc.get("columns", [])
    return [dict(zip(cols, row)) for row in sc.get("rows", [])]


def _structured(result: dict) -> dict:
    """Return ``structuredContent`` if present, else the result itself."""
    if not isinstance(result, dict):
        return {}
    return result.get("structuredContent") or result


# ---------------------------------------------------------------------------
# Gemini enrichment (URL content → LLM-citation-worthy excerpts)
# ---------------------------------------------------------------------------

async def _gemini_excerpt(
    client: httpx.AsyncClient, api_key: str, url: str, brand: str, raw: str,
) -> str:
    """Ask Gemini Flash for the 1-2 sentences an AI search engine would
    quote when answering about ``brand``. Falls back to a raw 600-char
    snippet on any failure."""
    if not raw or not api_key:
        return raw[:600]

    prompt = (
        f"Page scraped from {url}.\n"
        f"Extract the 1-2 sentences an AI search engine would most likely quote "
        f"when answering a question about {brand}. Return ONLY those sentences.\n\n"
        f"{raw[:3000]}"
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": 400, "temperature": 0.3},
    }
    delay = 4.0
    for attempt in range(4):
        r = await client.post(f"{GEMINI_URL}?key={api_key}", json=payload, timeout=30)
        if r.status_code == 429 and attempt < 3:
            await asyncio.sleep(delay)
            delay *= 2
            continue
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    r.raise_for_status()
    return ""


async def _enrich_url_content(
    client: httpx.AsyncClient,
    api_key: str,
    url: str,
    brand: str,
    raw_content: str,
) -> str:
    # Disabled Gemini enrichment as it is unused in the UI and adds latency
    return ""
    
    # if not raw_content or not api_key:
    #     return raw_content
    # prompt = (
    #     f"Page scraped from {url}.\n"
    #     f"Extract the 1-2 sentences an AI search engine would most likely quote when "
    #     f"answering a question about {brand}. Return ONLY those sentences, nothing else.\n\n"
    #     f"{raw_content[:3000]}"
    # )
    # try:
    #     excerpt = await _gemini_generate(client, api_key, prompt, max_tokens=400)
    #     # Gemini occasionally refuses on thin/garbage scrapes — keep the raw
    #     # content in those cases so downstream scoring still has signal.
    #     if not excerpt or len(excerpt) < 20 or excerpt.lower().startswith("i am sorry"):
    #         return raw_content[:600]
    #     return excerpt
    # except Exception as e:
    #     print(f"[Gemini] enrichment failed for {url}: {e}")
    #     return raw_content[:600]


async def _synthesize_actions(
    client: httpx.AsyncClient,
    api_key: str,
    brand: str,
    competitors: list[str],
    urls: list[dict],
) -> list[dict]:
    """Derive opportunity-scored actions from URL gap data via Gemini."""
    if not api_key or not urls:
        return []

    url_lines = []
    for u in urls[:8]:
        mentioned = u.get("mentioned_brands") or []
        url_lines.append(
            f"- {u.get('url')} "
            f"(type={u.get('classification') or 'OTHER'}, "
            f"cited={u.get('citation_count', 0)}x, "
            f"brands_mentioned={len(mentioned)})"
        )
    url_block = "\n".join(url_lines)
    comp_str = ", ".join(competitors[:5]) if competitors else "competitors"

    prompt = (
        f"You are a GEO (Generative Engine Optimization) strategist for {brand}.\n"
        f"{brand} competes against: {comp_str}.\n\n"
        f"Top URLs cited by AI engines in this market:\n{url_block}\n\n"
        f"Generate 3 opportunity-scored content actions. Each text must be a "
        f"concrete recommendation under 120 characters."
    )
    schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id":                {"type": "string"},
                "text":              {"type": "string"},
                "type":              {"type": "string", "enum": ["owned", "editorial"]},
                "opportunity_score": {"type": "integer"},
            },
            "required": ["id", "text", "type", "opportunity_score"],
        },
    }
    try:
        raw = await _gemini_generate(
            client, api_key, prompt, max_tokens=2000, response_schema=schema,
        )
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception as e:
        print(f"[Gemini] action synthesis failed: {e}")
        return []


# ---------------------------------------------------------------------------
# Synchronous MCP fetch (called via asyncio.to_thread)
# ---------------------------------------------------------------------------

def _fetch_mcp_data(project_id: str) -> dict:
    """Blocking MCP fetch — every call goes through ``MCPSession``. Returns
    a raw dict with the data we need to assemble the session payload, plus
    the URL list to pass to Gemini for enrichment."""

    s = MCPSession()
    start, end = _date_range()

    # 1. Brands ---------------------------------------------------------------
    print("[mcp] list_brands")
    brands = _rows_to_dicts(
        s.call_tool("list_brands", {"project_id": project_id, "limit": 1000})
    )
    own = next((b for b in brands if b.get("is_own")), None)
    own_id   = own["id"]   if own else ""
    own_name = own["name"] if own else ""
    print(f"[mcp]   -> {len(brands)} brands (own: {own_name or 'none'})")

    # 2. Aggregated brand metrics --------------------------------------------
    print("[mcp] get_brand_report (aggregated)")
    brand_rows = _rows_to_dicts(s.call_tool("get_brand_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date":   end,
        "limit":      1000,
    }))
    metrics = {r["brand_id"]: r for r in brand_rows}
    print(f"[mcp]   -> {len(brand_rows)} brand metrics rows")

    session_brands: list[dict] = []
    for b in brands:
        m = metrics.get(b["id"], {})
        session_brands.append({
            "id":             b["id"],
            "name":           b["name"],
            "is_own":         bool(b.get("is_own")),
            "visibility":     m.get("visibility", 0.0) or 0.0,
            "sentiment":      int(m.get("sentiment") or 0),
            "share_of_voice": m.get("share_of_voice", 0.0) or 0.0,
        })

    own_vis = next((b["visibility"] for b in session_brands if b["is_own"]), 0.0)
    comp_vis = [b["visibility"] for b in session_brands if not b["is_own"] and b["visibility"]]
    comp_avg = sum(comp_vis) / len(comp_vis) if comp_vis else 0.0

    # 3. Top URLs (sorted by citation_count) ---------------------------------
    print("[mcp] get_url_report (citation_count desc)")
    url_rows = _rows_to_dicts(s.call_tool("get_url_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date":   end,
        "limit":      10,
        "order_by":   [{"field": "citation_count", "direction": "desc"}],
    }))
    print(f"[mcp]   -> {len(url_rows)} URLs")

    # 4. Prompts (id → text lookup) ------------------------------------------
    print("[mcp] list_prompts")
    prompts = _rows_to_dicts(
        s.call_tool("list_prompts", {"project_id": project_id, "limit": 1000})
    )
    prompt_index = {p["id"]: p for p in prompts}
    print(f"[mcp]   -> {len(prompts)} prompts")

    # 5. Per-prompt visibility for own brand → top phrases -------------------
    top_phrases: list[dict] = []
    if own_id:
        print("[mcp] get_brand_report by prompt_id (filter own)")
        per_prompt = _rows_to_dicts(s.call_tool("get_brand_report", {
            "project_id": project_id,
            "start_date": start,
            "end_date":   end,
            "limit":      1000,
            "dimensions": ["prompt_id"],
            "filters":    [{"field": "brand_id", "operator": "in", "values": [own_id]}],
        }))
        for r in per_prompt:
            pid = r.get("prompt_id")
            if isinstance(pid, dict):
                pid = pid.get("id")
            p = prompt_index.get(pid)
            if not p or not p.get("text"):
                continue
            top_phrases.append({
                "id":            pid,
                "text":          p["text"],
                "visibility":    r.get("visibility", 0.0) or 0.0,
                "mention_count": r.get("mention_count", 0) or 0,
            })
        top_phrases.sort(
            key=lambda x: (x["visibility"], x["mention_count"]),
            reverse=True,
        )
        top_phrases = top_phrases[:20]
    print(f"[mcp]   -> top_phrases: {len(top_phrases)}")

    # 6. URL contents (raw markdown — Gemini enrichment happens in the async
    #    wrapper below so multiple Gemini calls can fan out concurrently) ----
    raw_url_blocks: list[dict] = []
    for u in url_rows[:5]:
        url = u.get("url")
        if not url:
            continue
        print(f"[mcp] get_url_content {url[:60]}")
        try:
            res = s.call_tool("get_url_content", {
                "project_id": project_id,
                "url":        url,
                "max_length": 8000,
            })
        except Exception as e:
            print(f"[mcp]   -> failed: {e}")
            continue
        sc = _structured(res)
        raw_url_blocks.append({
            "url":            url,
            "citation_count": u.get("citation_count", 0),
            "classification": sc.get("url_classification") or u.get("classification") or "OTHER",
            "title":          sc.get("title") or u.get("title") or "",
            "content_raw":    (sc.get("content") or "")[:3000],
        })

    # 7. Real Peec actions (overview → drill-downs) --------------------------
    print("[mcp] get_actions overview")
    overview = _rows_to_dicts(
        s.call_tool("get_actions", {"scope": "overview", "project_id": project_id})
    )
    overview.sort(key=lambda r: r.get("opportunity_score", 0) or 0, reverse=True)
    print(f"[mcp]   -> {len(overview)} action groups")

    # Normalize the continuous group score (0..1, max in this project ~0.25)
    # to a 0..100 scale based on the project's own max so the top group
    # always shows ~99.
    max_group_score = max((g.get("opportunity_score") or 0) for g in overview) or 1.0

    actions: list[dict] = []
    for og in overview[:6]:
        agroup    = og.get("action_group_type", "OWNED")
        scope     = ACTION_TYPE_MAP.get(agroup, "owned")
        group_pct = int(((og.get("opportunity_score") or 0) / max_group_score) * 99)

        args: dict[str, Any] = {"scope": scope, "project_id": project_id}
        url_cls = og.get("url_classification")
        domain  = og.get("domain")
        if url_cls:
            args["url_classification"] = url_cls
        elif domain:
            args["domain"] = domain
        label = url_cls or domain or "?"
        try:
            print(f"[mcp] get_actions drill {scope}/{label}")
            drill_rows = _rows_to_dicts(s.call_tool("get_actions", args))
        except Exception as e:
            print(f"[mcp]   -> drill failed: {e}")
            continue
        for idx, r in enumerate(drill_rows):
            # Decrement by ``idx`` so actions within a group keep their
            # drill-down order while still respecting parent-group ranking.
            actions.append({
                "id":                f"{scope}_{len(actions):02d}",
                "text":              (r.get("text") or "").strip(),
                "type":              scope,
                "opportunity_score": max(1, group_pct - idx),
            })
    actions.sort(key=lambda a: a["opportunity_score"], reverse=True)
    actions = actions[:12]
    print(f"[mcp]   -> {len(actions)} concrete actions "
          f"(scores {actions[0]['opportunity_score'] if actions else 0}"
          f"..{actions[-1]['opportunity_score'] if actions else 0})")

    return {
        "session_brands":   session_brands,
        "own_name":         own_name,
        "own_visibility":   own_vis,
        "competitor_avg":   comp_avg,
        "top_phrases":      top_phrases,
        "raw_url_blocks":   raw_url_blocks,
        "actions":          actions,
    }


# ---------------------------------------------------------------------------
# Public async entry point — keeps signature compat with REST version
# ---------------------------------------------------------------------------

async def fetch_peec_session(
    api_key: str = "",      # noqa: ARG001 — kept for caller compatibility
    project_id: str = "",
    gemini_key: str = "",
    *,
    allow_browser: bool = False,
) -> dict:
    """Fetch a live Peec session via MCP. ``api_key`` is ignored — MCP uses
    OAuth tokens cached by ``peec_mcp_auth``.

    ``allow_browser`` controls what happens when no token is cached. The
    FastAPI lifespan passes ``False`` (no auto-browser, raise instead);
    the standalone CLI passes ``True`` so the first run can do the login.
    """
    pid = project_id or os.getenv("PEEC_PROJECT_ID", "").strip()
    if not pid:
        raise RuntimeError("PEEC_PROJECT_ID required (env or arg)")

    if not allow_browser and not _has_cached_mcp_token():
        raise RuntimeError(
            "No cached MCP token at "
            f"{MCP_CACHE_FILE}. Run `python peec_mcp_auth.py login` once "
            "to authorize, then restart the server."
        )

    print(f"[peec] MCP fetch for project {pid}")
    raw = await asyncio.to_thread(_fetch_mcp_data, pid)

    # Gemini enrichment in parallel
    top_url_contents: list[dict] = []
    if raw["raw_url_blocks"]:
        async with httpx.AsyncClient() as gclient:
            excerpts = await asyncio.gather(*[
                _gemini_excerpt(
                    gclient, gemini_key, b["url"], raw["own_name"] or "the brand", b["content_raw"],
                )
                for b in raw["raw_url_blocks"]
            ])
        for b, excerpt in zip(raw["raw_url_blocks"], excerpts):
            top_url_contents.append({
                "url":            b["url"],
                "citation_count": b["citation_count"],
                "classification": b["classification"],
                "content":        excerpt,
            })

    return {
        "brands":      raw["session_brands"],
        "top_urls":    top_url_contents,
        "top_phrases": raw["top_phrases"],
        "actions":     raw["actions"],
        "brand_report_summary": {
            "own_visibility":            raw["own_visibility"],
            "competitor_avg_visibility": raw["competitor_avg"],
        },
    }


# ---------------------------------------------------------------------------
# CLI — run this file directly to seed user.json
# ---------------------------------------------------------------------------

async def _cli() -> None:
    from dotenv import load_dotenv
    load_dotenv()

    project_id = os.getenv("PEEC_PROJECT_ID", "").strip()
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()

    if not project_id:
        print("PEEC_PROJECT_ID required in backend/.env")
        sys.exit(1)

    print(f"[peec] project: {project_id}")
    print(f"[peec] gemini:  {'enabled' if gemini_key else 'disabled (raw content fallback)'}")

    session = await fetch_peec_session(
        project_id=project_id, gemini_key=gemini_key, allow_browser=True,
    )

    out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "user.json")
    own = next((b for b in session["brands"] if b["is_own"]), {})
    competitors = [b for b in session["brands"] if not b["is_own"]]
    payload = {
        "brand_name":                own.get("name", ""),
        "own_visibility":            session["brand_report_summary"]["own_visibility"],
        "competitor_avg_visibility": session["brand_report_summary"]["competitor_avg_visibility"],
        "competitors":               competitors,
        "top_url_contents":          session["top_urls"],
        "top_phrases":               session["top_phrases"],
        "actions":                   session["actions"],
        "source":                    "live-mcp",
        "updated_at":                str(date.today()),
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"\n[peec] wrote {out_path}")
    print(f"  brand:       {payload['brand_name']}")
    print(f"  competitors: {[c['name'] for c in competitors]}")
    print(f"  visibility:  own={payload['own_visibility']:.3f} vs avg={payload['competitor_avg_visibility']:.3f}")
    print(f"  top URLs:    {len(payload['top_url_contents'])}")
    print(f"  top phrases: {len(payload['top_phrases'])}")
    print(f"  actions:     {len(payload['actions'])}")


if __name__ == "__main__":
    asyncio.run(_cli())
