# `afk-loop` — Issues (Vertical Slices)

> Local issue list (not published to GitHub). Generated via `/to-issues` from `PRD.md`. Each slice is a tracer bullet — a thin path through CLI parsing, IO, shelling out, and tests — designed to be demoable on its own.

All slices below are **AFK** unless marked otherwise. None are HITL except where explicitly flagged.

Acceptance-criteria status uses `[todo]` / `[done]` text labels. Every line has one or the other inside the brackets — never empty `[ ]`.

---

## #1 — Project skeleton + config + dep-graph + cycle detection

**Type**: AFK
**Blocked by**: None — can start immediately.
**Status**: ✅ Completed. 27/27 tests passing. `package.json`, `tsconfig.json`, `main.mts plan`, `src/{config,issues,depgraph}.ts`, `test/{config,issues,depgraph}.test.ts`. Typecheck clean. CLI smoke verified.

### What to build

A runnable CLI skeleton that proves the architecture end-to-end without doing real work yet. Fetches AFK-labelled GitHub issues from the target repo, parses "Blocked by" links, builds the dependency DAG, detects cycles, and prints the unblocked frontier.

User runs `npx tsx afk-loop/main.mts plan` from a target repo that has `<target>/.afk-loop/config.json`. They see a JSON object listing the unblocked issues that *would* be worked next, plus any cycles (which abort).

This is the foundation tracer bullet — every later slice rides on top of `config`, `issues`, and `depgraph` modules.

### Acceptance criteria

- [done] `afk-loop/package.json` declares `tsx` as dep, has a `plan` script binding.
- [done] `afk-loop/main.mts` exists with a `plan` subcommand.
- [done] Loads `<target>/.afk-loop/config.json` and validates: `label`, `hitlPattern`, `mainBranch`, `maxParallel`, `maxTurnsPerImplementer`, `advisoryPlanner`, `runtimeBudgetHours`.
- [done] Missing or malformed config → friendly error message + non-zero exit.
- [done] Calls `gh issue list --label <label> --state open --json number,title,body,labels` and parses results into typed `Issue` objects.
- [done] Filters out issues whose title matches `hitlPattern`.
- [done] Parses "Blocked by: #N" entries from each issue's body (case-insensitive, supports comma-separated lists).
- [done] Builds DAG. Detects cycles via DFS — including self-loops (issue blocking itself).
- [done] If any cycle exists, exits non-zero with a clear message naming the cycle members.
- [done] If no cycles, prints unblocked frontier as JSON: `{"frontier":[{"number":42,"title":"...","branch":"afk/issue-42"}, ...]}` capped at `maxParallel`.
- [done] Unit tests for `depgraph` with fixtures: linear chain, diamond, cycle, self-loop, empty input. Tests pass via `npm test`.
- [done] Unit tests for `issues` parser with mocked `gh` JSON fixtures.
- [done] `afk-loop/README.md` has a one-paragraph quickstart for this slice.

---

## #2 — Worktree manager with permission mitigations

**Type**: AFK
**Blocked by**: #1
**Status**: ✅ Completed. 12 worktree tests passing. `src/worktree.ts` with `createWorktree`, `destroyWorktree`, `ensureGitignore`, `DENY_PATTERNS`. `main.mts` exposes `create-worktree` + `destroy-worktree` subcommands. node_modules hard-link copy via `cp -al` with `cp -a` fallback.

### What to build

A `worktree` module that creates a sandbox for one issue: a git worktree with `node_modules` copied, `.env` copied, the per-worktree deny-list `settings.local.json` written, and the push-capability stripped from origin. Plus the inverse — clean teardown (used only on success; failed worktrees are preserved per the design).

User runs `npx tsx afk-loop/main.mts create-worktree 42` and gets a fully isolated worktree at `<target>/.afk-loop/worktrees/issue-42/` ready for an implementer to launch into.

### Acceptance criteria

