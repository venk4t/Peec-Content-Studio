@AGENTS.md

# Peec data layer (read this before touching anything Peec-shaped)

Live Peec data is loaded **dynamically per project** — there is no longer a
single static snapshot powering the app. The flow:

1. **OAuth (one time per machine)**
   `python3 vendor/list_projects.py` triggers DCR + PKCE in the browser.
   Tokens are cached at `data/.peec_tokens.json` and auto-refreshed.

2. **Pick a project**
   `/setup` calls `GET /api/peec/projects` → spawns `list_projects.py` →
   shows a dropdown. Selecting one writes the project id to a cookie
   (`peec_project_id`).

3. **Fetch a snapshot**
   `POST /api/peec/fetch` spawns `vendor/peec_full_fetch.py --project-id
   <id> --output data/peec-live-<id>.json` and streams the 13 fetch phases
   back as SSE. The result lands at `data/peec-live-<id>.json`.

4. **Render**
   Dashboard server pages call `ensureProjectSelected()` from
   `lib/peec-server.ts`, which reads the cookie, verifies the JSON exists,
   and pins the project via `setCurrentProject()`. All `lib/peec`
   accessors (`getShareOfVoice`, `getRelevantContext`, etc.) then return
   data for that project.

## Files that matter

```
vendor/peec_mcp_auth.py     OAuth + Streamable-HTTP MCP transport (do not modify)
vendor/peec_client.py       Legacy slim fetcher (still used by Python-only flows)
vendor/list_projects.py     Project listing wrapper for /api/peec/projects
vendor/peec_full_fetch.py   13-section snapshot fetcher for /api/peec/fetch
data/peec-snapshot.ts       Static fallback (USE_FALLBACK_SNAPSHOT=true only)
data/peec-live-<id>.json    Per-project live snapshot (gitignored)
lib/peec.ts                 Sync accessors + setCurrentProject + cache
lib/peec-server.ts          ensureProjectSelected() — cookie → setCurrent → render
lib/peec-project-cookie.ts  Cookie name + project-id validator
```

## Hard rules — do not break

- **Do not modify** `data/peec-snapshot.ts`, `vendor/peec_mcp_auth.py`, or
  `vendor/peec_client.py`. They are the contract with the existing Python
  ecosystem.
- **Do not change the shape** any data type the rest of the app consumes.
  Live JSON output must mirror `peec-snapshot.ts` field-for-field.
- **Surface Python errors verbatim.** No silent fallbacks. The setup UI
  shows whatever stderr the script emits.
- **Project ids are validated** with a strict regex (`isValidProjectId` in
  `lib/peec-project-cookie.ts`) — never use a raw cookie or query param
  in a filesystem path without it.

## Adding a new section to the snapshot

1. Add the type in `lib/peec.ts` (preserve existing types).
2. Add a fetcher in `vendor/peec_full_fetch.py` (one helper per section).
3. Add an accessor in `lib/peec.ts` that takes optional `projectId` and
   routes through `_data(projectId)`.
4. The Python script's stderr already auto-streams to the onboarding UI —
   no SSE wiring needed on the Next.js side.

## Switching projects mid-session

The sidebar's project switcher fires `DELETE /api/peec/current` which
clears the cookie and `router.push("/setup")`s. The on-disk JSON cache
**stays** — switching back is instant.

## Refreshing live data

Each dashboard page header includes a `RefreshFromPeecButton` that
re-runs the same SSE fetch in place. On success it calls
`router.refresh()` so server-rendered data updates without a hard reload.
