# `afk-loop`

Personal AFK orchestrator that takes vertical-slice GitHub issues produced by `/grill-with-docs` → `/to-prd` → `/to-issues` and implements them in parallel using Claude Code (subscription, no API key). Walk away from the laptop, come back to a `summary.md` that tells you whether to celebrate or investigate.

See `DESIGN.md` for the full architecture. See `PRD.md` for the problem statement and user stories. See `ISSUES.md` for the implementation slices and their status.

## Prerequisites

- Node.js ≥ 22 + npm
- `gh` CLI authenticated against the target repo (`gh auth login`)
- `claude` CLI logged into your Claude Code subscription
- macOS for desktop notifications (no-op elsewhere)
- A target GitHub repo with issues labelled `AFK` (or your custom label)

## Install

```bash
git clone <this-repo>  # or wherever afk-loop lives
cd afk-loop
npm install
```

There is no global install. You invoke `afk-loop` via `npx tsx /path/to/afk-loop/main.mts <subcommand>` from inside the target repo.

For convenience add a shell alias:

```bash
alias afk-loop='npx tsx /Users/you/projects/afk-loop/main.mts'
```

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
├── status.json             # live status (overwritten each tick)
├── logs/issue-N/*.jsonl    # JSONL streams from `claude -p --output-format stream-json`
└── worktrees/issue-N/      # git worktree, branch=afk/issue-N
```

`.afk-loop/` is added to your repo's `.gitignore` automatically by `afk-loop init`.

## Failure recovery (the morning workflow)

When `summary.md` lists `⚠️` issues:

1. Read the per-issue JSONL log: `.afk-loop/logs/issue-N/implementer-iter-1.jsonl` (and `reviewer-iter-1.jsonl` if it ran). `grep '"name":"Bash"'` to see every shell command executed.
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

The orchestrator is a single-file ~600 LOC TS module driven by composable phases:

```
plan (deterministic dep-graph)
   ↓
[advisory planner — optional, never overrides]
   ↓
implementer × N  (parallel, in worktrees)
   ↓
reviewer × M     (parallel, M ≤ N)
   ↓
merger           (serial, into main, revert-and-continue per branch)
   ↓
state + summary + status + notification
```

See `DESIGN.md` for the full decision tree.

## Testing

```bash
npm test           # one-shot
npm run test:watch # vitest watch mode
npm run typecheck
```

Tests use `mkTmpRepo` (a fresh `git init`'d throwaway dir) and a mock `claude` shell script that emits canned JSONL events. No real `claude`, `gh`, or GitHub state is touched during tests.

## Status of the implementation

See `ISSUES.md` for the per-slice breakdown. All 14 vertical slices complete with passing tests.

## Revisit-Docker trigger

If across ~10 real overnight runs anything destructive happens — even once — switch the implementer to run inside Docker. Until then, host-only is the right trade-off for a personal tool on your own laptop.
