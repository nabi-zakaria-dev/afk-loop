# PRD — `afk-loop watch`: live progress dashboard

## Context

`afk-loop` is an AFK orchestrator. You start it, walk away, come back to `summary.md`. The README explicitly says not to babysit. But there is a gap between "running" and "done": when you check in mid-run (every 30–60 minutes), you currently have no good way to see *what's happening right now*. The existing surfaces are the wrong shape for that question:

- `summary.md` — append-only, post-iteration only. Always behind real-time.
- `status.json` — live, but raw JSON. Not human-glanceable.
- stderr stream — calm audit trail, one line per phase boundary. Useless for "where is each implementer right now?"
- `.afk-loop/logs/issue-N/*.jsonl` — for post-mortem, not live use.

Today the workaround is `cat status.json` or `tail -f` of stderr, both of which are awkward and miss the AC-level granularity the user actually wants.

## Problem

When the user checks in on a running loop, they need a glanceable view of:

- Run state and iteration progress.
- Each in-flight issue's progress through its acceptance criteria.
- What's coming up next in the queue.
- Any failures so far this run, with paths to investigate.
- A banner signal when the entire run is dead (cycle, rate-limit, crash).

Without this, "AFK with check-ins" degrades into "full babysit at the terminal."

## User stories

- As a user mid-run, I want to see how far each in-flight implementer has progressed through its ACs, so I can predict when the iteration will finish.
- As a user mid-run, I want to see the queue of upcoming issues, so I can decide whether the run is on track.
- As a user mid-run, I want to spot failures fast and get pointed to the right log file, so I can decide whether to abort or let the run continue.
- As a user mid-run, I want a banner-level signal when the entire run is dead, so I don't sit watching a frozen dashboard.
- As a user, I want my terminal scrollback to stay calm overnight, so the morning check-in doesn't drown in 8 hours of refresh frames.

## Goals

- Add `afk-loop watch` — alt-screen TTY dashboard, refreshes every 3 seconds.
- Enrich `status.json` to be the single source of truth for live run state.
- Track AC-level progress per in-flight issue by inspecting git commits in worktrees.
- Surface issue-scoped failures inline; surface run-scoped failures in the header banner.
- Keep stderr stream unchanged (still calm, still one line per phase boundary).

## Non-goals

- **Babysit-mode UX** (live tail, second-by-second updates). Out of scope by deliberate design choice.
- **Mid-AC granularity** ("writing test now" vs. "implementing now"). Boundary transitions only — RED commit landed, GREEN commit landed.
- **Full JSONL parsing inside `watch`**. Future `afk-loop tail <N>` command, not this one.
- **Hotkey navigation, tabs, `j`/`k`**. Keep it dumb: `q` quits, `l` dumps errors and quits.
- **Adding new heavyweight dependencies** (React-for-CLI, blessed). Hand-rolled ANSI to match the project's minimalist deps.

## Solution sketch

### 1. Implementer prompt change

Add `[AC N]` to commit subject lines:

```
test: add cycle detection for self-loops [AC 2] (#42)
feat: detect self-loops in dep-graph DFS [AC 2] (#42)
```

A two-line addition to `prompts/implement-prompt.md`. Reviewer continues to verify TDD shape unchanged; AC numbering is supplementary, not required for review pass.

### 2. Orchestrator AC inspection

Every 3 seconds, for each in-flight worktree, the orchestrator:

- Runs `git log main..HEAD --format=%s%n%H%n%aI` over the worktree.
- Counts `test:` (RED) → `feat:`/`fix:` (GREEN) commit pairs.
- Maps pairs to AC numbers (via `[AC N]` if present; fallback: positional index).
- Reads the issue body (already cached during planning) and parses the `## Acceptance criteria` section, supporting the `[layer] criterion text` format from `/to-issues` v2.
- Computes per-AC state: `pending` / `red` / `green` / `refactored`.

### 3. Enriched `status.json` contract