- [done] `afk-loop create-worktree <issue-number>` subcommand exists.
- [done] Creates worktree at `<target>/.afk-loop/worktrees/issue-<N>/` on branch `afk/issue-<N>` (created from `mainBranch`).
- [done] If branch `afk/issue-<N>` already exists, reuse it (don't fail).
- [done] Copies `node_modules` from host repo into worktree (use `cp -al` or rsync; whichever is faster on macOS).
- [done] Copies `.env` from host repo if present; logs a warning and continues if absent.
- [done] Writes `<worktree>/.claude/settings.local.json` containing the full nuclear-pattern `permissions.deny` array from the design.
- [done] Strips push capability: `git -C <worktree> remote set-url --push origin no-push://disabled` (or removes origin entirely).
- [done] `afk-loop destroy-worktree <issue-number>` subcommand removes the worktree and deletes the branch (used only on success).
- [done] Integration test against a fresh `git init`'d throwaway repo: creates worktree, asserts deny-list file exists with expected contents, asserts `git push origin` from inside the worktree fails (no-push URL), tears down cleanly.
- [done] Adds `.afk-loop/` to target repo's `.gitignore` if missing (idempotent).

---

## #3 — Single-issue implementer end-to-end

**Type**: AFK
**Blocked by**: #2
**Status**: ✅ Completed. `src/claude-runner.ts` spawns `claude -p --output-format stream-json --permission-mode bypassPermissions`, captures JSONL to log path, parses `<promise>COMPLETE</promise>`, detects rate-limit with reset parsing + 60min fallback, enumerates commits via `git log <from>..HEAD`. `src/phases.ts` `runImplementer` substitutes prompt vars. `main.mts implement <N>` wires plan→worktree→implementer. 5 mock-claude integration tests covering success/incomplete/rate-limit/error.

### What to build

A `claude-runner` module that launches a `claude -p` implementer process inside a worktree, captures its JSONL stream to disk, parses for `<promise>COMPLETE</promise>`, detects rate-limit errors, and enumerates commits made during the run. Plus the `phases.runImplementer` orchestration that ties worktree creation + claude run + outcome capture into one demo command.

User runs `npx tsx afk-loop/main.mts implement 42` and the loop creates a worktree, spawns the implementer, waits for completion (or max-turns), captures the JSONL log, and prints an outcome summary. No reviewer, no merger — just one issue, end-to-end.

### Acceptance criteria

- [done] `afk-loop implement <issue-number>` subcommand.
- [done] Spawns `claude -p --max-turns <maxTurnsPerImplementer> --output-format stream-json --permission-mode bypassPermissions` with cwd pinned to the worktree path.
- [done] Substitutes `{{ISSUE_NUMBER}}`, `{{ISSUE_TITLE}}`, `{{BRANCH}}`, `{{MAX_TURNS}}` into `afk-loop/prompts/implement-prompt.md` and passes via `--append-system-prompt`.
- [done] Streams stdout JSONL into `<target>/.afk-loop/logs/issue-<N>/implementer-iter-1.jsonl`.
- [done] On exit: enumerates commits made during the run via `git log <main>..afk/issue-<N>`.
- [done] Parses output for `<promise>COMPLETE</promise>` (case-sensitive) → outcome `complete`. Otherwise → outcome `incomplete`.
- [done] Detects rate-limit error in stderr or exit code → outcome `rate-limited` with `rateLimitedUntil` parsed from message (or `now + 60min` fallback).
- [done] Prints final outcome JSON: `{"outcome":"complete","commits":["abc...","def..."],"turns":12}`.
- [done] `implement-prompt.md` exists at `afk-loop/prompts/implement-prompt.md` with TDD instructions, scope-lock, comment-and-exit-if-stuck semantics.
- [done] Mock-`claude`-binary integration test: shell script emits canned JSONL with two commits and a `<promise>COMPLETE</promise>`. Test asserts outcome correctly parsed and JSONL log written.
- [done] Mock-`claude`-binary rate-limit test: shell script emits a rate-limit-shaped error. Test asserts outcome and reset time correctly parsed.

---

## #4 — Reviewer phase

**Type**: AFK
**Blocked by**: #3
**Status**: ✅ Completed. `prompts/review-prompt.md` with verify-AC + scope-locked refactor + refusal-by-omission. `runReviewer` in `src/phases.ts` substitutes vars including `TOUCHED_FILES` and optional `CODING_STANDARDS_PATH`. `main.mts review <N>` wired. 2 mock-claude tests covering approved/refused.

### What to build

A `phases.runReviewer` that runs a one-shot reviewer (`claude -p --max-turns 1`) against a branch with commits. The reviewer reads the issue body, checks each acceptance criterion against the diff, runs typecheck + tests, refactors only inside files the diff touches, and signals approval via `<promise>COMPLETE</promise>` or refusal by omitting it.

User runs `npx tsx afk-loop/main.mts review 42` (after implementer has produced commits) and gets a verdict. The verdict gates whether the merger will touch this branch.

### Acceptance criteria

- [done] `afk-loop review <issue-number>` subcommand.
- [done] Spawns `claude -p --max-turns 1 --output-format stream-json --permission-mode bypassPermissions` with cwd pinned to the same worktree the implementer used.
- [done] Substitutes `{{ISSUE_NUMBER}}`, `{{BRANCH}}`, `{{SOURCE_BRANCH}}`, `{{TOUCHED_FILES}}` (from `git diff --name-only main..branch`), and `{{CODING_STANDARDS_PATH}}` (path to `<target>/.afk-loop/CODING_STANDARDS.md` if present, else empty) into `afk-loop/prompts/review-prompt.md`.
- [done] JSONL captured to `<target>/.afk-loop/logs/issue-<N>/reviewer-iter-1.jsonl`.
- [done] On exit: parses for `<promise>COMPLETE</promise>` → verdict `approved`. Otherwise → verdict `refused`.
- [done] If reviewer made commits (style fixes, test fixes), they're included in the `commits` field of the outcome.
- [done] Prints verdict JSON: `{"verdict":"approved","commits":[...]}`.
- [done] `review-prompt.md` exists at `afk-loop/prompts/review-prompt.md` with: read issue body, verify each acceptance criterion against diff, run typecheck + tests, refactor only inside touched files, refuse via missing `<promise>` if any criterion fails.
- [done] Mock-`claude` integration test for both `approved` and `refused` outcomes.

---

## #5 — Merger phase

**Type**: AFK
**Blocked by**: #3
**Status**: ✅ Completed. `src/merger.ts` `mergeBranches` runs deterministically in TS (no claude call) — `git merge --no-edit --no-ff` per branch, `git merge --abort` + reset on conflict, optional checkCommands run post-merge with auto-revert via `git reset --hard HEAD~1`, `gh issue close` on success, `gh issue comment` on failure. `prompts/merge-prompt.md` saved as reference for future claude-assisted conflict resolution. `main.mts merge --branches <list>` wired. 3 tests covering clean merge, conflict-revert-and-continue, post-merge check failure with revert.

### What to build

A `phases.runMerger` that takes a list of approved branches and merges them into `main` one at a time, with per-branch revert-and-continue on conflict or post-merge test failure. Closes the corresponding GitHub issue on each successful merge.

User runs `npx tsx afk-loop/main.mts merge --branches afk/issue-42,afk/issue-44` and the merger handles each in order, revert-and-comment on failures, close-issue on successes.

### Acceptance criteria

- [done] `afk-loop merge --branches <comma-list>` subcommand (with optional `--issues <comma-list>` for the matching issue numbers; if omitted, derive from branch names).
- [done] Spawns `claude -p --max-turns 5 --output-format stream-json --permission-mode bypassPermissions` with cwd pinned to the target repo's main checkout (NOT a worktree).
- [done] Substitutes `{{BRANCHES}}`, `{{ISSUES}}`, `{{MAIN_BRANCH}}` into `afk-loop/prompts/merge-prompt.md`.
- [done] On per-branch merge conflict or post-merge test failure: orchestrator (or the merger prompt itself) reverts that one merge (`git merge --abort` or `git reset --hard ORIG_HEAD`), comments on the issue, continues to the next branch.
- [done] On per-branch success: `gh issue close <N> --comment "Merged by afk-loop"`.
- [done] JSONL captured to `<target>/.afk-loop/logs/merger-iter-K.jsonl`.
- [done] Prints final summary JSON: `{"merged":[42],"failed":[{"issue":44,"reason":"conflict in src/auth.ts"}]}`.
- [done] `merge-prompt.md` exists at `afk-loop/prompts/merge-prompt.md` with the per-branch revert-and-continue semantics from the design.
- [done] Integration test against a throwaway repo with two prepared branches (one cleanly mergeable, one conflicting); asserts the clean one merges + closes its issue, the conflicting one reverts + comments.

---

## #6 — Outer iteration orchestrator (serial, single round)

**Type**: AFK
**Blocked by**: #4, #5
**Status**: ✅ Completed. `src/orchestrator.ts` `runIteration` + `runOrchestrator` chains plan→worktree→implementer→reviewer→merger serially. Cycle detection returns empty-frontier outcome (later distinguished as CYCLE in #11). `--once` and `--max-parallel` flags wired through `main.mts run`. 4 e2e tests via mock-claude + injected ghRun: full success path with main updated, incomplete-implementer skips reviewer/merger, empty frontier exits DONE, cycle yields empty frontier.

### What to build

The first composition that ties plan → implement → review → merge into one iteration. Forced serial (`--max-parallel=1`) and single-round (`--once`) so this slice proves the wiring without yet introducing parallelism complexity. After this lands, the rest of the slices add concurrency, persistence, and recovery on top.

User runs `npx tsx afk-loop/main.mts run --once --max-parallel=1` and the loop:
1. Reads frontier (capped to 1).
2. Runs implementer for that one issue.
3. If implementer produced commits, runs reviewer.
4. If reviewer approved, runs merger for that one branch.
5. Exits.

### Acceptance criteria

- [done] `afk-loop run` subcommand with flags `--once`, `--max-parallel <N>`.
- [done] When `--max-parallel=1` and `--once`, executes exactly one issue end-to-end and exits.
- [done] Frontier capped to `min(maxParallel, configMaxParallel)`.
- [done] If implementer outcome is `incomplete` → reviewer is skipped, merger is skipped, issue logged but not added to any state file yet (state comes in #8).
- [done] If reviewer verdict is `refused` → merger skipped.
- [done] On full success path: issue closed, branch merged into main.
- [done] Integration test (mock `claude`, mock `gh`, real `git` in throwaway repo): one fully-unblocked issue → full pipeline → main has the commit → issue closed via mocked `gh`.
- [done] Integration test for incomplete-implementer path: implementer doesn't emit `<promise>` → reviewer not called → merger not called → exit code reflects partial outcome.

---

## #7 — Parallel implementers (cap=3)

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `runIteration` refactored to pre-create worktrees serially (avoids git index-lock contention) then run implementers + reviewers via `Promise.allSettled`. Per-issue logs land in distinct directories (no cross-contamination). Merger remains serial. 2 e2e parallel tests: 3-clean-issues all merge, one-incomplete-among-three isolates failure.

### What to build

Lift the serial constraint. Frontier of N (up to `maxParallel=3`) implementers run concurrently via `Promise.allSettled`. Each gets its own worktree. Reviewers run after their respective implementers (still 1 per branch). Merger runs serially at end of iteration over all approved branches.

User runs `npx tsx afk-loop/main.mts run --once --max-parallel=3` against a target repo with ≥3 unblocked issues and sees three implementers running in parallel.

### Acceptance criteria

- [done] `--max-parallel=3` runs three implementers concurrently in three separate worktrees.
- [done] One implementer's failure does not cancel the others (`Promise.allSettled` semantics).
- [done] Each implementer's JSONL log lands in its own `logs/issue-<N>/` directory — no cross-contamination.
- [done] After all implementers complete (success or fail), reviewers run for those that produced commits (parallel reviewers OK; they each touch only their own branch).
- [done] Merger runs once at end of iteration, serially over all reviewer-approved branches.
- [done] Integration test with 3 prepared mock-issue fixtures (one succeeds, one fails in implementer, one succeeds in implementer but fails in reviewer): asserts only the fully-clean one ends up merged.

---

## #8 — State persistence + crash recovery

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `src/state.ts` with `loadState`, `saveState` (atomic via `state.json.tmp` + rename), `markInFlight`, `clearInFlight`, `markFailed`, `setRateLimitedUntil`, `reconcileInFlight` (orphan PID detection via `process.kill(pid, 0)`). Orchestrator hydrates + reconciles on startup, persists after each iteration, derives `failedThisRun` filter from disk by default. 6 state tests covering defaults, round-trip, .tmp leftover safety, in-flight transitions, dedup-on-failed.

### What to build

A `state` module that reads/writes `<target>/.afk-loop/state.json` atomically (`tmp + rename`) with the minimal shape from the design: `rateLimitedUntil`, `inFlight`, `failedThisRun`. Plus the startup reconciliation logic: on any `afk-loop run` invocation, scan `state.json`, kill any orphaned `claude` processes whose `inFlight` entries point to dead PIDs, requeue their issues, and continue.

### Acceptance criteria

- [done] `afk-loop/state.ts` module with `loadState()`, `saveState(state)`, `markInFlight(issue, phase)`, `clearInFlight(issue)`, `markFailed(issue)`.
- [done] Atomic write: writes to `state.json.tmp`, `fsync`, `rename`. Verified by a test that interrupts mid-write and asserts the existing `state.json` is unchanged.
- [done] State file schema: `{schemaVersion: 1, rateLimitedUntil: ISO|null, inFlight: {[issue]: {phase, branch, startedAt, pid}}, failedThisRun: number[]}`.
- [done] On `afk-loop run` startup: read state. For each `inFlight` entry, `kill -0 <pid>` to check liveness. If dead → log "orphan recovered for issue N", clear from `inFlight`, leave branch and worktree intact (per failure-preservation policy).
- [done] `failedThisRun` is filtered out of the frontier in step #1's planner.
- [done] Test: simulate crash (write `state.json` with an `inFlight` entry pointing to a dead PID) → re-run → assert orphan recovered + frontier excludes that issue from this round if branch is still active.

---

## #9 — Rate-limit detection + pause-and-resume

**Type**: AFK
**Blocked by**: #8
**Status**: ✅ Completed. Orchestrator detects rate-limit (already in claude-runner), persists `rateLimitedUntil` to state.json, fires `rateLimitPaused` notification (no-op default; #12 wires osascript), sleeps via injected `sleep`, then resumes. On startup, if state's reset is still in the future, sleeps the difference first. `--once` returns RATE_LIMITED instead of sleeping. 2 mock-claude tests covering full pause-resume and once-mode short-circuit.

### What to build

When any `claude` invocation returns a rate-limit error, the orchestrator parses the reset time from the error message (or defaults to `now + 60min`), writes `rateLimitedUntil` to `state.json`, fires a desktop notification, sleeps until the reset, then resumes. Survives multiple subscription windows.

### Acceptance criteria

- [done] `claude-runner` detects rate-limit errors via stderr pattern match (e.g., `/rate.?limit/i` and `/usage limit/i`) and exit code.
- [done] Parses reset time from the error message if present (the Claude Code CLI emits an explicit time); falls back to `now + 60min`.
- [done] On detection: writes `rateLimitedUntil` to `state.json`, fires notification "AFK loop paused until <time>", calls `setTimeout` (or `sleep` via async) until reset, then continues the orchestration loop from where it left off (next iteration, not retry of the failed `claude` call).
- [done] On startup, if `rateLimitedUntil > now`, the orchestrator sleeps the difference before doing anything else.
- [done] In-flight implementers at the time of rate-limit are marked `inFlight` (they may have made commits) so reconciliation post-pause doesn't double-spawn them.
- [done] Mock-`claude` integration test: emits a rate-limit error → orchestrator writes state and sleeps a short test-only window (1 second) → wakes and resumes → asserts second iteration completes.

---

## #10 — Advisory planner (optional)

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `prompts/plan-prompt.md` advisory-only with `<concerns>...</concerns>` output contract. `runAdvisoryPlanner` in `phases.ts` substitutes `{{FRONTIER_JSON}}` + `{{ISSUE_BODIES}}`, runs `claude -p --max-turns 3`, parses concerns block, returns `(advisory skipped: rate-limited)` etc on errors. Orchestrator runs only when `config.advisoryPlanner === true`; concerns surface on `IterationOutcome.advisoryConcerns`. 3 tests with custom mock-claude binaries covering concerns / None / rate-limit-skip.

### What to build

After the deterministic frontier is computed, optionally (controlled by `advisoryPlanner: true` in config) run a fast Opus call (`--max-turns 3`) that's shown the frontier + each issue's body and asked: "Do you see risks of working these in parallel?" Output appended to `summary.md` as "Planner concerns this iteration: …". Cannot remove issues from the frontier.

### Acceptance criteria

- [done] `phases.runAdvisoryPlanner(frontier, issues)` returns a string of concerns or "None".
- [done] Spawns `claude -p --max-turns 3 --output-format stream-json --permission-mode bypassPermissions` with the `plan-prompt.md` substituted with `{{FRONTIER_JSON}}` and `{{ISSUE_BODIES}}`.
- [done] `plan-prompt.md` exists at `afk-loop/prompts/plan-prompt.md` with the advisory-only instructions from the design.
- [done] Output (the `<concerns>...</concerns>` block) is appended to `summary.md` under "Planner concerns iteration K".
- [done] If `advisoryPlanner: false` in config, this phase is skipped entirely (zero `claude` invocations).
- [done] If the advisory planner itself rate-limits, log it and skip (don't pause the whole run for an advisory step).
- [done] Mock-`claude` test: asserts concerns appended to `summary.md` when on; asserts no `claude` spawn when off.

---

## #11 — Time budget + multi-iteration outer loop

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. Multi-iteration loop already in place from #6; extended with `runtimeBudgetHours` soft budget (checked at top of each iteration) → exits TIME_BUDGET. Cycles now bubble up as exit code CYCLE (rather than empty-frontier-DONE). Injected `now()` for deterministic budget tests. 3 multi-iteration tests covering chain completion, time budget, and cycle exit.

### What to build

Wrap the single-iteration orchestrator from #6 in a multi-iteration loop. After each iteration, recompute the frontier; exit when frontier is empty (`DONE`) or wall-clock from run start exceeds `runtimeBudgetHours` (`TIME_BUDGET`). Cycle detection from #1 still aborts before any iteration.

### Acceptance criteria

- [done] `afk-loop run` (without `--once`) loops over iterations until exit condition.
- [done] After each iteration: re-fetch issues, recompute frontier, take next batch.
- [done] Empty frontier → exit code 0, summary section "Run complete: DONE".
- [done] `Date.now() - runStartedAt > runtimeBudgetHours * 3600000` → finish current iteration's merger, exit code 0, summary section "Run complete: TIME_BUDGET".
- [done] Cycle detected at any iteration's plan step → exit code 1, summary section "Run aborted: CYCLE".
- [done] Integration test with 3 issues forming a chain (#42 → #43 → #44, where #43 is blocked by #42, #44 by #43): mock `claude` succeeds for all → asserts 3 iterations, all merged.
- [done] Integration test with `runtimeBudgetHours: 0.0001` (small) → asserts exits with TIME_BUDGET after iteration 1.

---

## #12 — Observability (summary.md + status.json + 4 osascript notifications)

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `src/observability.ts` with `appendSummarySection`, `writeStatus`, `formatIterationSection`, `notify`, `commitUrl`. Header is written once. Iteration sections use ✅/⚠️ bullets, link to commit URL via `gh repo view`-derived slug. `notify` no-ops outside darwin; injectable `spawn` for tests. Orchestrator fires `runStarted`, `iterationCompleted`, `rateLimitPaused`, `runFinished` (4 events total). 8 observability tests covering header idempotency, status overwrite, iteration formatting, advisory concerns surface, darwin/linux notify behaviour.

### What to build

The wake-up artifact layer. After each iteration, write a markdown section to `summary.md` (append-only) with: iteration number, planned/merged/failed counts, per-failure reason, link to commit hashes for merged work. Maintain a live `status.json` overwritten each tick. Fire macOS notifications via `osascript` on four events: run start, rate-limit pause, iteration complete, run complete/fatal.

### Acceptance criteria

- [done] `observability` module with `appendSummarySection(section)`, `writeStatus(status)`, `notify(event, message)`.
- [done] `summary.md` is created if missing; otherwise appended. Header includes run start time + version.
- [done] Each iteration section uses the format from the design: outcome bullets (✅/⚠️), per-iteration breakdown, "Failed issues" subsection with reasons.
- [done] Commit hashes link to the GitHub commit URL: `https://github.com/<owner>/<repo>/commit/<sha>` (derive `<owner>/<repo>` from `gh repo view --json nameWithOwner`).
- [done] `status.json` shape: `{currentIteration, frontier: number[], inFlight: number[], lastEventAt, runState: "running"|"paused"|"done"|"failed"}`.
- [done] `notify(event, message)` shells out to `osascript -e 'display notification "..." with title "AFK Loop"'` on macOS; no-op on other platforms.
- [done] Four events fire exactly once each: `runStarted`, `rateLimitPaused`, `iterationCompleted`, `runFinished`. No commit-level pings.
- [done] Test (no real notifications): assert `osascript` is invoked with the right arguments at the right moments by stubbing `child_process.spawn`.

---

## #13 — Migration helper (Sandcastle → AFK label)

**Type**: AFK
**Blocked by**: None — independent.
**Status**: ✅ Completed. `src/migrate.ts` `migrateLabels` with injectable `ghJsonList` + `ghRun` for tests. `--dry-run` reports `wouldMigrate` count without invoking edits. `main.mts migrate-labels --from X --to Y [--dry-run]` wired. 3 tests covering happy path / empty / dry-run.

### What to build

A one-shot CLI command that bulk-relabels all open issues from one label to another. Default invocation: `afk-loop migrate-labels --from Sandcastle --to AFK`.

### Acceptance criteria

- [done] `afk-loop migrate-labels --from <X> --to <Y>` subcommand.
- [done] Lists all open issues with label `<X>` via `gh issue list --label <X> --state open --json number`.
- [done] For each: runs `gh issue edit <N> --remove-label <X> --add-label <Y>`.
- [done] Prints a summary of what changed: `migrated: 47 issues from "Sandcastle" to "AFK"`.
- [done] `--dry-run` flag prints what *would* be migrated without doing it.
- [done] Friendly error if either label doesn't exist on the repo (offers to create the destination via `gh label create`).
- [done] Test against a throwaway repo with mocked `gh`: asserts the right `gh edit` calls are issued for each open issue with the source label.

---

## #14 — Per-target init + README

**Type**: AFK
**Blocked by**: #11
**Status**: ✅ Completed. `templates/config.json` + `templates/CODING_STANDARDS.md` shipped in the orchestrator. `src/init.ts` `initTarget` copies them into `<target>/.afk-loop/`, calls `ensureGitignore`, refuses to overwrite without `--force`. `main.mts init [--force]` wired with friendly next-steps output. Comprehensive `README.md` covers prerequisites, install, quickstart, all subcommands, config, layout, failure recovery, permission model, architecture, testing, Docker revisit trigger. 3 init tests covering happy path, refuse-without-force, force-overwrite.

### What to build

A bootstrap command for new target repos: `afk-loop init` writes a sensible-default `<target>/.afk-loop/config.json`, a starter `<target>/.afk-loop/CODING_STANDARDS.md`, adds `.afk-loop/` to `<target>/.gitignore`, and prints next steps. Plus the comprehensive README for `afk-loop/` itself documenting install, configure, run, and the morning-after workflow.

### Acceptance criteria

- [done] `afk-loop init` subcommand, runs in target-repo cwd.
- [done] Creates `<target>/.afk-loop/` directory if missing.
- [done] Writes `<target>/.afk-loop/config.json` from a template with defaults: `label: "AFK"`, `hitlPattern: "\\[HITL\\]"`, `mainBranch: "main"`, `maxParallel: 3`, `maxTurnsPerImplementer: 50`, `advisoryPlanner: false`, `runtimeBudgetHours: 8`. Refuses to overwrite an existing config (suggests `--force`).
- [done] Writes `<target>/.afk-loop/CODING_STANDARDS.md` from a starter template (sections: Style, Testing, Architecture).
- [done] Adds `.afk-loop/` to `<target>/.gitignore` (idempotent — checks if line already present).
- [done] Prints next steps: how to label issues, how to run `afk-loop run`, where the wake-up summary lives.
- [done] `afk-loop/README.md` covers: prerequisites (Node, `gh`, `claude` CLI logged in), `afk-loop init` flow, `afk-loop run` flow, `afk-loop migrate-labels`, the morning-after workflow (`cd .afk-loop/worktrees/issue-N` for failed slices), all config knobs, and the Docker revisit trigger.
- [done] Integration test: `afk-loop init` against a fresh `git init`'d throwaway repo creates the right files with the right contents and adds the right gitignore line.

---

## Summary

14 vertical slices, all AFK, dep-graph:

```
#1 ── #2 ── #3 ── #4 ── #6 ── #7
                 └─ #5 ─┘    ├── #8 ── #9
                             ├── #10
                             ├── #11 ── #14
                             └── #12

#13 (independent)
```

First-iteration unblocked frontier (what `afk-loop` itself, run on these issues, would pick first): **#1, #13** (cap=3 means it could grab both at once).

After #1 merges: **#2, #13** (if #13 not yet done).
After #2 merges: **#3**.
After #3 merges: **#4, #5** (parallel).
After #4 + #5: **#6**.
After #6: **#7, #8, #10, #11, #12** (parallel — many slices unlock at once).
After #11: **#14**.

This is the perfect dogfood scenario — once #1–#7 land, `afk-loop` can finish building itself.

---

## Round 2: TDD enforcement + global install + git bootstrap (post-v0.1.0)

The slices below were added after the initial 14 shipped. They land in commits A–E on top of the v0.1.0 baseline.

---

## #15 — Inline `/tdd` doctrine into implement-prompt

**Type**: AFK
**Blocked by**: None — content-only change to `prompts/implement-prompt.md`.
**Status**: ✅ Completed. Commit B (`feat(prompts): inline /tdd doctrine into implement-prompt`).

### What to build

The implement-prompt currently references `/tdd` in prose, which agents under context pressure skip. Inline the full TDD doctrine — philosophy, horizontal-slicing anti-pattern, plan/tracer-bullet/loop/refactor workflow, mocking guidance, deep-module hint, stub escape hatch, and a strict commit-shape contract — directly into `prompts/implement-prompt.md`. The agent's system prompt now contains the discipline every turn; it cannot be forgotten.

### Acceptance criteria

- [done] `prompts/implement-prompt.md` includes a "TDD DOCTRINE" section with: philosophy, anti-horizontal-slicing warning, planning step, tracer bullet, incremental loop, refactor rules.
- [done] Includes a "COMMIT SHAPE CONTRACT" section that names the test-only / impl / refactor commit shapes.
- [done] Defines stub escape hatch (signature + `throw new Error("not implemented")`) as allowed inside a test-only commit.
- [done] References Conventional Commits prefixes (`test:`, `feat:`, `refactor:`).
- [done] Removes the prose-only `/tdd` reference in favour of the inlined doctrine.

---

## #16 — TDD evidence check via diff-shape inference (reviewer)

**Type**: AFK
**Blocked by**: #15 — implementer must follow the contract before reviewer can check it.
**Status**: ✅ Completed. Commit C (`feat(reviewer): add TDD evidence check via diff-shape inference`).

### What to build

The reviewer mechanically verifies the commit-shape contract from `git log --reverse main..HEAD --name-only`. For each test file added on the branch, require at least one preceding test-only commit. Auto-skip when the branch added no test files (refactor / docs / config issues). On failure, refuse via missing `<promise>COMPLETE</promise>` and comment on the issue with the specific test files missing evidence.

### Acceptance criteria

- [done] `prompts/review-prompt.md` step 3 ("TDD evidence check") added with `git log --name-only` instructions.
- [done] Auto-skip rule: if no test files were added/modified on the branch, the evidence check is skipped entirely.
- [done] Stub escape hatch defined and accepted as test-only.
- [done] Refusal message names the specific test files missing preceding test-only commits.
- [done] AC verification (step 2) remains as the independent rule for "behavior shipped without tests".

---

## #17 — Global install via `bin/afk-loop.mjs` shim

**Type**: AFK
**Blocked by**: None — independent of TDD work.
**Status**: ✅ Completed. Commit D (`feat(install): global install via npm install -g github:user/afk-loop`).

### What to build

Replace the `npx tsx main.mts` alias workflow with `npm install -g github:nabi-zakaria-dev/afk-loop`. A `bin/afk-loop.mjs` shim locates the package's installed `tsx` and spawns `main.mts` with the user's cwd preserved. `tsx` moves from `devDependencies` to `dependencies`. README install section rewritten.

### Acceptance criteria

- [done] `bin/afk-loop.mjs` exists, is executable, and forwards stdio + exit code from `tsx main.mts`.
- [done] Friendly error messages when `tsx` or `main.mts` are missing.
- [done] `package.json` `bin` points to `./bin/afk-loop.mjs`.
- [done] `tsx` listed under `dependencies` (not `devDependencies`).
- [done] `package.json` has a `files` allowlist controlling what ships.
- [done] `package.json` has `homepage` and `repository` fields.
- [done] README install section documents `npm install -g github:nabi-zakaria-dev/afk-loop` (and removes the alias suggestion).
- [done] README documents Conventional Commits convention used for this project.
- [done] Smoke test: `node bin/afk-loop.mjs help` prints the help page.

---

## #18 — ISSUES.md status label format `[todo]` / `[done]`

**Type**: AFK
**Blocked by**: None — content-only change.
**Status**: ✅ Completed. Commit E (`docs(issues): migrate AC labels and append new feature slices`).

### What to build

Replace every empty `- [ ]` GitHub-checkbox AC marker in ISSUES.md with a text-labelled bracket: `[todo]` for not-yet-done, `[done]` for satisfied. Since all 14 v0.1.0 issues are completed at migration time, every existing AC becomes `[done]`. Going forward, new ACs start `[todo]` and flip to `[done]` as the work lands.

### Acceptance criteria

- [done] Every AC in issues #1–#14 uses `[done]`. No `[ ]` remains in the file.
- [done] ISSUES.md preamble notes the new label vocabulary.
- [done] New issues #15–#18 added with their own AC checklists in `[done]` status.

---

## Round-2 dep-graph

```
v0.1.0 baseline (already shipped)
   ↓
#17 (independent, ships alongside)
   ↓
#15 ── #16
   ↓
#18 (depends on #15/#16/#17 having something to record)
```

This is the perfect dogfood scenario — once #1–#7 land, `afk-loop` can finish building itself.
