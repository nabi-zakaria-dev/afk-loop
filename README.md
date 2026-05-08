# `afk-loop`

Personal AFK orchestrator that takes vertical-slice GitHub issues produced by `/grill-with-docs` → `/to-prd` → `/to-issues` and implements them in parallel using Claude Code (subscription, no API key). Walk away from the laptop, come back to a `summary.md` that tells you whether to celebrate or investigate.

See `DESIGN.md` for the full architecture, `PRD.md` for the problem statement and user stories, `ISSUES.md` for the implementation slices and their status, `CONTEXT.md` for the domain glossary, and `docs/adr/` for architectural decisions.

## Prerequisites

- Node.js ≥ 22 + npm
- `gh` CLI authenticated against the target repo (`gh auth login`)
- `claude` CLI logged into your Claude Code subscription
- macOS for desktop notifications (no-op elsewhere)
- A target GitHub repo with issues labelled `AFK` (or your custom label)

## Install

Globally from GitHub:

```bash
npm install -g github:nabi-zakaria-dev/afk-loop
```

This puts `afk-loop` on your `PATH`. You can now run `afk-loop <subcommand>` from inside any target repo.

To update:

```bash
npm install -g github:nabi-zakaria-dev/afk-loop
```

(Same command — npm refreshes from main.)

To uninstall:

```bash
npm uninstall -g afk-loop
```

### Local development install

If you cloned this repo and want to test changes locally:

```bash
git clone https://github.com/nabi-zakaria-dev/afk-loop
cd afk-loop
npm install
npm link
```

`npm link` symlinks the local checkout as the global `afk-loop`. Edits to source take effect immediately — no rebuild.

## Quickstart

In the target repo (e.g. `krilidar`):

```bash
cd /path/to/krilidar
afk-loop init
# edit .afk-loop/config.json if defaults need tuning
# edit .afk-loop/CODING_STANDARDS.md with your conventions

# (one-shot) migrate existing labels from sandcastle convention
afk-loop migrate-labels --from Sandcastle --to AFK

# preview which issues would run (no work done)
afk-loop plan

# go AFK
afk-loop run
```

Wake up. Read `.afk-loop/summary.md`. Investigate any `⚠️` lines. The successes are already merged to `main` and have their issues closed.

## Subcommands

| Command | What it does |
|---|---|
| `afk-loop init` | Bootstrap `.afk-loop/` in the target repo (config + standards template + .gitignore). |
| `afk-loop plan` | Print the unblocked frontier as JSON. No side effects. |
| `afk-loop create-worktree <N>` | Create a sandboxed git worktree for issue #N at `.afk-loop/worktrees/issue-N/`. Copies node_modules, copies .env, writes deny-list, strips push remote. |
| `afk-loop destroy-worktree <N>` | Remove the worktree and delete the AFK branch (only on success — failed work is preserved). |
| `afk-loop implement <N>` | Run the implementer end-to-end for one issue. Outputs JSON outcome (`complete` / `incomplete` / `rate-limited` / `error`). |
| `afk-loop review <N>` | Run the reviewer on the issue's existing AFK branch. Outputs `approved` or `refused`. |
| `afk-loop merge --branches <list>` | Merge approved AFK branches into main, with per-branch revert-and-continue on conflict. Closes issues on success. |
| `afk-loop run [--once] [--max-parallel N]` | The full orchestration loop. Default: parallel cap 3, multi-iteration, 8h time budget, rate-limit pause-and-resume. |
| `afk-loop watch [--focus <N>]` | Live progress dashboard. Alt-screen TTY view of the running loop, refreshed every 3s from `.afk-loop/status.json`. `q` quits, `l` dumps the error list to scrollback before quitting. |
| `afk-loop migrate-labels --from <X> --to <Y> [--dry-run]` | Bulk-relabel open issues. |
| `afk-loop help` | Show the help message. |

## Configuration

`<target>/.afk-loop/config.json`:

```json
{
  "label": "AFK",
  "hitlPattern": "\\[HITL\\]",
  "mainBranch": "main",
  "maxParallel": 3,
  "maxTurnsPerImplementer": 50,
  "advisoryPlanner": false,
  "runtimeBudgetHours": 8
}
```

| Field | Meaning |
|---|---|
| `label` | GitHub label identifying AFK-eligible issues. |
| `hitlPattern` | Regex applied to issue titles; matching issues are excluded from the frontier. |
| `mainBranch` | Branch the merger merges into. |
| `maxParallel` | Cap on concurrent implementers per iteration. Subscription rate limits make >3 risky. |
| `maxTurnsPerImplementer` | `--max-turns` passed to each `claude -p` implementer call. Hitting this is a "this slice is under-scoped" signal. |
| `advisoryPlanner` | When true, run a fast Opus advisory check after the deterministic frontier is picked. Concerns appended to `summary.md`; cannot override the frontier. |
| `runtimeBudgetHours` | Soft wall-clock budget. When exceeded, the loop finishes its current iteration then exits with `TIME_BUDGET`. |

