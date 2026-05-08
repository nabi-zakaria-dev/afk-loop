# `afk-loop` — Design

Personal AFK orchestrator that takes vertical-slice issues from `/to-issues` and implements them in parallel overnight, surviving rate-limit windows and producing a readable wake-up summary.

## Goals

- Drop sandcastle entirely. No `@ai-hero/sandcastle` dependency, no Docker.
- Use Claude Code subscription via `claude -p` shelling out (no `ANTHROPIC_API_KEY`).
- Implement parallel vertical-slice issues with their declared "Blocked by" graph respected.
- Survive subscription rate-limit windows by pausing and resuming.
- Produce a single morning artifact (`summary.md`) that tells me whether to celebrate or investigate.
- Preserve all evidence (logs, branches, worktrees) for issues that fail, so I can pick up where the loop got stuck.
- Stay small enough to maintain alone (~250 LOC orchestrator + 4 prompts).

## Non-goals (now)

- Docker / VM isolation. Revisit after ~10 real overnight runs if anything destructive happens.
- Multi-repo orchestration.
- Auto-PR + auto-merge-if-CI-green. The user picked auto-merge to main.
- Web UI / TUI dashboard.
- Slack/email notifications. macOS desktop notifications only.

---

## Architecture

- Custom Node/TypeScript orchestrator. Single file `afk-loop/main.mts`, ~250 lines.
- Host-only execution. Each implementer runs as a `claude -p` subprocess in a git worktree on the host.
- Project-portable: orchestrator runs in target-repo cwd, reads `<target>/.afk-loop/config.json`.
- Uses `gh` CLI for issue queries, `git` for worktrees, `claude` for the agentic work.

## Per-target-repo layout (gitignored)

```
<target>/.afk-loop/
├── config.json              # see below
├── CODING_STANDARDS.md      # optional, reviewer reads if present
├── state.json               # { rateLimitedUntil, inFlight, failedThisRun }
├── summary.md               # append-only run log — the wake-up artifact
├── status.json              # live status (overwritten each tick), for tooling
├── logs/issue-N/*.jsonl     # JSONL streams from `claude -p --output-format stream-json`
└── worktrees/issue-N/       # git worktree, branch=afk/issue-N, .env + node_modules copied
```

`config.json` shape:

```json
{
  "label": "AFK",
  "hitlPattern": "\\[HITL\\]",
  "mainBranch": "main",
  "maxParallel": 3,
  "maxTurnsPerImplementer": 50,
  "advisoryPlanner": true,
  "runtimeBudgetHours": 8
}
```

---

## Loop (per outer iteration)

1. **Parse issues**: `gh issue list --label AFK --state open --json number,title,body,labels`. Exclude titles matching `hitlPattern`. Build dep-graph from "Blocked by: #N" entries in issue bodies. **Detect cycles → abort and notify.**
2. **Pick frontier**: unblocked issues NOT in `failedThisRun`, capped at `maxParallel` (3).
3. **Advisory planner** *(optional, off by default; on for KriliDar)*: Opus, `--max-turns 3`, fed the frontier + issue bodies, asked for risks of working in parallel (file overlap, schema collisions, test interactions). Output appended to `summary.md` as "Planner concerns this iteration: …". **Never overrides** the deterministic frontier.
4. **Spawn implementers**: 3 worktrees, 3 `claude -p --max-turns 50 --permission-mode bypassPermissions` processes in parallel. Each agent uses TDD via `/tdd` and is scope-locked to one issue.
5. **Review** (per branch with commits): `claude -p --max-turns 1` reviewer. Verifies acceptance criteria against the diff, runs typecheck + tests, refactors only inside files the issue's diff already touches. Refuses by omitting `<promise>COMPLETE</promise>` → merger skips this branch.
6. **Merge**: one merger agent. `git merge --no-edit` each completed branch into `main`, in deterministic order. On per-branch conflict / test-fail: `git merge --abort` (or `git reset --hard HEAD`), comment on the issue, **continue with the next branch**. On success: `gh issue close <ID>`.
7. **Persist**: write `state.json`, append `summary.md`, update `status.json`, fire `osascript` notification.

## Termination

- Empty frontier → done (`DONE`).
- Wall-clock exceeds `runtimeBudgetHours` → finish current iteration, exit (`TIME_BUDGET`).
- Cycle detected at startup → abort before any work, notify (`CYCLE`).

## Rate-limit handling (pause-and-resume)

- Detect rate-limit error from `claude` stderr / exit code.
- Parse the reset time if present in the error message; otherwise default to 60 minutes.
- Write `rateLimitedUntil` to `state.json`, fire pause notification, `sleep` until then.
- On wake, reload state, reconcile `inFlight` (kill orphaned `claude` processes, requeue their issues), resume.
- Survives crossing multiple subscription windows.

## State persistence (`state.json`)

```json
{
  "schemaVersion": 1,
  "rateLimitedUntil": "2026-05-08T15:30:00Z",
  "inFlight": {
    "42": { "phase": "implementer", "branch": "afk/issue-42", "startedAt": "..." }
  },
  "failedThisRun": [41]
}
```

Atomic write: `state.json.tmp` → `fsync` → `rename`. Source-of-truth for rate-limit only; everything else (closed issues, branches on main) is derived from `gh` and `git`.

## Failure semantics

