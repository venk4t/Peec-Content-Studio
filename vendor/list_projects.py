#!/usr/bin/env python3
"""List every Peec project the authenticated user can see.

Wraps the Peec MCP `list_projects` tool. Output is a JSON array on stdout
that the Next.js API route at /api/peec/projects parses directly:

    [
      {"id": "or_xxx", "name": "Project 1 - Nothing Phone", "status": "CUSTOMER"},
      ...
    ]

Errors go to stderr with a non-zero exit code.

Usage:
    python3 vendor/list_projects.py
"""
from __future__ import annotations

import contextlib
import json
import sys
from pathlib import Path

# Reuse the existing OAuth + MCP transport that lives in data/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data"))
from peec_mcp_auth import MCPSession  # noqa: E402  (path injection)


@contextlib.contextmanager
def _stdout_to_stderr():
    """peec_mcp_auth uses print() for diagnostics. Route those to stderr so
    our stdout stays pure JSON."""
    saved = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = saved


def _rows_to_dicts(result: dict) -> list[dict]:
    sc = result.get("structuredContent", result) if isinstance(result, dict) else {}
    if not isinstance(sc, dict) or "rows" not in sc:
        return []
    cols = sc.get("columns", [])
    return [dict(zip(cols, row)) for row in sc.get("rows", [])]


def main() -> int:
    try:
        with _stdout_to_stderr():
            s = MCPSession()
    except Exception as e:
        print(f"[list_projects] MCP session init failed: {e}", file=sys.stderr)
        return 2

    try:
        with _stdout_to_stderr():
            res = s.call_tool("list_projects", {})
    except Exception as e:
        print(f"[list_projects] list_projects call failed: {e}", file=sys.stderr)
        return 3

    rows = _rows_to_dicts(res)
    out = [
        {
            "id": r.get("id", ""),
            "name": r.get("name", ""),
            "status": r.get("status", ""),
        }
        for r in rows
        if r.get("id")
    ]
    out.sort(key=lambda p: p["name"].lower())
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    print(f"[list_projects] returned {len(out)} project(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