## Layout (in the target repo)

```
<target>/.afk-loop/
├── config.json
├── CODING_STANDARDS.md     # optional, reviewer reads if present
├── state.json              # rateLimitedUntil, inFlight, failedThisRun
├── summary.md              # append-only run log — wake-up artifact
├── status.json             # live status (overwritten each phase boundary; consumed by `afk-loop watch`)
├── logs/issue-N/*.jsonl    # JSONL streams from `claude -p --output-format stream-json`
└── worktrees/issue-N/      # git worktree, branch=afk/issue-N
```

`.afk-loop/` is added to your repo's `.gitignore` automatically by `afk-loop init`.

## Live progress dashboard (`afk-loop watch`)

`afk-loop run` is designed to be left alone — you walk away and read `summary.md` later. But there's a gap between "running" and "done" where you might want a quick glance at how things are going. That's what `afk-loop watch` is for.

In any target repo where the loop is running:

```bash
afk-loop watch
```

The terminal switches to an alt-screen buffer (your scrollback is preserved) and renders a dashboard that refreshes every 3 seconds reading from `.afk-loop/status.json`. Example frame:

```
afk-loop · iter 2 · running
#42 [impl] Display pending invoices · 1/3 · AC2 RED · 1m 12s
#43 [review] Cancel a subscription · 5/5 · 3m 47s
QUEUE (1)
  #44 Send invoice reminder
RECENT
  ✅ #41 merged · https://github.com/.../commit/abc123
ERRORS (1)
  ⚠ #40 reviewer-refused: AC3 unverified · .afk-loop/logs/issue-40/
```

What each section shows:

- **Header**: iteration number and run state. Overrides for unhealthy run-scoped states:
  - `⚠ RATE-LIMITED until <ts>` when paused on subscription rate limit.
  - `✗ CYCLE DETECTED — run aborted` when the dep-graph has a cycle.
  - `✗ STALE` when no event has fired for >5 minutes while supposedly running (orchestrator may have crashed).
  - `✅ run complete — see summary.md` when the run is `done`.
- **In-flight**: one row per issue currently being worked. Format: `#N [phase] title · ACs/total · ACx STATE · elapsed`. Phase is `impl` / `review` / `merge`. AC progress is sourced from `git log` of the issue's worktree, mapping `test:` → RED and `feat:`/`fix:` → GREEN per acceptance criterion (see TDD section below for the `[AC N]` commit-tag convention this relies on).
- **QUEUE**: open AFK-eligible issues that aren't currently in-flight or failed.
- **RECENT**: issues merged successfully during this run, with commit URLs.
- **ERRORS**: issues that failed during this run, with reason and path to the `.afk-loop/logs/issue-N/` JSONL stream so you can investigate.

### Hotkeys

- `q` — exit alt-screen, return to your terminal as it was.
- `l` — exit alt-screen and dump the ERRORS section (issue + reason + log path) to scrollback before quitting. Useful when you spotted a failure and want the path preserved after the dashboard closes.

### `--focus <issue>`

Zoom into one issue's full acceptance-criteria list:

```bash
afk-loop watch --focus 42
```

Shows the issue's title and every AC with its layer tag, current state (`pending` / `red` / `green` / `refactored`), and RED/GREEN timestamps. If `#N` isn't currently in-flight, the dashboard prints `issue #N is not in flight` and exits.

### When status.json is missing

