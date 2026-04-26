#!/usr/bin/env python3
"""Fetch every section of the Peec snapshot for a single project.

Calls the Peec MCP tools needed to fill all 13 sections of the shape that
data/peec-snapshot.ts exposes, plus `tags` (14th section). Writes pure JSON
to --output (no `export const` wrapper).

Progress is logged to STDERR as one line per phase so /api/peec/fetch can
stream it as SSE to the onboarding UI:

    [fetch] phase=projectProfile     status=running
    [fetch] phase=projectProfile     status=complete  ms=187
    ...
    [fetch] DONE  total_ms=14820  output=/abs/path.json

Usage:
    python3 vendor/peec_full_fetch.py \\
        --project-id or_faaa7625-bc84-4f64-a754-a412d423c641 \\
        --output data/peec-live-or_faaa7625-....json \\
        [--start-date 2026-03-26] [--end-date 2026-04-25]

Exit codes:
    0   success
    2   MCP session init failed (re-auth needed)
    3   tool call failed mid-fetch (stderr has the section + raw error)
    4   filesystem write failed
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import date, timedelta
from pathlib import Path
from typing import Any

# Hard deadline for the actions phase. Empirically the Peec server occasionally
# drops `get_actions` drill-down streams mid-flight; MCPSession's built-in
# retry costs ~30s per attempt. Past that, "actions unavailable" is a better
# user experience than blowing the route's overall budget.
ACTIONS_DEADLINE_S = 30

# Reuse the existing OAuth + MCP transport that lives in data/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))
from peec_mcp_auth import MCPSession  # noqa: E402  (path injection)


@contextlib.contextmanager
def _stdout_to_stderr():
    """peec_mcp_auth uses print() for diagnostics. Route those to stderr so
    our stdout stays available for the optional JSON dump (--output -)."""
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = saved


# ---------------------------------------------------------------------------
# Tiny helpers
# ---------------------------------------------------------------------------

def log(line: str) -> None:
    """Progress goes to stderr (one parseable line per phase)."""
    print(line, file=sys.stderr, flush=True)


def _structured(result: dict) -> dict:
    if not isinstance(result, dict):
        return {}
    return result.get("structuredContent") or result


def _rows_to_dicts(result: dict) -> list[dict]:
    sc = _structured(result)
    if not isinstance(sc, dict) or "rows" not in sc:
        return []
    cols = sc.get("columns", [])
    return [dict(zip(cols, row)) for row in sc.get("rows", [])]


def _phase_running(name: str) -> float:
    log(f"[fetch] phase={name:<22} status=running")
    return time.perf_counter()


def _phase_complete(name: str, t0: float, detail: str = "") -> int:
    ms = int((time.perf_counter() - t0) * 1000)
    suffix = f"  detail={detail}" if detail else ""
    log(f"[fetch] phase={name:<22} status=complete  ms={ms}{suffix}")
    return ms


# ---------------------------------------------------------------------------
# Section builders — each takes the MCPSession + context, returns the JSON
# blob for that section. Raises on tool error so main() can tag it.
# ---------------------------------------------------------------------------

def _section_project_profile(s: MCPSession, project_id: str) -> dict:
    """Section 1 — projectProfile."""
    res = s.call_tool("get_project_profile", {"project_id": project_id})
    sc = _structured(res)
    # The tool returns the profile directly; fall back to a stub if missing.
    if not isinstance(sc, dict) or not sc:
        return {"project_id": project_id, "profile": None}
    # Some servers wrap under "profile"; if it's flat, we wrap it.
    profile = sc.get("profile") if "profile" in sc else sc
    return {"project_id": project_id, "profile": profile}


def _section_brands(s: MCPSession, project_id: str) -> tuple[dict, dict | None]:
    """Section 2 — brands. Returns (section_dict, own_brand_dict_or_none)."""
    res = s.call_tool("list_brands", {"project_id": project_id, "limit": 1000})
    sc = _structured(res)
    columns = sc.get("columns", [])
    rows_raw = sc.get("rows", [])
    rows = [dict(zip(columns, r)) for r in rows_raw]
    # Preserve full fields (id, name, domains, aliases, is_own).
    section = {
        "meta": {"columns": columns, "totalCount": len(rows)},
        "rows": rows,
    }
    own = next((b for b in rows if b.get("is_own")), None)
    return section, own


def _section_topics(s: MCPSession, project_id: str) -> dict:
    """Section 3 — topics."""
    res = s.call_tool("list_topics", {"project_id": project_id, "limit": 1000})
    rows = _rows_to_dicts(res)
    return {"totalCount": len(rows), "rows": rows}


def _section_tags(s: MCPSession, project_id: str) -> dict:
    """Section 4 — tags."""
    res = s.call_tool("list_tags", {"project_id": project_id, "limit": 1000})
    rows = _rows_to_dicts(res)
    return {"totalCount": len(rows), "rows": rows}


def _section_prompts(s: MCPSession, project_id: str) -> dict:
    """Section 5 — prompts (full taxonomy with tag_ids, topic_id, volume)."""
    res = s.call_tool("list_prompts", {"project_id": project_id, "limit": 1000})
    sc = _structured(res)
    columns = sc.get("columns", [])
    rows = [dict(zip(columns, r)) for r in sc.get("rows", [])]
    return {
        "totalCount": len(rows),
        "columns": columns,
        "rows": rows,
    }


def _section_brand_report_overall(
    s: MCPSession, project_id: str, start: str, end: str
) -> dict:
    """Section 6 — brandReportOverall (no extra dimensions; full columns kept)."""
    res = s.call_tool("get_brand_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date": end,
        "limit": 1000,
    })
    sc = _structured(res)
    return {
        "dateRange": {"start": start, "end": end},
        "columns": sc.get("columns", []),
        "rows": [dict(zip(sc.get("columns", []), r)) for r in sc.get("rows", [])],
    }


def _section_brand_report_by_model(
    s: MCPSession, project_id: str, start: str, end: str
) -> dict:
    """Section 7 — brandReportByModel (`dimensions: ["model_id"]`)."""
    res = s.call_tool("get_brand_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date": end,
        "dimensions": ["model_id"],
        "limit": 1000,
    })
    sc = _structured(res)
    cols = sc.get("columns", [])
    return {
        "dateRange": {"start": start, "end": end},
        "note": "Per-AI-engine breakdown (split by model_id).",
        "columns": cols,
        "rows": [dict(zip(cols, r)) for r in sc.get("rows", [])],
    }


def _derive_share_of_voice(brand_report_rows: list[dict], own: dict | None) -> dict:
    """Section 8 — shareOfVoice. Pure post-process of section 6."""
    own_id = (own or {}).get("id", "")

    def _slim(r: dict) -> dict:
        return {
            "brand_id": r.get("brand_id"),
            "brand_name": r.get("brand_name"),
            "share_of_voice": r.get("share_of_voice", 0.0) or 0.0,
            "visibility": r.get("visibility", 0.0) or 0.0,
            "mention_count": r.get("mention_count", 0) or 0,
            "sentiment": r.get("sentiment"),
            "avg_position": r.get("position"),
        }

    own_row = next(
        (r for r in brand_report_rows if r.get("brand_id") == own_id),
        None,
    )
    competitors = [
        _slim(r) for r in brand_report_rows if r.get("brand_id") != own_id
    ]
    competitors.sort(key=lambda r: r.get("share_of_voice") or 0.0, reverse=True)
    return {
        "ownBrand": _slim(own_row) if own_row else None,
        "competitors": competitors,
    }


def _section_top_prompts_brand_cited(
    s: MCPSession, project_id: str, start: str, end: str, own_id: str
) -> dict:
    """Section 9 — topPromptsBrandCited (filter own brand, dimension prompt_id)."""
    if not own_id:
        return {"dateRange": {"start": start, "end": end}, "rows": []}

    res = s.call_tool("get_brand_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date": end,
        "dimensions": ["prompt_id"],
        "filters": [{"field": "brand_id", "operator": "in", "values": [own_id]}],
        "limit": 1000,
    })
    sc = _structured(res)
    cols = sc.get("columns", [])
    raw = [dict(zip(cols, r)) for r in sc.get("rows", [])]

    # Need prompt text — fetch once and join.
    prompt_res = s.call_tool("list_prompts", {"project_id": project_id, "limit": 1000})
    prompt_rows = _rows_to_dicts(prompt_res)
    text_by_id = {p.get("id"): p.get("text", "") for p in prompt_rows}

    out_rows = []
    for r in raw:
        pid = r.get("prompt_id")
        # Some servers nest prompt_id under {id, name}; flatten both shapes.
        if isinstance(pid, dict):
            pid = pid.get("id")
        out_rows.append({
            "prompt_id": pid,
            "prompt_text": text_by_id.get(pid, ""),
            "visibility": r.get("visibility", 0.0) or 0.0,
            "mention_count": r.get("mention_count", 0) or 0,
            "sentiment": r.get("sentiment"),
            "avg_position": r.get("position"),
        })
    # Match our snapshot's "visibility > 0, sorted desc" convention.
    out_rows = [r for r in out_rows if (r["visibility"] or 0) > 0]
    out_rows.sort(
        key=lambda r: (r["visibility"], r["mention_count"]),
        reverse=True,
    )
    return {
        "dateRange": {"start": start, "end": end},
        "note": "Sorted by visibility desc. Only rows where visibility > 0.",
        "rows": out_rows,
    }


def _section_url_reports(
    s: MCPSession, project_id: str, start: str, end: str, own_id: str
) -> tuple[dict, dict]:
    """Sections 10 & 12 — both come from the same get_url_report fetch.

    Section 10: competitor gap URLs (own brand absent, ≥2 competitors present)
    Section 12: top cited URLs (all brands)
    """
    res = s.call_tool("get_url_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date": end,
        "limit": 50,
        "order_by": [{"field": "citation_count", "direction": "desc"}],
    })
    sc = _structured(res)
    cols = sc.get("columns", [])
    rows = [dict(zip(cols, r)) for r in sc.get("rows", [])]

    # Top cited URLs = top 20 by citation_count (already sorted).
    top_cited = rows[:20]
    section_top_cited = {
        "dateRange": {"start": start, "end": end},
        "columns": cols,
        "rows": top_cited,
    }

    # Gap URLs: drop rows where own brand IS mentioned, keep ≥ 2 competitors.
    gap_rows = []
    for r in rows:
        mentioned = r.get("mentioned_brand_ids") or []
        if own_id and own_id in mentioned:
            continue
        competitors_present = [bid for bid in mentioned if bid != own_id]
        if len(competitors_present) < 2:
            continue
        gap_rows.append({
            **r,
            "competitor_brand_ids_present": competitors_present,
        })
    gap_rows = gap_rows[:20]

    section_gap = {
        "dateRange": {"start": start, "end": end},
        "note": "Own brand is absent in all rows. At least 2 competitors are present.",
        "columns": cols,
        "rows": gap_rows,
    }
    return section_gap, section_top_cited


def _derive_sentiment_data(
    overall_rows: list[dict],
    by_model_rows: list[dict],
    own: dict | None,
) -> dict:
    """Section 11 — sentimentData. Derived from sections 6 + 7."""
    own_id = (own or {}).get("id", "")
    own_row = next((r for r in overall_rows if r.get("brand_id") == own_id), None)

    by_model: dict[str, dict] = {}
    for r in by_model_rows:
        if r.get("brand_id") != own_id:
            continue
        mid = r.get("model_id")
        if isinstance(mid, dict):
            mid = mid.get("id") or mid.get("name")
        if not mid:
            continue
        by_model[mid] = {
            "sentiment": r.get("sentiment"),
            "sentiment_sum": r.get("sentiment_sum"),
            "sentiment_count": r.get("sentiment_count"),
        }

    competitors = [
        {"brand_name": r.get("brand_name"), "sentiment": r.get("sentiment")}
        for r in overall_rows
        if r.get("sentiment") is not None
    ]
    competitors.sort(key=lambda r: r.get("sentiment") or 0, reverse=True)

    return {
        "note": "Scale 0–100. Most brands score 65–85.",
        "ownBrand": (
            {
                "brand_id": own_row.get("brand_id"),
                "brand_name": own_row.get("brand_name"),
                "sentiment": own_row.get("sentiment"),
                "sentiment_sum": own_row.get("sentiment_sum"),
                "sentiment_count": own_row.get("sentiment_count"),
            }
            if own_row
            else None
        ),
        "byModel": by_model,
        "competitors": competitors,
    }


def _section_actions(s: MCPSession, project_id: str) -> dict:
    """Section 13 — actions. Fetches overview + drill-downs (mirrors peec_client)."""
    ACTION_TYPE_MAP = {
        "OWNED": "owned",
        "EDITORIAL": "editorial",
        "UGC": "ugc",
        "REFERENCE": "reference",
    }
    overview = _rows_to_dicts(
        s.call_tool("get_actions", {"scope": "overview", "project_id": project_id})
    )
    overview.sort(key=lambda r: r.get("opportunity_score", 0) or 0, reverse=True)
    if not overview:
        return {"status": "ok", "items": []}

    max_group_score = max(
        (g.get("opportunity_score") or 0) for g in overview
    ) or 1.0

    items: list[dict] = []
    for og in overview[:6]:
        agroup = og.get("action_group_type", "OWNED")
        scope = ACTION_TYPE_MAP.get(agroup, "owned")
        group_pct = int(((og.get("opportunity_score") or 0) / max_group_score) * 99)

        args: dict[str, Any] = {"scope": scope, "project_id": project_id}
        url_cls = og.get("url_classification")
        domain = og.get("domain")
        if url_cls:
            args["url_classification"] = url_cls
        elif domain:
            args["domain"] = domain
        try:
            drill_rows = _rows_to_dicts(s.call_tool("get_actions", args))
        except Exception as e:
            log(f"[fetch]   drill {scope}/{url_cls or domain or '?'} failed: {e}")
            continue
        for idx, r in enumerate(drill_rows):
            items.append({
                "id": f"{scope}_{len(items):02d}",
                "text": (r.get("text") or "").strip(),
                "type": scope,
                "opportunity_score": max(1, group_pct - idx),
            })
    items.sort(key=lambda a: a["opportunity_score"], reverse=True)
    return {"status": "ok", "items": items[:12]}


def _section_historical_trends(
    s: MCPSession, project_id: str, start: str, end: str
) -> dict:
    """Section 14 — historicalTrends (`dimensions: ["date"]`)."""
    res = s.call_tool("get_brand_report", {
        "project_id": project_id,
        "start_date": start,
        "end_date": end,
        "dimensions": ["date"],
        "limit": 1000,
    })
    sc = _structured(res)
    cols = sc.get("columns", [])
    rows = [dict(zip(cols, r)) for r in sc.get("rows", [])]
    return {
        "dateRange": {"start": start, "end": end},
        "note": "Daily per-brand metrics. Sparse early days are normal for new projects.",
        "columns": cols,
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def fetch_all(
    project_id: str, start: str, end: str
) -> dict:
    """Run every phase and assemble the snapshot dict.

    Each phase is wrapped so that failure surfaces with the section name
    intact — main() converts that into exit code 3 + stderr breadcrumb.
    """
    try:
        with _stdout_to_stderr():
            s = MCPSession()
    except Exception as e:
        raise RuntimeError(f"[mcp-init] {e}") from e

    # Wrap every tool call to keep our own stdout pristine. Cheap monkey-patch
    # so individual section helpers don't have to repeat the context manager.
    _original_call_tool = s.call_tool

    def _silent_call_tool(name: str, arguments: dict[str, Any]) -> dict:
        with _stdout_to_stderr():
            return _original_call_tool(name, arguments)

    s.call_tool = _silent_call_tool  # type: ignore[assignment]

    out: dict[str, Any] = {}

    # 1. Project profile
    t = _phase_running("projectProfile")
    try:
        out["projectProfile"] = _section_project_profile(s, project_id)
    except Exception as e:
        raise RuntimeError(f"[projectProfile] {e}") from e
    _phase_complete("projectProfile", t, detail=f"name={(out['projectProfile'].get('profile') or {}).get('name','?')}")

    # 2. Brands
    t = _phase_running("brands")
    try:
        out["brands"], own = _section_brands(s, project_id)
    except Exception as e:
        raise RuntimeError(f"[brands] {e}") from e
    _phase_complete("brands", t, detail=f"count={out['brands']['meta']['totalCount']} own={(own or {}).get('name','?')}")
    own_id = (own or {}).get("id", "")

    # 3. Topics
    t = _phase_running("topics")
    try:
        out["topics"] = _section_topics(s, project_id)
    except Exception as e:
        raise RuntimeError(f"[topics] {e}") from e
    _phase_complete("topics", t, detail=f"count={out['topics']['totalCount']}")

    # 4. Tags
    t = _phase_running("tags")
    try:
        out["tags"] = _section_tags(s, project_id)
    except Exception as e:
        raise RuntimeError(f"[tags] {e}") from e
    _phase_complete("tags", t, detail=f"count={out['tags']['totalCount']}")

    # 5. Prompts
    t = _phase_running("prompts")
    try:
        out["prompts"] = _section_prompts(s, project_id)
    except Exception as e:
        raise RuntimeError(f"[prompts] {e}") from e
    _phase_complete("prompts", t, detail=f"count={out['prompts']['totalCount']}")

    # 6. Brand report overall
    t = _phase_running("brandReportOverall")
    try:
        out["brandReportOverall"] = _section_brand_report_overall(
            s, project_id, start, end
        )
    except Exception as e:
        raise RuntimeError(f"[brandReportOverall] {e}") from e
    _phase_complete("brandReportOverall", t, detail=f"rows={len(out['brandReportOverall']['rows'])}")

    # 7. Brand report by model
    t = _phase_running("brandReportByModel")
    try:
        out["brandReportByModel"] = _section_brand_report_by_model(
            s, project_id, start, end
        )
    except Exception as e:
        raise RuntimeError(f"[brandReportByModel] {e}") from e
    _phase_complete("brandReportByModel", t, detail=f"rows={len(out['brandReportByModel']['rows'])}")

    # 8. Share of voice (derived)
    t = _phase_running("shareOfVoice")
    sov = _derive_share_of_voice(out["brandReportOverall"]["rows"], own)
    out["shareOfVoice"] = {
        "dateRange": {"start": start, "end": end},
        **sov,
    }
    _phase_complete("shareOfVoice", t, detail=f"competitors={len(sov['competitors'])}")

    # 9. Top prompts brand cited
    t = _phase_running("topPromptsBrandCited")
    try:
        out["topPromptsBrandCited"] = _section_top_prompts_brand_cited(
            s, project_id, start, end, own_id
        )
    except Exception as e:
        raise RuntimeError(f"[topPromptsBrandCited] {e}") from e
    _phase_complete("topPromptsBrandCited", t, detail=f"rows={len(out['topPromptsBrandCited']['rows'])}")

    # 10 + 12. URL reports (gap + top cited)
    t = _phase_running("urlReports")
    try:
        gap_section, top_cited_section = _section_url_reports(
            s, project_id, start, end, own_id
        )
    except Exception as e:
        raise RuntimeError(f"[urlReports] {e}") from e
    out["competitorGapUrls"] = gap_section
    out["topCitedUrls"] = top_cited_section
    _phase_complete(
        "urlReports", t,
        detail=f"top={len(top_cited_section['rows'])} gap={len(gap_section['rows'])}",
    )

    # 11. Sentiment data (derived)
    t = _phase_running("sentimentData")
    out["sentimentData"] = {
        "dateRange": {"start": start, "end": end},
        **_derive_sentiment_data(
            out["brandReportOverall"]["rows"],
            out["brandReportByModel"]["rows"],
            own,
        ),
    }
    _phase_complete("sentimentData", t)

    # 13. Actions — time-boxed because the get_actions drill-downs can hang
    # on transient SSE drops; never let one phase blow the whole budget.
    t = _phase_running("actions")
    actions_status = "ok"
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_section_actions, s, project_id)
            try:
                out["actions"] = fut.result(timeout=ACTIONS_DEADLINE_S)
            except FuturesTimeoutError:
                # The worker thread keeps running until httpx unblocks; we
                # just stop waiting for it. The MCP session is single-use
                # for this script so the orphaned thread is harmless.
                actions_status = "timeout"
                out["actions"] = {
                    "status": "unavailable",
                    "note": f"actions phase exceeded {ACTIONS_DEADLINE_S}s deadline; partial fetches discarded",
                    "items": [],
                }
    except Exception as e:
        # Hard error from the worker (not a timeout) — same graceful degradation.
        log(f"[fetch]   actions failed (continuing): {e}")
        actions_status = "error"
        out["actions"] = {
            "status": "unavailable",
            "note": str(e),
            "items": [],
        }
    items_count = len(out["actions"].get("items", []))
    _phase_complete(
        "actions", t,
        detail=f"items={items_count} result={actions_status}",
    )

    # 14. Historical trends
    t = _phase_running("historicalTrends")
    try:
        out["historicalTrends"] = _section_historical_trends(s, project_id, start, end)
    except Exception as e:
        raise RuntimeError(f"[historicalTrends] {e}") from e
    _phase_complete("historicalTrends", t, detail=f"rows={len(out['historicalTrends']['rows'])}")

    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--project-id", required=True, help="Peec project id (or_xxx)")
    ap.add_argument("--output", required=True, help="Path to write JSON")
    ap.add_argument("--start-date", default=None, help="ISO date; defaults to 30 days ago")
    ap.add_argument("--end-date", default=None, help="ISO date; defaults to today")
    args = ap.parse_args()

    end = args.end_date or date.today().isoformat()
    start = args.start_date or (date.today() - timedelta(days=30)).isoformat()

    log(f"[fetch] START project_id={args.project_id} range={start}..{end}")
    t0 = time.perf_counter()

    try:
        snapshot = fetch_all(args.project_id, start, end)
    except RuntimeError as e:
        msg = str(e)
        if msg.startswith("[mcp-init"):
            log(f"[fetch] FAIL  {msg}")
            return 2
        log(f"[fetch] FAIL  {msg}")
        return 3

    out_path = os.path.abspath(args.output)
    try:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=2)
    except OSError as e:
        log(f"[fetch] FAIL  write {out_path}: {e}")
        return 4

    total_ms = int((time.perf_counter() - t0) * 1000)
    log(f"[fetch] DONE  total_ms={total_ms}  output={out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
