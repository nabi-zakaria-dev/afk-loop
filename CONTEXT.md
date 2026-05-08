# CONTEXT — `afk-loop`

Domain glossary for the AFK orchestrator. Terms here are used consistently across `DESIGN.md`, `PRD.md`, `ISSUES.md`, prompts in `prompts/`, and source in `src/`. When you read or write about this project, use this vocabulary.

## Workflow

**AFK orchestrator** — the `afk-loop` tool itself. Spawns parallel implementer agents in git worktrees, runs reviewers, merges to main, and survives subscription rate-limit windows. Distinct from "the AFK label", below.

**Pre-coding workflow** — the upstream chain of skills that produces the issues `afk-loop` consumes: `/grill-with-docs` → `/to-prd` → `/to-issues`. Sometimes preceded by `/zoom-out`. The output is a set of GitHub issues with structured "Blocked by" annotations and AFK/HITL classification.

## Issues

**AFK issue** — a GitHub issue labelled `AFK` (configurable via `config.label`) and not marked `[HITL]` in the title. Eligible for unattended implementation.

**HITL issue** — Human-In-The-Loop. Marked by the `[HITL]` substring (configurable via `config.hitlPattern`) in the issue title. Excluded from the AFK frontier; requires human attention (architectural decisions, design reviews, anything that benefits from synchronous discussion).

**Vertical slice / Tracer bullet** — an issue that delivers a narrow but complete path through every layer (schema, API, UI, tests). Demoable on its own. Produced by `/to-issues`. Contrasts with horizontal slices (one layer at a time), which `afk-loop` is not designed for.

**Behavioral issue** — an AFK issue whose acceptance criteria require new code paths and tests. Detection rule (used by reviewer): the AFK branch added or modified at least one test file.

**Non-behavioral issue** — an AFK issue whose work is refactor-only, docs-only, or config-only and produces no new tests. Detection rule: the AFK branch added/modified no test files. The TDD evidence check is auto-skipped for these; the AC verification rule still applies.

**Frontier** — the set of currently unblocked AFK issues, capped at `config.maxParallel`. Computed deterministically by parsing each issue body's "Blocked by" entries against the open-issue set. Issues in `state.failedThisRun` are filtered out.

## Phases

**Implementer** — `claude -p --max-turns 50` agent that works one issue end-to-end inside a dedicated worktree. Uses TDD (red-green-refactor). Single-issue scope. Outputs `<promise>COMPLETE</promise>` on success or leaves a comment and exits.

**Reviewer** — `claude -p --max-turns 1` agent that verifies the implementer's branch before merge. Reads the diff, runs typecheck + tests, verifies each acceptance criterion against the diff, performs the **TDD evidence check** (below), and refuses by omitting `<promise>COMPLETE</promise>`. Allowed to refactor only inside the touched-files set.

**Merger** — deterministic TypeScript loop (no Claude call) that merges approved branches into `main` with per-branch revert-and-continue on conflict or post-merge test failure. Closes the GitHub issue on success, comments on the issue on failure. Runs once per outer iteration.

**Advisory Planner** — optional `claude -p --max-turns 3` Opus call that reviews the deterministic frontier for risks (file overlap, schema collisions, test interactions) and surfaces concerns into `summary.md`. Cannot remove or reorder issues from the frontier. Off by default; on for projects where main-branch safety justifies the rate-limit cost.

## TDD discipline

**TDD evidence** — a verifiable property of an AFK branch's commit history. For each test file added or modified on the branch, there must exist at least one *test-only commit* (a commit whose entire diff touches only test files, optionally including a "stub escape hatch" file) that is parented before any commit that introduces the corresponding non-test source code. Verified mechanically by the reviewer via `git log --reverse main..HEAD --name-only`. No commit-message tags required — the inspection is artifact-based.

**Stub escape hatch** — a source file consisting only of function/class signatures with `throw new Error("not implemented")` bodies, allowed inside an otherwise test-only commit when the test cannot import without the stub existing. Lets RED commits reference modules that don't yet have implementations.

**Test-only commit** — a commit whose `--name-only` diff matches one of: (a) only paths ending in `.test.ts` / `.test.tsx` / `.test.js` / `.test.jsx`, (b) only paths under a top-level `test/` or `tests/` directory, (c) a mix of (a)/(b) plus stub-escape-hatch files.

**Horizontal slicing** — the anti-pattern of writing all tests first, then all implementation. Produces "tests of imagined behavior" that pass when behavior breaks and fail when behavior is fine. The TDD evidence rule mechanically prevents this by requiring per-acceptance-criterion test-then-impl ordering.

## Sandbox

**Worktree** — a git worktree at `<target>/.afk-loop/worktrees/issue-<N>/` on branch `afk/issue-<N>`, created from `config.mainBranch`. Has `node_modules` hard-linked from host, `.env` copied, deny-list `settings.local.json` written, and push capability stripped (`origin` URL set to `no-push://disabled`). Implementers and reviewers run with `cwd` pinned to this path.

**Deny-list** — the set of nuclear shell patterns blocked in every worktree's `.claude/settings.local.json`: `rm -rf /`, `rm -rf ~`, `sudo *`, `git push --force*`, `curl|sh`, `npm publish*`, `gh release create*`, etc. Mitigates the blast radius of `--permission-mode bypassPermissions`.

**Failure preservation** — when a slice fails (implementer doesn't complete, reviewer refuses, merge conflicts), the worktree and branch are *not* cleaned up. The morning workflow is `cd <target>/.afk-loop/worktrees/issue-N && claude` to pick up where the loop got stuck.

## Run lifecycle

**Iteration** — one cycle of plan → (advisory) → implementers → reviewers → merger. Multiple iterations run in sequence until the frontier is empty (`DONE`), the wall-clock budget is exceeded (`TIME_BUDGET`), a cycle is detected (`CYCLE`), or rate-limit-with-`--once` is hit (`RATE_LIMITED`).

**Pause-and-resume** — when the implementer or reviewer detects a Claude rate-limit error, the orchestrator persists `rateLimitedUntil` to `state.json`, fires a `rateLimitPaused` notification, sleeps until reset, and continues from the next iteration. Survives crossing multiple subscription windows.

**Time budget** — soft wall-clock cap from `config.runtimeBudgetHours` (default 8). Checked at the top of each iteration; if exceeded, the loop finishes its current iteration and exits with `TIME_BUDGET`.

**State.json** — minimal persisted state at `<target>/.afk-loop/state.json`. Three fields: `rateLimitedUntil` (ISO or null), `inFlight` (issue → phase + branch + startedAt + pid for orphan recovery), `failedThisRun` (issue numbers excluded from this run's frontier). All other state (closed issues, branches on main) is derived from `gh` and `git`.

## The AFK label vs the AFK orchestrator

These collide unfortunately. To disambiguate:

- "**The AFK label**" or "**`AFK` label**" refers to the GitHub label string (default `AFK`, configurable). Used to mark eligible issues.
- "**The AFK orchestrator**" or "**`afk-loop`**" refers to the tool itself.

Never write "the AFK runs" or "AFK ran the issues" — say "the orchestrator" or "the loop".