If you run `afk-loop watch` from a directory with no `.afk-loop/status.json` (e.g. before you've ever run the loop), it prints `no run in progress` and exits 0 — no error, no alt-screen flash. Useful for tooling and for distinguishing "loop never ran" from "loop crashed mid-run."

### Granularity caveat

AC progress in the dashboard updates at **phase boundaries** (implementer-start, reviewer-start, merger-start), not every 3 seconds. The 3-second refresh re-reads `status.json` but the underlying AC state only changes when the orchestrator writes a new frame. Mid-implementer commits land in the worktree's git history but don't surface until the implementer phase completes. Live mid-flight polling is a planned follow-up; for now, expect AC counts to jump at boundary transitions.

## TDD discipline (mechanical, not advisory)

Every implementer is instructed via inlined doctrine in `prompts/implement-prompt.md` to follow Test-Driven Development with a strict commit shape:

1. **RED** — write one failing test, commit a *test-only* commit (or test + stub-escape-hatch).
2. **GREEN** — write the implementation, commit a non-test-source commit.
3. **REFACTOR (optional)** — clean up only files this issue touched, commit.
4. Repeat per acceptance criterion.

Each commit subject also carries an `[AC N]` tag (e.g. `feat: detect cycles [AC 2] (#42)`) where `N` is the 1-based index of the acceptance criterion. The `afk-loop watch` dashboard reads these tags to show live AC progress per in-flight issue. Without the tag, AC mapping falls back to positional pairing of `test:` and `feat:`/`fix:` commits — correct only when the discipline is followed strictly.

The reviewer (`prompts/review-prompt.md`) **mechanically verifies the discipline from artifacts** — it runs `git log --reverse main..HEAD --name-only` and refuses any branch where a test file lacks a preceding test-only commit. Auto-skipped for non-behavioral branches (refactor / docs / config) where no test files were added or modified.

This was the result of a deliberate design trade-off — see `docs/adr/0001-inline-tdd-doctrine-and-artifact-evidence.md`.

## Failure recovery (the morning workflow)

When `summary.md` lists `⚠️` issues (or `afk-loop watch` shows them in the ERRORS section):

1. Read the per-issue JSONL log: `.afk-loop/logs/issue-N/implementer-iter-1.jsonl` (and `reviewer-iter-1.jsonl` if it ran). `grep '"name":"Bash"'` to see every shell command executed. Tip: while in `afk-loop watch`, press `l` to dump the failed issues' reasons and log paths to scrollback before quitting — the path is right there, ready to `cat` or open.
2. The branch and worktree are preserved. Pick up where the loop got stuck:
   ```bash
   cd .afk-loop/worktrees/issue-N
   claude
   ```
3. The issue itself has a comment from the agent explaining what it tried and where it got stuck. Look there first.
4. When fixed, push to main yourself (or run `afk-loop merge --branches afk/issue-N` if you want the merger's verification + auto-close).

## Permission model & safety

Every `claude` invocation runs with `--permission-mode bypassPermissions` so the loop never stalls on a permission prompt overnight. To keep that bounded:

- **Per-worktree deny-list** at `<worktree>/.claude/settings.local.json` blocks: `rm -rf /`, `rm -rf ~`, `sudo *`, `git push --force*`, `curl|sh`, `npm publish`, `gh release create`, etc.
- **Pinned cwd**: every `claude` process is spawned with cwd inside its worktree. The agent never runs in the bare target repo.
- **Push-stripped remotes**: implementer worktrees have `git remote set-url --push origin no-push://disabled`. Only the merger (running in the main checkout under the merge prompt) ever modifies main.
- **Audit trail**: every tool call lands in JSONL logs. `grep '"name":"Bash"' .afk-loop/logs/issue-N/*.jsonl` reconstructs everything that ran.

If anything destructive happens even once, switch to Docker. Until then, host-only is the right trade-off.

## Architecture

The orchestrator is composable phases:

```
plan (deterministic dep-graph)
   ↓
[advisory planner — optional, never overrides]
   ↓
implementer × N  (parallel, in worktrees, with TDD)
   ↓
reviewer × M     (parallel, M ≤ N; verifies AC + TDD evidence)
   ↓
merger           (serial, into main, revert-and-continue per branch)
   ↓
state + summary + status + notification
```

See `DESIGN.md` for the full decision tree.

## Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature or capability (typically GREEN commits in TDD).
- `fix:` — bug fix.
- `refactor:` — internal restructure, no behavior change.
- `test:` — test-only change (RED commits in TDD).
- `docs:` — README, ADR, comments only.
- `chore:` — build, deps, tooling.

Optional scope: `feat(reviewer):`, `fix(worktree):`.

Granularity: one logical change per commit. RED test, GREEN impl, and REFACTOR are typically three separate commits — the same shape the reviewer mechanically verifies on AFK branches.

## Testing

```bash
npm test           # one-shot
npm run test:watch # vitest watch mode
npm run typecheck
```

Tests use `mkTmpRepo` (a fresh `git init`'d throwaway dir) and a mock `claude` shell script that emits canned JSONL events. No real `claude`, `gh`, or GitHub state is touched during tests.

## Status

See `ISSUES.md` for the per-slice breakdown. All initial 14 vertical slices complete with passing tests; subsequent feature commits land per the Conventional Commits convention above.

## Revisit-Docker trigger

If across ~10 real overnight runs anything destructive happens — even once — switch the implementer to run inside Docker. Until then, host-only is the right trade-off for a personal tool on your own laptop.
