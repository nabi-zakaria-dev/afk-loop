# `afk-loop` — Issues (Vertical Slices)

> Local issue list (not published to GitHub). Generated via `/to-issues` from `PRD.md`. Each slice is a tracer bullet — a thin path through CLI parsing, IO, shelling out, and tests — designed to be demoable on its own.

All slices below are **AFK** unless marked otherwise. None are HITL except where explicitly flagged.

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

- [ ] `afk-loop/package.json` declares `tsx` as dep, has a `plan` script binding.
- [ ] `afk-loop/main.mts` exists with a `plan` subcommand.
- [ ] Loads `<target>/.afk-loop/config.json` and validates: `label`, `hitlPattern`, `mainBranch`, `maxParallel`, `maxTurnsPerImplementer`, `advisoryPlanner`, `runtimeBudgetHours`.
- [ ] Missing or malformed config → friendly error message + non-zero exit.
- [ ] Calls `gh issue list --label <label> --state open --json number,title,body,labels` and parses results into typed `Issue` objects.
- [ ] Filters out issues whose title matches `hitlPattern`.
- [ ] Parses "Blocked by: #N" entries from each issue's body (case-insensitive, supports comma-separated lists).
- [ ] Builds DAG. Detects cycles via DFS — including self-loops (issue blocking itself).
- [ ] If any cycle exists, exits non-zero with a clear message naming the cycle members.
- [ ] If no cycles, prints unblocked frontier as JSON: `{"frontier":[{"number":42,"title":"...","branch":"afk/issue-42"}, ...]}` capped at `maxParallel`.
- [ ] Unit tests for `depgraph` with fixtures: linear chain, diamond, cycle, self-loop, empty input. Tests pass via `npm test`.
- [ ] Unit tests for `issues` parser with mocked `gh` JSON fixtures.
- [ ] `afk-loop/README.md` has a one-paragraph quickstart for this slice.

---

## #2 — Worktree manager with permission mitigations

**Type**: AFK
**Blocked by**: #1
**Status**: ✅ Completed. 12 worktree tests passing. `src/worktree.ts` with `createWorktree`, `destroyWorktree`, `ensureGitignore`, `DENY_PATTERNS`. `main.mts` exposes `create-worktree` + `destroy-worktree` subcommands. node_modules hard-link copy via `cp -al` with `cp -a` fallback.

### What to build

A `worktree` module that creates a sandbox for one issue: a git worktree with `node_modules` copied, `.env` copied, the per-worktree deny-list `settings.local.json` written, and the push-capability stripped from origin. Plus the inverse — clean teardown (used only on success; failed worktrees are preserved per the design).

User runs `npx tsx afk-loop/main.mts create-worktree 42` and gets a fully isolated worktree at `<target>/.afk-loop/worktrees/issue-42/` ready for an implementer to launch into.

### Acceptance criteria

