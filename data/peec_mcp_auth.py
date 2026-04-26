"""Peec MCP — DCR + PKCE OAuth client + Streamable-HTTP MCP transport.

One-time browser login → tokens cached to disk → JSON-RPC calls with auto-refresh.

The Peec ``/mcp`` server speaks the MCP Streamable-HTTP transport, which means:
  • every POST may return either ``application/json`` or ``text/event-stream``,
  • the server issues an ``Mcp-Session-Id`` after ``initialize`` that we MUST
    echo on every subsequent request,
  • we MUST send a ``notifications/initialized`` after ``initialize`` before
    using any tool.

CLI:
    python peec_mcp_auth.py login                  # force a fresh browser login
    python peec_mcp_auth.py tools                  # list every MCP tool
    python peec_mcp_auth.py call <name> '<json>'   # invoke one tool
    python peec_mcp_auth.py probe                  # try common action/phrase tools
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MCP_BASE      = "https://api.peec.ai/mcp"
REDIRECT_URI  = "http://localhost:8765/callback"
CALLBACK_PORT = 8765
CACHE_FILE    = Path(__file__).parent / ".peec_tokens.json"
CLIENT_NAME   = "BigBerlinHack-Reonic-MCP"
PROTOCOL_VERS = "2024-11-05"

# ---------------------------------------------------------------------------
# Token cache
# ---------------------------------------------------------------------------

def _load_cache() -> dict:
    return json.loads(CACHE_FILE.read_text()) if CACHE_FILE.exists() else {}


def _save_cache(data: dict) -> None:
    CACHE_FILE.write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Step 1 — Dynamic Client Registration (RFC 7591)
# ---------------------------------------------------------------------------

def _ensure_client_id() -> str:
    cache = _load_cache()
    if cid := cache.get("client_id"):
        return cid

    r = httpx.post(
        f"{MCP_BASE}/register",
        json={
            "client_name":                CLIENT_NAME,
            "redirect_uris":              [REDIRECT_URI],
            "token_endpoint_auth_method": "none",  # public PKCE client
            "grant_types":                ["authorization_code", "refresh_token"],
            "response_types":             ["code"],
        },
        timeout=20,
    )
    r.raise_for_status()
    cid = r.json()["client_id"]
    _save_cache({**cache, "client_id": cid})
    print(f"[mcp] registered client_id={cid}")
    return cid


# ---------------------------------------------------------------------------
# Step 2+3 — PKCE browser flow
# ---------------------------------------------------------------------------

def _browser_auth(client_id: str) -> tuple[str, str]:
    verifier  = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    state = secrets.token_hex(16)

    auth_url = f"{MCP_BASE}/authorize?" + urllib.parse.urlencode({
        "response_type":         "code",
        "client_id":             client_id,
        "redirect_uri":          REDIRECT_URI,
        "code_challenge":        challenge,
        "code_challenge_method": "S256",
        "state":                 state,
    })

    captured: dict[str, str] = {}

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            captured["code"]  = qs.get("code",  [""])[0]
            captured["state"] = qs.get("state", [""])[0]
            captured["error"] = qs.get("error", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            body = (
                "<h2>Peec MCP auth OK</h2><p>You can close this tab.</p>"
                if captured["code"]
                else f"<h2>Auth failed</h2><pre>{captured['error']}</pre>"
            )
            self.wfile.write(body.encode())
            threading.Thread(target=self.server.shutdown, daemon=True).start()

        def log_message(self, *_):
            pass

    server = HTTPServer(("127.0.0.1", CALLBACK_PORT), _Handler)
    print(f"[mcp] opening browser — click 'Allow' to grant access")
    print(f"[mcp] if it doesn't open, paste this URL manually:\n      {auth_url}")
    webbrowser.open(auth_url)
    server.serve_forever()

    if captured.get("error"):
        raise RuntimeError(f"OAuth error: {captured['error']}")
    if not captured.get("code"):
        raise RuntimeError("No authorization code received")
    if captured.get("state") != state:
        raise RuntimeError("OAuth state mismatch (possible CSRF)")
    return captured["code"], verifier


# ---------------------------------------------------------------------------
# Step 4+5 — token exchange & refresh
# ---------------------------------------------------------------------------

def _exchange_code(client_id: str, code: str, verifier: str) -> dict:
    r = httpx.post(
        f"{MCP_BASE}/token",
        data={
            "grant_type":    "authorization_code",
            "client_id":     client_id,
            "code":          code,
            "redirect_uri":  REDIRECT_URI,
            "code_verifier": verifier,
        },
        timeout=20,
    )
    r.raise_for_status()
    tokens = r.json()
    _save_cache({**_load_cache(), **tokens})
    print("[mcp] tokens cached")
    return tokens


def _refresh(client_id: str) -> str:
    cache = _load_cache()
    rtok  = cache.get("refresh_token")
    if not rtok:
        raise RuntimeError("No refresh_token cached — re-run `login`")
    r = httpx.post(
        f"{MCP_BASE}/token",
        data={
            "grant_type":    "refresh_token",
            "client_id":     client_id,
            "refresh_token": rtok,
        },
        timeout=20,
    )
    r.raise_for_status()
    tokens = r.json()
    _save_cache({**cache, **tokens})
    print("[mcp] access_token refreshed")
    return tokens["access_token"]


def _ensure_access_token(force_login: bool = False) -> tuple[str, str]:
    client_id = _ensure_client_id()
    cache = _load_cache()
    if not force_login and (tok := cache.get("access_token")):
        return client_id, tok
    code, verifier = _browser_auth(client_id)
    tok = _exchange_code(client_id, code, verifier)["access_token"]
    return client_id, tok


# ---------------------------------------------------------------------------
# MCP Streamable-HTTP transport
# ---------------------------------------------------------------------------

def _parse_response(r: httpx.Response) -> dict | None:
    """Return the first JSON-RPC response object from an HTTP body that may be
    plain JSON or an SSE stream (``text/event-stream``)."""
    ct = r.headers.get("content-type", "")
    if "text/event-stream" in ct:
        for line in r.text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    try:
                        return json.loads(payload)
                    except json.JSONDecodeError:
                        continue
        return None
    if "application/json" in ct and r.text.strip():
        return r.json()
    return None


class MCPSession:
    """Thin Streamable-HTTP MCP client with auth-aware retries."""

    def __init__(self, force_login: bool = False) -> None:
        self.client_id, self.access_token = _ensure_access_token(force_login)
        self.session_id: str | None = None
        self._next_id = 1
        self._http = httpx.Client(timeout=httpx.Timeout(120.0))
        self._initialize()

    # ---- internal helpers ------------------------------------------------

    def _headers(self) -> dict[str, str]:
        h = {
            "Authorization": f"Bearer {self.access_token}",
            "Accept":        "application/json, text/event-stream",
            "Content-Type":  "application/json",
        }
        if self.session_id:
            h["Mcp-Session-Id"] = self.session_id
        return h

    def _post_once(self, payload: dict) -> httpx.Response:
        r = self._http.post(MCP_BASE, json=payload, headers=self._headers())
        if r.status_code == 401:
            self.access_token = _refresh(self.client_id)
            r = self._http.post(MCP_BASE, json=payload, headers=self._headers())
        return r

    def _post(self, payload: dict, *, retries: int = 2) -> dict | None:
        """POST with retry on transient SSE/chunked-read errors. The Peec
        server occasionally closes streamed responses mid-flight on slower
        tool calls; a fresh connection almost always succeeds."""
        last_err: Exception | None = None
        for attempt in range(retries + 1):
            try:
                r = self._post_once(payload)
                if r.status_code >= 400:
                    raise RuntimeError(f"MCP {r.status_code}: {r.text[:400]}")
                sid = r.headers.get("mcp-session-id") or r.headers.get("Mcp-Session-Id")
                if sid:
                    self.session_id = sid
                return _parse_response(r)
            except (httpx.RemoteProtocolError, httpx.ReadError, httpx.ConnectError) as e:
                last_err = e
                # Reset the connection pool — the kept-alive socket is poisoned
                self._http.close()
                self._http = httpx.Client(timeout=httpx.Timeout(120.0))
                if attempt < retries:
                    print(f"[mcp] transient {type(e).__name__} on attempt {attempt+1}, retrying")
                    continue
                raise RuntimeError(f"MCP transport failed after {retries+1} attempts: {e}") from last_err
        raise RuntimeError("unreachable")

    def _next(self) -> int:
        nid = self._next_id
        self._next_id += 1
        return nid

    # ---- protocol --------------------------------------------------------

    def _initialize(self) -> None:
        data = self._post({
            "jsonrpc": "2.0",
            "id":      self._next(),
            "method":  "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERS,
                "capabilities":    {},
                "clientInfo":      {"name": CLIENT_NAME, "version": "0.1"},
            },
        })
        if not data or "result" not in data:
            raise RuntimeError(f"initialize failed: {data}")
        srv = data["result"].get("serverInfo", {})
        print(f"[mcp] connected to {srv.get('name','?')} v{srv.get('version','?')} "
              f"(protocol {data['result'].get('protocolVersion','?')}, session {self.session_id})")
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})

    # ---- public API ------------------------------------------------------

    def list_tools(self) -> list[dict]:
        data = self._post({"jsonrpc": "2.0", "id": self._next(), "method": "tools/list"})
        if not data or "result" not in data:
            raise RuntimeError(f"tools/list failed: {data}")
        return data["result"].get("tools", [])

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict:
        data = self._post({
            "jsonrpc": "2.0",
            "id":      self._next(),
            "method":  "tools/call",
            "params":  {"name": name, "arguments": arguments},
        })
        if not data:
            raise RuntimeError("Empty MCP response")
        if "error" in data:
            raise RuntimeError(f"MCP error: {data['error']}")
        return data.get("result", {})


# Convenience singleton + helper used by the rest of the backend
_singleton: MCPSession | None = None


def session() -> MCPSession:
    global _singleton
    if _singleton is None:
        _singleton = MCPSession()
    return _singleton


def mcp_call(tool: str, arguments: dict[str, Any]) -> dict:
    return session().call_tool(tool, arguments)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_login() -> None:
    if CACHE_FILE.exists():
        cache = _load_cache()
        cache.pop("access_token", None)
        cache.pop("refresh_token", None)
        _save_cache(cache)
    s = MCPSession(force_login=True)
    print(f"[mcp] login OK, {len(s.list_tools())} tools available")


def _cmd_tools() -> None:
    s = session()
    tools = s.list_tools()
    print(f"\n=== {len(tools)} MCP tools ===\n")
    for t in tools:
        name = t.get("name", "?")
        desc = (t.get("description") or "").strip().splitlines()[0:1]
        desc_short = desc[0] if desc else ""
        print(f"  {name:<40} {desc_short[:80]}")
    print()


def _cmd_call(tool: str, arg_json: str) -> None:
    args = json.loads(arg_json) if arg_json else {}
    result = mcp_call(tool, args)
    print(json.dumps(result, indent=2, ensure_ascii=False)[:8000])


def _cmd_probe() -> None:
    """Try the action/phrase-shaped tool names that Peec is most likely to expose."""
    s = session()
    tools = {t["name"]: t for t in s.list_tools()}
    print(f"[probe] {len(tools)} tools: {sorted(tools)[:20]}{'…' if len(tools) > 20 else ''}")

    project_id = os.getenv("PEEC_PROJECT_ID", "").strip()
    if not project_id:
        print("[probe] PEEC_PROJECT_ID missing — set it in backend/.env first")
        return

    candidates = [
        "get_actions", "list_actions", "actions",
        "get_phrases", "list_phrases", "phrases",
        "get_owned_actions", "get_article_actions",
    ]
    found = [c for c in candidates if c in tools]
    print(f"[probe] candidate tools present: {found or '(none)'}")

    for name in found:
        print(f"\n--- {name} ---")
        try:
            res = mcp_call(name, {
                "project_id": project_id,
                "start_date": "2026-04-01",
                "end_date":   "2026-04-26",
                "scope":      "overview",
            })
            print(json.dumps(res, indent=2, ensure_ascii=False)[:2500])
        except Exception as e:
            print(f"[probe] {name} failed: {e}")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1
    cmd = argv[1]
    if cmd == "login":
        _cmd_login()
    elif cmd == "tools":
        _cmd_tools()
    elif cmd == "call":
        if len(argv) < 3:
            print("usage: peec_mcp_auth.py call <tool> '<json args>'"); return 1
        _cmd_call(argv[2], argv[3] if len(argv) > 3 else "")
    elif cmd == "probe":
        _cmd_probe()
    else:
        print(f"unknown command: {cmd}"); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
