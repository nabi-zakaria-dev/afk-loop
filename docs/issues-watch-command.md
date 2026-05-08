# Issues — `afk-loop watch` (vertical slices)

> Local issue list (not published to GitHub). Generated via `/to-issues` from `docs/prd-watch-command.md`. Each slice is a tracer bullet — passes the `/to-issues` v2 self-check (≤5 ACs, ≥2 distinct layer tags, non-vacuous Outcome). All AFK.

Layer vocabulary: see `.claude/project-layers.md`.

Dependency graph:

```
#1 ──┬── #2 ── #6
     ├── #3 ── #4
     └── #5
```

---

## #1 — Live in-flight issue dashboard

**Type:** AFK

### Parent

`docs/prd-watch-command.md`

### What to build

The foundation tracer bullet for `afk-loop watch`. A new `watch` subcommand opens an alt-screen TTY dashboard that redraws every 3 seconds, reading from the existing `status.json`. The orchestrator enriches `status.json` so each in-flight issue carries the data the dashboard needs to render the in-flight section.

User runs `afk-loop watch` while a run is in progress and sees a dashboard that shows the currently in-flight issues — issue number, title, phase (`impl` / `review` / `merge`), and elapsed time since the issue entered its current phase. Pressing `q` exits alt-screen and restores scrollback.

This is the foundation for every subsequent slice; queue/recent/errors sections, AC progress, focus mode, and the header banner all extend this base.

### Outcome

After this slice ships, a user can run `afk-loop watch` mid-run and see which issues are currently in-flight, in what phase, and how long they've been running.

### Acceptance criteria

- [ ] `[cli]` `afk-loop watch` subcommand parses and dispatches to a renderer module
- [ ] `[watcher]` alt-screen renderer redraws every 3s and restores scrollback on `q`
- [ ] `[orchestrator]` `status.json` `inFlight` items carry `phase`, `startedAt`, `lastTransitionAt`
- [ ] `[watcher]` in-flight section renders one-liner per issue: # + title + phase + elapsed
- [ ] `[tests]` vitest covers renderer output (snapshot) + orchestrator status enrichment

### Blocked by

None — can start immediately.

---

## #2 — Show what's coming next and what's already failed

**Type:** AFK

### Parent

`docs/prd-watch-command.md`

### What to build

Extend the dashboard with three additional sections — QUEUE, RECENT, and ERRORS — and the orchestrator data feeds that drive them. The orchestrator already knows the unblocked frontier, the merged issues this run, and the failed issues this run; this slice exposes that information through `status.json` and renders it.

User runs `afk-loop watch` and sees not only the in-flight issues, but also the next few issues lined up to be worked, recent successes (with commit URLs), and recent failures (with reasons and log paths to investigate).

### Outcome

After this slice ships, a user can see at a glance what issues are queued next, which merged this run, and which failed (with paths to investigate).

### Acceptance criteria

- [ ] `[orchestrator]` `status.json` includes `queued[]`, `done[]`, `failed[]` arrays populated each tick
- [ ] `[watcher]` QUEUE section renders next issues by # + title (truncated to terminal width)
- [ ] `[watcher]` RECENT section renders ✅/⚠ lines with commit URL or failure summary
- [ ] `[watcher]` ERRORS section renders failed issues with reason + log path
- [ ] `[tests]` vitest covers all three section renderers + orchestrator field population

### Blocked by

- #1

---

## #3 — Show AC progress for in-flight implementers

**Type:** AFK

### Parent

`docs/prd-watch-command.md`

### What to build