```json
{
  "currentIteration": 2,
  "runState": "running",
  "lastEventAt": "2026-05-08T14:32:01Z",
  "rateLimitedUntil": null,
  "runtimeBudgetHours": 8,
  "runtimeElapsedHours": 4.2,
  "frontier": [42, 43, 44],
  "inFlight": [
    {
      "issue": 42,
      "title": "Display pending invoices",
      "phase": "implementer",
      "startedAt": "2026-05-08T14:30:11Z",
      "lastTransitionAt": "2026-05-08T14:31:24Z",
      "acs": [
        { "n": 1, "title": "[UI] shows empty state",      "state": "green",   "redAt": "...", "greenAt": "..." },
        { "n": 2, "title": "[API] returns invoices",      "state": "red",     "redAt": "...", "greenAt": null },
        { "n": 3, "title": "[tests] integration test",    "state": "pending", "redAt": null,  "greenAt": null }
      ],
      "lastError": null
    }
  ],
  "queued": [
    { "issue": 45, "title": "Send invoice reminder" }
  ],
  "done": [
    { "issue": 41, "outcome": "merged", "commitUrl": "https://github.com/.../commit/abc123" }
  ],
  "failed": [
    {
      "issue": 40,
      "category": "reviewer-refused",
      "reason": "AC3 unverified",
      "logPath": ".afk-loop/logs/issue-40/reviewer-iter-1.jsonl"
    }
  ]
}
```

### 4. `afk-loop watch` command

Alt-screen full redraw, 3 s cadence. Approximate layout:

```
afk-loop · iter 2/? · running · 4h 12m / 8h budget · maxParallel=3
─────────────────────────────────────────────────────────────────
IN FLIGHT (3)
  #42 [impl  ] Display pending invoices    [██░░░] 2/5 · AC2 RED 0:43 · 1m 12s
  #43 [review] Cancel a subscription       [█████] 5/5 · 3m 47s
  #44 [impl  ] Decide auth strategy [HITL] [░░░░░] 0/3 · waiting

QUEUE (4)
  #45 Send invoice reminder · #46 Bulk-archive · #47 Filter by status · #48 …

RECENT
  ✅ #41 merged · 14:22 · feat: pagination
  ⚠ #40 reviewer refused: AC3 unverified · logs/issue-40/

ERRORS (1) — press 'l' to dump paths and quit, 'q' to quit
  ⚠ #40 reviewer refused: AC3 unverified · logs/issue-40/reviewer-iter-1.jsonl
```

**Header banner overrides** for run-scoped failures:

- `⚠ RATE-LIMITED until 15:42`
- `✗ CYCLE DETECTED — run aborted`
- `✗ STALE (last event 12m ago — orchestrator may have crashed)`

**Flags / hotkeys:**

- `afk-loop watch` — default dashboard.
- `afk-loop watch --focus 42` — zoom into issue #42's full AC list, one issue only.
- `q` — quit, restore scrollback (alt-screen exit).
- `l` — exit alt-screen first, then print error reasons + log paths to scrollback, then exit.

### 5. Run-state edge cases

| State                                                        | What `watch` shows                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `status.json` missing                                        | "no run in progress" + exit 0                                               |
| `runState: done`                                             | last frame statically, header reads `complete — see summary.md`             |
| `runState: paused` (rate limit)                              | header banner `⚠ RATE-LIMITED until <ts>`, in-flight section blank          |
| `runState: failed` (cycle)                                   | header banner `✗ CYCLE DETECTED — run aborted`                              |
| `lastEventAt` more than 5 min in past while `runState: running` | header banner `✗ STALE (orchestrator may have crashed)`                  |

## Feature-level acceptance criteria

The feature ships when:

- [ ] `afk-loop watch` opens an alt-screen dashboard that refreshes every 3 seconds and restores scrollback on `q`.
- [ ] Each in-flight issue's row shows AC progress count, current AC state, and elapsed time, sourced from worktree git history.
- [ ] The dashboard renders all four sections (IN FLIGHT, QUEUE, RECENT, ERRORS) plus a header bar with run-scoped state.
- [ ] Run-scoped failures (cycle, rate-limit, stale, done) override the header instead of appearing in the ERRORS section.
- [ ] `l` exits alt-screen and dumps error reasons + log paths to scrollback before quitting.
- [ ] `--focus N` shows the full AC list for issue #N.
- [ ] Implementer commits include `[AC N]` in the subject; reviewer continues to pass on existing issues.
- [ ] The stderr progress stream from the orchestrator is unchanged from today.
- [ ] Commit-inspection logic has unit tests using `mkTmpRepo`.

## Layer vocabulary touched (input to `/to-issues`)

The project's existing layers (inferred from DESIGN.md, README.md, src/ structure):

- `[orchestrator]` — phases, status.json writes, AC commit-inspection
- `[prompt]` — `prompts/implement-prompt.md` doctrine
- `[cli]` — `main.mts` subcommand wiring
- `[tests]` — vitest unit tests using `mkTmpRepo`

New layer introduced by this feature:

- `[watcher]` — new module (likely `src/watch.ts`) for the renderer + alt-screen handling

`/to-issues` should add `[watcher]` to `.claude/project-layers.md` on first run after this feature lands.