- **Implementer fails** (max turns hit, error exit) → reviewer is *not* run. Branch and worktree preserved. Issue gets a comment from the implementer. Issue added to `failedThisRun`. Merger skips it.
- **Reviewer refuses** (typecheck/test still failing OR acceptance criterion unmet) → branch preserved. Issue commented. Merger skips.
- **Merger conflict on a single branch** → revert that one merge, comment on issue, continue with the rest.
- **`gh` or `git` itself fails** → bubble up, write state, exit non-zero. Loud death.

Failed worktrees and branches are **kept** so the morning workflow is `cd .afk-loop/worktrees/issue-N && claude` to pick up where the loop got stuck.

## Permission model — fully AFK on the host

- Every `claude` invocation runs with `--permission-mode bypassPermissions`. No prompts can stall the loop overnight.
- Each worktree gets a `<worktree>/.claude/settings.local.json` with a `permissions.deny` array for nuclear patterns:
  ```json
  { "permissions": { "deny": [
    "Bash(rm -rf /)", "Bash(rm -rf ~)", "Bash(sudo *)",
    "Bash(git push --force*)", "Bash(git push -f*)",
    "Bash(curl * | sh)", "Bash(curl * | bash)",
    "Bash(npm publish*)", "Bash(gh release create*)"
  ]}}
  ```
- Orchestrator spawns each `claude` process with `cwd` pinned to the worktree path. No agent ever runs in the bare target repo.
- Before each implementer launches, orchestrator strips push capability inside its worktree (`git remote set-url --push origin invalid` or remove origin). Only the merger — running in the main checkout under the merger prompt — touches main.
- Every tool call is captured in the per-issue JSONL log. Post-mortem is `grep '"name":"Bash"' .afk-loop/logs/issue-N/*.jsonl`.

**Revisit-Docker trigger**: after ~10 real overnight runs, if anything destructive happens even once, switch to Docker. Until then, host-only.

## Concurrency & rate budget

- `maxParallel = 3` implementers per iteration. Frontier larger than 3 → take first 3 (lowest issue number); others wait for next iteration.
- `maxTurnsPerImplementer = 50`. Hitting 50 = "this slice is under-scoped" signal. Implementer leaves a comment, exits without `COMPLETE`, merger skips, issue lands in `failedThisRun`.
- One reviewer turn per branch, ~30s each. One merger run per iteration.
- Dimensioned to fit ~1 iteration per Opus 5-hour rate window, comfortably.

## Observability

- **Per-issue logs**: `<target>/.afk-loop/logs/issue-N/{implementer,reviewer}-iter-K.jsonl`. JSONL events from `claude -p --output-format stream-json`. Greppable.
- **`summary.md`** (append-only): the wake-up artifact. Markdown, scannable, sections per iteration, links to commit hashes for merged work, full per-issue failure reasons. Designed so the *first thing read* answers "celebrate or investigate?".
- **`status.json`** (overwritten live): for any future tooling (`afk-loop status`, TUI). Current iteration, frontier, in-flight, last event timestamp.
- **macOS desktop notifications via `osascript`** — four events only:
  1. Run started (frontier size + ETA).
  2. Rate-limit pause (until time + duration).
  3. Iteration complete (merged / failed counts).
  4. Run complete or fatal (totals).
  No commit-level pings.

## Prompts

Live in `afk-loop/prompts/` (orchestrator owns workflow; same prompts for every target repo). `CODING_STANDARDS.md` lives per-target.

- **`plan-prompt.md`** — advisory only. Receives the deterministic frontier + issue bodies, flags risks, never overrides.
- **`implement-prompt.md`** — TDD via `/tdd` skill, scope-locked to one issue, comment-and-exit if stuck, output `<promise>COMPLETE</promise>` on done.
- **`review-prompt.md`** — verify each acceptance criterion against the diff, run typecheck + tests, fix failures, refactor only inside touched files. Refuse via missing `<promise>` on failure.
- **`merge-prompt.md`** — per-branch revert-and-continue on conflict, close issues on success.

## Loop invocation (the `claude -p` shape)

```
claude -p \
  --max-turns 50 \
  --output-format stream-json \
  --permission-mode bypassPermissions \
  --append-system-prompt "$(cat afk-loop/prompts/implement-prompt.md | substitute)" \
  "Work on issue #42 on branch afk/issue-42"
```

Run inside `cwd: <worktree-path>`. JSONL events captured to log file. On exit:
- Stdout/stderr scanned for `<promise>COMPLETE</promise>`.
- New commits enumerated via `git log <main>..HEAD`.
- Rate-limit error pattern matched if exit non-zero.

## Migration helper (one-shot)

```
gh issue list --label Sandcastle --state open --json number -q '.[].number' \
  | xargs -I{} gh issue edit {} --remove-label Sandcastle --add-label AFK
```

Wrapped as `afk-loop migrate-labels --from Sandcastle --to AFK` for convenience.

## Init helper

`afk-loop init` (run inside target repo) writes:
- `<target>/.afk-loop/config.json` from a template
- `<target>/.afk-loop/CODING_STANDARDS.md` from a template
- Adds `.afk-loop/` to `<target>/.gitignore` if missing

## Open items deferred

- **Port collisions for test servers**: if KriliDar's tests spin up `next dev` or shared DB, parallel worktrees collide. Solve with a per-worktree port offset (`PORT=$((3000 + ISSUE_NUMBER % 100))` injected into env) only if it actually breaks. Not solving a hypothetical.
- **Stuck-loop recovery via fresh-session retry**: if the reviewer rejects an implementer, the next round could respawn the implementer with the rejection feedback prepended. Not in v1.
- **Generalisation to non-Node projects**: today the worktree seeding assumes `node_modules`. Make seedable steps configurable when the second project actually appears.