- [ ] `afk-loop create-worktree <issue-number>` subcommand exists.
- [ ] Creates worktree at `<target>/.afk-loop/worktrees/issue-<N>/` on branch `afk/issue-<N>` (created from `mainBranch`).
- [ ] If branch `afk/issue-<N>` already exists, reuse it (don't fail).
- [ ] Copies `node_modules` from host repo into worktree (use `cp -al` or rsync; whichever is faster on macOS).
- [ ] Copies `.env` from host repo if present; logs a warning and continues if absent.
- [ ] Writes `<worktree>/.claude/settings.local.json` containing the full nuclear-pattern `permissions.deny` array from the design.
- [ ] Strips push capability: `git -C <worktree> remote set-url --push origin no-push://disabled` (or removes origin entirely).
- [ ] `afk-loop destroy-worktree <issue-number>` subcommand removes the worktree and deletes the branch (used only on success).
- [ ] Integration test against a fresh `git init`'d throwaway repo: creates worktree, asserts deny-list file exists with expected contents, asserts `git push origin` from inside the worktree fails (no-push URL), tears down cleanly.
- [ ] Adds `.afk-loop/` to target repo's `.gitignore` if missing (idempotent).

---

## #3 — Single-issue implementer end-to-end

**Type**: AFK
**Blocked by**: #2
**Status**: ✅ Completed. `src/claude-runner.ts` spawns `claude -p --output-format stream-json --permission-mode bypassPermissions`, captures JSONL to log path, parses `<promise>COMPLETE</promise>`, detects rate-limit with reset parsing + 60min fallback, enumerates commits via `git log <from>..HEAD`. `src/phases.ts` `runImplementer` substitutes prompt vars. `main.mts implement <N>` wires plan→worktree→implementer. 5 mock-claude integration tests covering success/incomplete/rate-limit/error.

### What to build

A `claude-runner` module that launches a `claude -p` implementer process inside a worktree, captures its JSONL stream to disk, parses for `<promise>COMPLETE</promise>`, detects rate-limit errors, and enumerates commits made during the run. Plus the `phases.runImplementer` orchestration that ties worktree creation + claude run + outcome capture into one demo command.

User runs `npx tsx afk-loop/main.mts implement 42` and the loop creates a worktree, spawns the implementer, waits for completion (or max-turns), captures the JSONL log, and prints an outcome summary. No reviewer, no merger — just one issue, end-to-end.

### Acceptance criteria

- [ ] `afk-loop implement <issue-number>` subcommand.
- [ ] Spawns `claude -p --max-turns <maxTurnsPerImplementer> --output-format stream-json --permission-mode bypassPermissions` with cwd pinned to the worktree path.
- [ ] Substitutes `{{ISSUE_NUMBER}}`, `{{ISSUE_TITLE}}`, `{{BRANCH}}`, `{{MAX_TURNS}}` into `afk-loop/prompts/implement-prompt.md` and passes via `--append-system-prompt`.
- [ ] Streams stdout JSONL into `<target>/.afk-loop/logs/issue-<N>/implementer-iter-1.jsonl`.
- [ ] On exit: enumerates commits made during the run via `git log <main>..afk/issue-<N>`.
- [ ] Parses output for `<promise>COMPLETE</promise>` (case-sensitive) → outcome `complete`. Otherwise → outcome `incomplete`.
- [ ] Detects rate-limit error in stderr or exit code → outcome `rate-limited` with `rateLimitedUntil` parsed from message (or `now + 60min` fallback).
- [ ] Prints final outcome JSON: `{"outcome":"complete","commits":["abc...","def..."],"turns":12}`.
- [ ] `implement-prompt.md` exists at `afk-loop/prompts/implement-prompt.md` with TDD instructions, scope-lock, comment-and-exit-if-stuck semantics.
- [ ] Mock-`claude`-binary integration test: shell script emits canned JSONL with two commits and a `<promise>COMPLETE</promise>`. Test asserts outcome correctly parsed and JSONL log written.
- [ ] Mock-`claude`-binary rate-limit test: shell script emits a rate-limit-shaped error. Test asserts outcome and reset time correctly parsed.

---

## #4 — Reviewer phase

**Type**: AFK
**Blocked by**: #3
**Status**: ✅ Completed. `prompts/review-prompt.md` with verify-AC + scope-locked refactor + refusal-by-omission. `runReviewer` in `src/phases.ts` substitutes vars including `TOUCHED_FILES` and optional `CODING_STANDARDS_PATH`. `main.mts review <N>` wired. 2 mock-claude tests covering approved/refused.

### What to build

A `phases.runReviewer` that runs a one-shot reviewer (`claude -p --max-turns 1`) against a branch with commits. The reviewer reads the issue body, checks each acceptance criterion against the diff, runs typecheck + tests, refactors only inside files the diff touches, and signals approval via `<promise>COMPLETE</promise>` or refusal by omitting it.

User runs `npx tsx afk-loop/main.mts review 42` (after implementer has produced commits) and gets a verdict. The verdict gates whether the merger will touch this branch.

### Acceptance criteria

- [ ] `afk-loop review <issue-number>` subcommand.
- [ ] Spawns `claude -p --max-turns 1 --output-format stream-json --permission-mode bypassPermissions` with cwd pinned to the same worktree the implementer used.
- [ ] Substitutes `{{ISSUE_NUMBER}}`, `{{BRANCH}}`, `{{SOURCE_BRANCH}}`, `{{TOUCHED_FILES}}` (from `git diff --name-only main..branch`), and `{{CODING_STANDARDS_PATH}}` (path to `<target>/.afk-loop/CODING_STANDARDS.md` if present, else empty) into `afk-loop/prompts/review-prompt.md`.
- [ ] JSONL captured to `<target>/.afk-loop/logs/issue-<N>/reviewer-iter-1.jsonl`.
- [ ] On exit: parses for `<promise>COMPLETE</promise>` → verdict `approved`. Otherwise → verdict `refused`.
- [ ] If reviewer made commits (style fixes, test fixes), they're included in the `commits` field of the outcome.
- [ ] Prints verdict JSON: `{"verdict":"approved","commits":[...]}`.
- [ ] `review-prompt.md` exists at `afk-loop/prompts/review-prompt.md` with: read issue body, verify each acceptance criterion against diff, run typecheck + tests, refactor only inside touched files, refuse via missing `<promise>` if any criterion fails.
- [ ] Mock-`claude` integration test for both `approved` and `refused` outcomes.

---

## #5 — Merger phase

**Type**: AFK
**Blocked by**: #3
**Status**: ✅ Completed. `src/merger.ts` `mergeBranches` runs deterministically in TS (no claude call) — `git merge --no-edit --no-ff` per branch, `git merge --abort` + reset on conflict, optional checkCommands run post-merge with auto-revert via `git reset --hard HEAD~1`, `gh issue close` on success, `gh issue comment` on failure. `prompts/merge-prompt.md` saved as reference for future claude-assisted conflict resolution. `main.mts merge --branches <list>` wired. 3 tests covering clean merge, conflict-revert-and-continue, post-merge check failure with revert.

### What to build

A `phases.runMerger` that takes a list of approved branches and merges them into `main` one at a time, with per-branch revert-and-continue on conflict or post-merge test failure. Closes the corresponding GitHub issue on each successful merge.

User runs `npx tsx afk-loop/main.mts merge --branches afk/issue-42,afk/issue-44` and the merger handles each in order, revert-and-comment on failures, close-issue on successes.

### Acceptance criteria

- [ ] `afk-loop merge --branches <comma-list>` subcommand (with optional `--issues <comma-list>` for the matching issue numbers; if omitted, derive from branch names).
- [ ] Spawns `claude -p --max-turns 5 --output-format stream-json --permission-mode bypassPermissions` with cwd pinned to the target repo's main checkout (NOT a worktree).
- [ ] Substitutes `{{BRANCHES}}`, `{{ISSUES}}`, `{{MAIN_BRANCH}}` into `afk-loop/prompts/merge-prompt.md`.
- [ ] On per-branch merge conflict or post-merge test failure: orchestrator (or the merger prompt itself) reverts that one merge (`git merge --abort` or `git reset --hard ORIG_HEAD`), comments on the issue, continues to the next branch.
- [ ] On per-branch success: `gh issue close <N> --comment "Merged by afk-loop"`.
- [ ] JSONL captured to `<target>/.afk-loop/logs/merger-iter-K.jsonl`.
- [ ] Prints final summary JSON: `{"merged":[42],"failed":[{"issue":44,"reason":"conflict in src/auth.ts"}]}`.
- [ ] `merge-prompt.md` exists at `afk-loop/prompts/merge-prompt.md` with the per-branch revert-and-continue semantics from the design.
- [ ] Integration test against a throwaway repo with two prepared branches (one cleanly mergeable, one conflicting); asserts the clean one merges + closes its issue, the conflicting one reverts + comments.

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

- [ ] `afk-loop run` subcommand with flags `--once`, `--max-parallel <N>`.
- [ ] When `--max-parallel=1` and `--once`, executes exactly one issue end-to-end and exits.
- [ ] Frontier capped to `min(maxParallel, configMaxParallel)`.
- [ ] If implementer outcome is `incomplete` → reviewer is skipped, merger is skipped, issue logged but not added to any state file yet (state comes in #8).
- [ ] If reviewer verdict is `refused` → merger skipped.
- [ ] On full success path: issue closed, branch merged into main.
- [ ] Integration test (mock `claude`, mock `gh`, real `git` in throwaway repo): one fully-unblocked issue → full pipeline → main has the commit → issue closed via mocked `gh`.
- [ ] Integration test for incomplete-implementer path: implementer doesn't emit `<promise>` → reviewer not called → merger not called → exit code reflects partial outcome.

---

## #7 — Parallel implementers (cap=3)

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `runIteration` refactored to pre-create worktrees serially (avoids git index-lock contention) then run implementers + reviewers via `Promise.allSettled`. Per-issue logs land in distinct directories (no cross-contamination). Merger remains serial. 2 e2e parallel tests: 3-clean-issues all merge, one-incomplete-among-three isolates failure.

### What to build

Lift the serial constraint. Frontier of N (up to `maxParallel=3`) implementers run concurrently via `Promise.allSettled`. Each gets its own worktree. Reviewers run after their respective implementers (still 1 per branch). Merger runs serially at end of iteration over all approved branches.

User runs `npx tsx afk-loop/main.mts run --once --max-parallel=3` against a target repo with ≥3 unblocked issues and sees three implementers running in parallel.

### Acceptance criteria

- [ ] `--max-parallel=3` runs three implementers concurrently in three separate worktrees.
- [ ] One implementer's failure does not cancel the others (`Promise.allSettled` semantics).
- [ ] Each implementer's JSONL log lands in its own `logs/issue-<N>/` directory — no cross-contamination.
- [ ] After all implementers complete (success or fail), reviewers run for those that produced commits (parallel reviewers OK; they each touch only their own branch).
- [ ] Merger runs once at end of iteration, serially over all reviewer-approved branches.
- [ ] Integration test with 3 prepared mock-issue fixtures (one succeeds, one fails in implementer, one succeeds in implementer but fails in reviewer): asserts only the fully-clean one ends up merged.

---

## #8 — State persistence + crash recovery

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `src/state.ts` with `loadState`, `saveState` (atomic via `state.json.tmp` + rename), `markInFlight`, `clearInFlight`, `markFailed`, `setRateLimitedUntil`, `reconcileInFlight` (orphan PID detection via `process.kill(pid, 0)`). Orchestrator hydrates + reconciles on startup, persists after each iteration, derives `failedThisRun` filter from disk by default. 6 state tests covering defaults, round-trip, .tmp leftover safety, in-flight transitions, dedup-on-failed.

### What to build

A `state` module that reads/writes `<target>/.afk-loop/state.json` atomically (`tmp + rename`) with the minimal shape from the design: `rateLimitedUntil`, `inFlight`, `failedThisRun`. Plus the startup reconciliation logic: on any `afk-loop run` invocation, scan `state.json`, kill any orphaned `claude` processes whose `inFlight` entries point to dead PIDs, requeue their issues, and continue.

### Acceptance criteria

- [ ] `afk-loop/state.ts` module with `loadState()`, `saveState(state)`, `markInFlight(issue, phase)`, `clearInFlight(issue)`, `markFailed(issue)`.
- [ ] Atomic write: writes to `state.json.tmp`, `fsync`, `rename`. Verified by a test that interrupts mid-write and asserts the existing `state.json` is unchanged.
- [ ] State file schema: `{schemaVersion: 1, rateLimitedUntil: ISO|null, inFlight: {[issue]: {phase, branch, startedAt, pid}}, failedThisRun: number[]}`.
- [ ] On `afk-loop run` startup: read state. For each `inFlight` entry, `kill -0 <pid>` to check liveness. If dead → log "orphan recovered for issue N", clear from `inFlight`, leave branch and worktree intact (per failure-preservation policy).
- [ ] `failedThisRun` is filtered out of the frontier in step #1's planner.
- [ ] Test: simulate crash (write `state.json` with an `inFlight` entry pointing to a dead PID) → re-run → assert orphan recovered + frontier excludes that issue from this round if branch is still active.

---

## #9 — Rate-limit detection + pause-and-resume

**Type**: AFK
**Blocked by**: #8
**Status**: ✅ Completed. Orchestrator detects rate-limit (already in claude-runner), persists `rateLimitedUntil` to state.json, fires `rateLimitPaused` notification (no-op default; #12 wires osascript), sleeps via injected `sleep`, then resumes. On startup, if state's reset is still in the future, sleeps the difference first. `--once` returns RATE_LIMITED instead of sleeping. 2 mock-claude tests covering full pause-resume and once-mode short-circuit.

### What to build

When any `claude` invocation returns a rate-limit error, the orchestrator parses the reset time from the error message (or defaults to `now + 60min`), writes `rateLimitedUntil` to `state.json`, fires a desktop notification, sleeps until the reset, then resumes. Survives multiple subscription windows.

### Acceptance criteria

- [ ] `claude-runner` detects rate-limit errors via stderr pattern match (e.g., `/rate.?limit/i` and `/usage limit/i`) and exit code.
- [ ] Parses reset time from the error message if present (the Claude Code CLI emits an explicit time); falls back to `now + 60min`.
- [ ] On detection: writes `rateLimitedUntil` to `state.json`, fires notification "AFK loop paused until <time>", calls `setTimeout` (or `sleep` via async) until reset, then continues the orchestration loop from where it left off (next iteration, not retry of the failed `claude` call).
- [ ] On startup, if `rateLimitedUntil > now`, the orchestrator sleeps the difference before doing anything else.
- [ ] In-flight implementers at the time of rate-limit are marked `inFlight` (they may have made commits) so reconciliation post-pause doesn't double-spawn them.
- [ ] Mock-`claude` integration test: emits a rate-limit error → orchestrator writes state and sleeps a short test-only window (1 second) → wakes and resumes → asserts second iteration completes.

---

## #10 — Advisory planner (optional)

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `prompts/plan-prompt.md` advisory-only with `<concerns>...</concerns>` output contract. `runAdvisoryPlanner` in `phases.ts` substitutes `{{FRONTIER_JSON}}` + `{{ISSUE_BODIES}}`, runs `claude -p --max-turns 3`, parses concerns block, returns `(advisory skipped: rate-limited)` etc on errors. Orchestrator runs only when `config.advisoryPlanner === true`; concerns surface on `IterationOutcome.advisoryConcerns`. 3 tests with custom mock-claude binaries covering concerns / None / rate-limit-skip.

### What to build

After the deterministic frontier is computed, optionally (controlled by `advisoryPlanner: true` in config) run a fast Opus call (`--max-turns 3`) that's shown the frontier + each issue's body and asked: "Do you see risks of working these in parallel?" Output appended to `summary.md` as "Planner concerns this iteration: …". Cannot remove issues from the frontier.

### Acceptance criteria

- [ ] `phases.runAdvisoryPlanner(frontier, issues)` returns a string of concerns or "None".
- [ ] Spawns `claude -p --max-turns 3 --output-format stream-json --permission-mode bypassPermissions` with the `plan-prompt.md` substituted with `{{FRONTIER_JSON}}` and `{{ISSUE_BODIES}}`.
- [ ] `plan-prompt.md` exists at `afk-loop/prompts/plan-prompt.md` with the advisory-only instructions from the design.
- [ ] Output (the `<concerns>...</concerns>` block) is appended to `summary.md` under "Planner concerns iteration K".
- [ ] If `advisoryPlanner: false` in config, this phase is skipped entirely (zero `claude` invocations).
- [ ] If the advisory planner itself rate-limits, log it and skip (don't pause the whole run for an advisory step).
- [ ] Mock-`claude` test: asserts concerns appended to `summary.md` when on; asserts no `claude` spawn when off.

---

## #11 — Time budget + multi-iteration outer loop

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. Multi-iteration loop already in place from #6; extended with `runtimeBudgetHours` soft budget (checked at top of each iteration) → exits TIME_BUDGET. Cycles now bubble up as exit code CYCLE (rather than empty-frontier-DONE). Injected `now()` for deterministic budget tests. 3 multi-iteration tests covering chain completion, time budget, and cycle exit.

### What to build

Wrap the single-iteration orchestrator from #6 in a multi-iteration loop. After each iteration, recompute the frontier; exit when frontier is empty (`DONE`) or wall-clock from run start exceeds `runtimeBudgetHours` (`TIME_BUDGET`). Cycle detection from #1 still aborts before any iteration.

### Acceptance criteria

- [ ] `afk-loop run` (without `--once`) loops over iterations until exit condition.
- [ ] After each iteration: re-fetch issues, recompute frontier, take next batch.
- [ ] Empty frontier → exit code 0, summary section "Run complete: DONE".
- [ ] `Date.now() - runStartedAt > runtimeBudgetHours * 3600000` → finish current iteration's merger, exit code 0, summary section "Run complete: TIME_BUDGET".
- [ ] Cycle detected at any iteration's plan step → exit code 1, summary section "Run aborted: CYCLE".
- [ ] Integration test with 3 issues forming a chain (#42 → #43 → #44, where #43 is blocked by #42, #44 by #43): mock `claude` succeeds for all → asserts 3 iterations, all merged.
- [ ] Integration test with `runtimeBudgetHours: 0.0001` (small) → asserts exits with TIME_BUDGET after iteration 1.

---

## #12 — Observability (summary.md + status.json + 4 osascript notifications)

**Type**: AFK
**Blocked by**: #6
**Status**: ✅ Completed. `src/observability.ts` with `appendSummarySection`, `writeStatus`, `formatIterationSection`, `notify`, `commitUrl`. Header is written once. Iteration sections use ✅/⚠️ bullets, link to commit URL via `gh repo view`-derived slug. `notify` no-ops outside darwin; injectable `spawn` for tests. Orchestrator fires `runStarted`, `iterationCompleted`, `rateLimitPaused`, `runFinished` (4 events total). 8 observability tests covering header idempotency, status overwrite, iteration formatting, advisory concerns surface, darwin/linux notify behaviour.

### What to build

The wake-up artifact layer. After each iteration, write a markdown section to `summary.md` (append-only) with: iteration number, planned/merged/failed counts, per-failure reason, link to commit hashes for merged work. Maintain a live `status.json` overwritten each tick. Fire macOS notifications via `osascript` on four events: run start, rate-limit pause, iteration complete, run complete/fatal.

### Acceptance criteria

- [ ] `observability` module with `appendSummarySection(section)`, `writeStatus(status)`, `notify(event, message)`.
- [ ] `summary.md` is created if missing; otherwise appended. Header includes run start time + version.
- [ ] Each iteration section uses the format from the design: outcome bullets (✅/⚠️), per-iteration breakdown, "Failed issues" subsection with reasons.
- [ ] Commit hashes link to the GitHub commit URL: `https://github.com/<owner>/<repo>/commit/<sha>` (derive `<owner>/<repo>` from `gh repo view --json nameWithOwner`).
- [ ] `status.json` shape: `{currentIteration, frontier: number[], inFlight: number[], lastEventAt, runState: "running"|"paused"|"done"|"failed"}`.
- [ ] `notify(event, message)` shells out to `osascript -e 'display notification "..." with title "AFK Loop"'` on macOS; no-op on other platforms.
- [ ] Four events fire exactly once each: `runStarted`, `rateLimitPaused`, `iterationCompleted`, `runFinished`. No commit-level pings.
- [ ] Test (no real notifications): assert `osascript` is invoked with the right arguments at the right moments by stubbing `child_process.spawn`.

---

## #13 — Migration helper (Sandcastle → AFK label)

**Type**: AFK
**Blocked by**: None — independent.
**Status**: ✅ Completed. `src/migrate.ts` `migrateLabels` with injectable `ghJsonList` + `ghRun` for tests. `--dry-run` reports `wouldMigrate` count without invoking edits. `main.mts migrate-labels --from X --to Y [--dry-run]` wired. 3 tests covering happy path / empty / dry-run.

### What to build

A one-shot CLI command that bulk-relabels all open issues from one label to another. Default invocation: `afk-loop migrate-labels --from Sandcastle --to AFK`.

### Acceptance criteria

- [ ] `afk-loop migrate-labels --from <X> --to <Y>` subcommand.
- [ ] Lists all open issues with label `<X>` via `gh issue list --label <X> --state open --json number`.
- [ ] For each: runs `gh issue edit <N> --remove-label <X> --add-label <Y>`.
- [ ] Prints a summary of what changed: `migrated: 47 issues from "Sandcastle" to "AFK"`.
- [ ] `--dry-run` flag prints what *would* be migrated without doing it.
- [ ] Friendly error if either label doesn't exist on the repo (offers to create the destination via `gh label create`).
- [ ] Test against a throwaway repo with mocked `gh`: asserts the right `gh edit` calls are issued for each open issue with the source label.

---

## #14 — Per-target init + README

**Type**: AFK
**Blocked by**: #11
**Status**: ✅ Completed. `templates/config.json` + `templates/CODING_STANDARDS.md` shipped in the orchestrator. `src/init.ts` `initTarget` copies them into `<target>/.afk-loop/`, calls `ensureGitignore`, refuses to overwrite without `--force`. `main.mts init [--force]` wired with friendly next-steps output. Comprehensive `README.md` covers prerequisites, install, quickstart, all subcommands, config, layout, failure recovery, permission model, architecture, testing, Docker revisit trigger. 3 init tests covering happy path, refuse-without-force, force-overwrite.

### What to build

A bootstrap command for new target repos: `afk-loop init` writes a sensible-default `<target>/.afk-loop/config.json`, a starter `<target>/.afk-loop/CODING_STANDARDS.md`, adds `.afk-loop/` to `<target>/.gitignore`, and prints next steps. Plus the comprehensive README for `afk-loop/` itself documenting install, configure, run, and the morning-after workflow.

### Acceptance criteria

- [ ] `afk-loop init` subcommand, runs in target-repo cwd.
- [ ] Creates `<target>/.afk-loop/` directory if missing.
- [ ] Writes `<target>/.afk-loop/config.json` from a template with defaults: `label: "AFK"`, `hitlPattern: "\\[HITL\\]"`, `mainBranch: "main"`, `maxParallel: 3`, `maxTurnsPerImplementer: 50`, `advisoryPlanner: false`, `runtimeBudgetHours: 8`. Refuses to overwrite an existing config (suggests `--force`).
- [ ] Writes `<target>/.afk-loop/CODING_STANDARDS.md` from a starter template (sections: Style, Testing, Architecture).
- [ ] Adds `.afk-loop/` to `<target>/.gitignore` (idempotent — checks if line already present).
- [ ] Prints next steps: how to label issues, how to run `afk-loop run`, where the wake-up summary lives.
- [ ] `afk-loop/README.md` covers: prerequisites (Node, `gh`, `claude` CLI logged in), `afk-loop init` flow, `afk-loop run` flow, `afk-loop migrate-labels`, the morning-after workflow (`cd .afk-loop/worktrees/issue-N` for failed slices), all config knobs, and the Docker revisit trigger.
- [ ] Integration test: `afk-loop init` against a fresh `git init`'d throwaway repo creates the right files with the right contents and adds the right gitignore line.

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