Track AC-level progress per in-flight issue and render it in the dashboard. The implementer prompt is updated to include `[AC N]` in commit subjects (see ADR-0001 — this stays compatible with artifact-based reviewer verification, which doesn't require commit-message tags). The orchestrator parses `git log main..HEAD` in each in-flight worktree on every 3s tick, mapping `test:` → `feat:`/`fix:` commit pairs to RED → GREEN AC state transitions, and parses the issue body's `## Acceptance criteria` checklist (in `[layer] criterion text` format from `/to-issues` v2) for AC titles.

User opens `afk-loop watch` and sees, on each in-flight issue's row, AC progress like `2/5 · AC2 RED 0:43` — meaning 2 of 5 ACs done, currently on AC2 with the RED commit landed 43 seconds ago.

### Outcome

After this slice ships, a user can see in `afk-loop watch` how many ACs each in-flight implementer has completed and which AC it is currently working on.

### Acceptance criteria

- [ ] `[prompt]` implementer prompt instructs implementers to include `[AC N]` in commit subject lines (with example commit sequence)
- [ ] `[orchestrator]` `status.json` `inFlight[].acs` is populated each 3s tick by parsing `git log` + the issue body's `## Acceptance criteria` checklist
- [ ] `[watcher]` in-flight one-liner renders AC progress (count + current AC state + RED/GREEN timing)
- [ ] `[tests]` vitest with `mkTmpRepo` asserts `test:` → `feat:` commit pairs map to RED → GREEN AC states
- [ ] `[tests]` vitest asserts AC titles are parsed correctly from `## Acceptance criteria` checklists supporting the `[layer] criterion text` format

### Blocked by

- #1

---

## #4 — Zoom into one issue's full AC progress

**Type:** AFK

### Parent

`docs/prd-watch-command.md`

### What to build

Add a `--focus N` flag to the `watch` subcommand that switches the renderer to a single-issue zoomed view. Instead of one row per in-flight issue with truncated AC info, focus mode dedicates the full screen to one issue's title and full AC list — each AC's title, layer tag, current state, and RED/GREEN timestamps.

User wants to drill into a specific issue's progress without the noise of the other parallel implementers. They run `afk-loop watch --focus 42` and get a detailed AC-by-AC view for issue 42. If issue 42 isn't in-flight, the renderer prints a clear message and exits.

### Outcome

After this slice ships, a user can run `afk-loop watch --focus 42` and see the full acceptance-criteria list for issue 42 with per-AC timing and state.

### Acceptance criteria

- [ ] `[cli]` `afk-loop watch --focus N` flag parses the issue number and passes it to the renderer
- [ ] `[watcher]` focus renderer shows the issue title + full AC list (titles, states, RED/GREEN timestamps) for one issue
- [ ] `[watcher]` focus renderer prints "issue #N is not in flight" and exits if the target isn't currently in-flight
- [ ] `[tests]` vitest covers `--focus` flag parsing and renderer output for both in-flight and not-in-flight cases

### Blocked by

- #3

---

## #5 — Surface run-scoped failures in the dashboard header

**Type:** AFK

### Parent

`docs/prd-watch-command.md`

### What to build

Extend `status.json` so the orchestrator records the run-scoped state needed for header banners — `runState`, `rateLimitedUntil`, `runtimeBudgetHours`, `runtimeElapsedHours`, and `lastEventAt`. The dashboard's header bar then overrides the normal "iter X · running · Yh / Zh budget" line with a banner whenever the run is unhealthy: rate-limited, cycle-aborted, stale (no event in 5+ minutes while supposedly running), or done.

User opens `afk-loop watch` after stepping away and immediately sees, at the top, `⚠ RATE-LIMITED until 15:42` or `✗ STALE (last event 12m ago — orchestrator may have crashed)`. They don't sit watching a dashboard that looks fine but isn't.

### Outcome

After this slice ships, a user opening `afk-loop watch` sees an immediate header banner whenever the run is paused, stale, aborted, or done — instead of staring at a frozen dashboard.

### Acceptance criteria

- [ ] `[orchestrator]` `status.json` carries `runState`, `rateLimitedUntil`, `runtimeBudgetHours`, `runtimeElapsedHours`, `lastEventAt` consistently across all phases
- [ ] `[watcher]` header banner shows `⚠ RATE-LIMITED until <ts>` when `runState=paused`
- [ ] `[watcher]` header banner shows `✗ CYCLE DETECTED — run aborted` when run aborted with cycle reason
- [ ] `[watcher]` header banner shows `✗ STALE` when `lastEventAt` is older than 5 minutes while `runState=running`
- [ ] `[tests]` vitest covers each banner override case + `runState=done` static-frame behavior

### Blocked by

- #1

---

## #6 — Dump error reasons and log paths on `l` keypress

**Type:** AFK

### Parent

`docs/prd-watch-command.md`

### What to build

Add a hotkey handler to the watcher: pressing `l` exits alt-screen, prints each failed issue's reason and log path to terminal scrollback, and quits. Pressing `q` quits without printing anything (the existing behavior). Critical because alt-screen wipes on quit — without `l`, a user who spotted an error in the ERRORS section loses the path the moment they press `q`.

User opens `afk-loop watch`, sees `⚠ #40 reviewer refused: AC3 unverified · logs/issue-40/reviewer-iter-1.jsonl` in the ERRORS section, presses `l`, the dashboard exits to a normal terminal with that line printed in scrollback, ready to `cat` or open the log.

### Outcome

After this slice ships, a user can press `l` while in `afk-loop watch` to dump failed issues' error reasons and log paths to terminal scrollback before quitting.

### Acceptance criteria

- [ ] `[watcher]` pressing `l` exits alt-screen and prints each failed issue's reason + log path to scrollback before quitting
- [ ] `[watcher]` pressing `q` exits alt-screen without printing errors
- [ ] `[tests]` vitest with simulated stdin asserts both keypress behaviors

### Blocked by

- #2
