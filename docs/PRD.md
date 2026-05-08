# PRD — `afk-loop`

> Local PRD (not published to issue tracker). Generated via `/to-prd` from the design grilling session.

## Problem Statement

I run `/grill-with-docs` → `/to-prd` → `/to-issues` to break work into tightly-scoped vertical-slice issues with explicit "Blocked by" annotations. The pre-coding workflow is fast and high-quality. But the *implementation* phase is where I lose time — I sit at the keyboard babysitting Claude Code through each issue one at a time, approving permissions, watching tests run, switching branches.

I want to walk away from the laptop after `/to-issues` and have multiple unblocked slices implemented in parallel overnight. The existing tool I tried (sandcastle) doesn't fit my workflow because:

1. It requires an `ANTHROPIC_API_KEY` and I want to use my Claude Code subscription.
2. Its Docker isolation adds operational weight I don't need for personal use.
3. Its LLM-based planner re-derives a dependency graph that `/to-issues` already produced deterministically — wasting subscription rate-limit budget.
4. Its label vocabulary (`Sandcastle`) and convention drift away from the AFK/HITL distinction my `/to-issues` skill produces.

I need a smaller, sharper, subscription-native tool tailored to my actual workflow.

## Solution

A personal Node/TypeScript orchestrator named **`afk-loop`** that:

- Reads my GitHub issues labelled `AFK` (excluding `[HITL]`-titled ones), parses their "Blocked by" annotations into a DAG, and computes the unblocked frontier deterministically — no LLM call.
- Spawns up to 3 parallel `claude -p` implementers in their own git worktrees, each scope-locked to one issue, using TDD.
- Runs a one-shot reviewer per branch that verifies the issue's acceptance criteria against the diff and refuses to bless a branch whose criteria aren't met.
- Auto-merges every blessed branch into `main`, with per-branch revert-and-continue on conflict so a single bad slice doesn't take down the whole batch.
- Survives Claude subscription rate-limit windows by parsing the reset time, pausing, and resuming — even across multiple 5-hour windows.
- Produces a single readable `summary.md` artifact each morning that tells me at a glance: what merged, what failed, why each failure happened, and where to pick up.
- Runs fully AFK with `--permission-mode bypassPermissions`, mitigated by a per-worktree deny-list of nuclear shell patterns and stripped push capability in implementer worktrees.

The orchestrator is project-portable. It runs in any target repo's cwd by reading `<target>/.afk-loop/config.json`. KriliDar is the first user; eventual second/third projects pay only the cost of running `afk-loop init`.

## User Stories

1. As an AFK-loop operator, I want to run a single command from my target repo to start the overnight loop, so that I can walk away in under 30 seconds.
2. As an AFK-loop operator, I want the tool to fail fast if there's a cycle in my issue dep-graph, so that I don't wake up to discover nothing got done because two issues were blocking each other.
3. As an AFK-loop operator, I want the unblocked frontier computed deterministically from "Blocked by" fields, so that I can predict and verify which issues will be picked up.
4. As an AFK-loop operator, I want at most 3 implementers running in parallel, so that I don't blow through my subscription rate-limit window on the first batch.
5. As an AFK-loop operator, I want each implementer pinned to a single issue's scope, so that I don't wake up to merges that touched random unrelated files.
6. As an AFK-loop operator, I want each implementer to use TDD via `/tdd`, so that the work that lands has tests that actually exercise behaviour.
7. As an AFK-loop operator, I want a reviewer to verify each branch's acceptance criteria against its diff before merge, so that branches that "almost" satisfy the issue are caught before main is touched.
8. As an AFK-loop operator, I want the reviewer to refactor only files the issue itself touched, so that the loop doesn't widen blast radius into unrelated code.
9. As an AFK-loop operator, I want the merger to revert and continue when one branch conflicts, so that one bad slice doesn't waste the whole batch.
10. As an AFK-loop operator, I want the loop to detect Claude rate-limit errors and pause until reset, so that the run survives overnight even when I cross a 5-hour subscription window.
11. As an AFK-loop operator, I want a `state.json` that survives crashes, so that if my laptop reboots mid-iteration I can resume rather than re-plan from scratch.
12. As an AFK-loop operator, I want failed branches and worktrees preserved on disk, so that I can `cd` into the broken one and pick up where the loop got stuck.
13. As an AFK-loop operator, I want a `summary.md` that's append-only and scannable, so that my morning's first 60 seconds answer "celebrate or investigate?".
14. As an AFK-loop operator, I want desktop notifications on milestones (start, pause, iter complete, run complete), so that I can glance at my phone and know whether to come back.
15. As an AFK-loop operator, I want fully AFK execution with no permission prompts, so that the loop doesn't stall on a `Bash(npm install)` confirmation while I'm asleep.
16. As an AFK-loop operator, I want a deny-list of nuclear shell patterns (`rm -rf /`, `git push --force`, `sudo *`), so that bypass-permissions mode doesn't mean unlimited blast radius.
17. As an AFK-loop operator, I want each implementer's worktree stripped of push capability, so that only the merger (running under a supervised prompt) can ever push to my remote.
18. As an AFK-loop operator, I want a one-shot migration command to relabel my existing `Sandcastle` issues to `AFK`, so that bringing KriliDar onto the new tool takes one command.
19. As an AFK-loop operator, I want a soft 8-hour wall-clock budget on each run, so that a buggy iteration loop can't chew rate-limit and CPU for three days while I'm at a conference.
20. As an AFK-loop operator, I want every `claude -p` invocation's tool calls captured as JSONL, so that a post-mortem on a weird merge is `grep '"name":"Bash"' logs/issue-N/*.jsonl`.
21. As an AFK-loop operator, I want an optional advisory planner phase that flags implicit conflicts the deterministic frontier missed (e.g. two issues touching `auth/middleware.ts`), so that I get an early warning without giving an LLM merge authority.
22. As an AFK-loop operator, I want `afk-loop init` to set up `<target>/.afk-loop/` with sensible defaults plus a `.gitignore` entry, so that adopting the tool on a new project is one command.

## Implementation Decisions

These are the decisions reached during the design grilling. Each is the outcome of a deliberate trade-off, not a default.

- **Drop `@ai-hero/sandcastle`**. Build a custom Node/TS orchestrator. Reasons: subscription auth, Docker overhead is unwanted, LLM planner is unnecessary given `/to-issues` annotations.
- **Shape: single file ~250 LOC `main.mts`** invoked as `npx tsx afk-loop/main.mts <subcommand>`. No framework.
- **Planner: deterministic dep-graph**, not an LLM call. Parses "Blocked by: #N" from issue bodies. Detects cycles via DFS at startup; abort if found.
- **Advisory LLM planner phase: optional, off by default; on for KriliDar.** Opus, `--max-turns 3`, post-frontier, captures concerns into `summary.md`, never overrides.
- **Issue source: GitHub via `gh` CLI.** Filter: `--label AFK --state open`, then exclude titles matching `hitlPattern` (default `\[HITL\]`).
- **Per-target config: `<target>/.afk-loop/config.json`** with `label`, `hitlPattern`, `mainBranch`, `maxParallel`, `maxTurnsPerImplementer`, `advisoryPlanner`, `runtimeBudgetHours`.
- **Merge strategy: auto-merge to `main`** (sandcastle's model). Per-branch revert-and-continue on conflict. The user accepted the risk of a dirty `main` in exchange for throughput; mitigated by reviewer verification + per-worktree push-stripping.
- **Reviewer: kept, refactor-allowed but scope-locked.** Refactor only inside files the issue's diff already touched. If a refactor would touch any file outside that set, skip the refactor.
- **Implementer: TDD via `/tdd`.** Red-green-refactor per acceptance criterion. Comment-on-issue + exit-without-`<promise>` if stuck after `maxTurnsPerImplementer`.
- **Sandbox: git worktrees** at `<target>/.afk-loop/worktrees/issue-N/`, branch `afk/issue-N`. Copy `node_modules` from host on creation, then top-up `npm install`. Copy `.env` (never symlink). `.afk-loop/` gitignored in target repo.
- **Concurrency: cap at 3 parallel** implementers per iteration. `maxTurnsPerImplementer = 50`. Frontier larger than cap → first 3 by issue number; others wait.
- **Rate-limit handling: pause-and-resume.** Detect from `claude` stderr/exit code, parse reset time, write `rateLimitedUntil` to state, sleep, resume. Survives multiple subscription windows.
- **State: minimal `state.json`** with `rateLimitedUntil`, `inFlight` (issue → phase + startedAt), `failedThisRun` (issue numbers). Atomic write via tmp + rename. Everything else (merged, branches, frontier) derived from `gh` and `git`.
- **Permission model: `--permission-mode bypassPermissions`** on every `claude` invocation. Mitigations:
  - Per-worktree `<worktree>/.claude/settings.local.json` with `permissions.deny` for `rm -rf /`, `rm -rf ~`, `sudo *`, `git push --force*`, `git push -f*`, `curl * | sh`, `curl * | bash`, `npm publish*`, `gh release create*`.
  - Orchestrator forces `cwd` to the worktree path on every `spawn`.
  - Implementer worktrees have push capability stripped (`git remote set-url --push origin invalid` or remove origin) before launch. Only the merger pushes.
- **Observability:**
  - JSONL per issue at `<target>/.afk-loop/logs/issue-N/{implementer,reviewer}-iter-K.jsonl`.
  - Append-only `summary.md` is the wake-up artifact.
  - Live `status.json` overwritten each tick.
  - macOS `osascript` desktop notifications on four events: run start, rate-limit pause, iteration complete, run complete/fatal.
- **Implementer execution model: single agentic run** per issue per iteration. One `claude -p --max-turns 50` call holds the design in working memory across turns. Not a Ralph-style fresh-session-per-turn loop — that's reserved for the *outer* loop (replan, retry, cross rate windows).
- **Termination:** empty frontier → `DONE`. Wall-clock > `runtimeBudgetHours` → `TIME_BUDGET`. Cycle in dep-graph at startup → `CYCLE`.
- **Failure preservation:** failed worktrees and branches are kept (not cleaned up). Morning workflow: `cd .afk-loop/worktrees/issue-N && claude`.
- **Prompts:** live in `afk-loop/prompts/` (orchestrator-owned). Four files: `plan-prompt.md` (advisory), `implement-prompt.md`, `review-prompt.md`, `merge-prompt.md`. `CODING_STANDARDS.md` lives per-target.

### Modules

- **`config`** — load + validate `<target>/.afk-loop/config.json`. Pure; tested in isolation.
- **`issues`** — fetch open AFK issues via `gh`, parse "Blocked by" links, filter `[HITL]`. Tested with mocked `gh` output.
- **`depgraph`** — build DAG, compute frontier, detect cycles. Pure; tested with fixtures.
- **`worktree`** — create/destroy git worktrees, seed `node_modules` + `.env`, write deny-list settings, strip push remote. Integration-tested against a throwaway repo.
- **`claude-runner`** — spawn `claude -p` with right flags, capture JSONL stream, parse `<promise>COMPLETE</promise>`, detect rate-limit, enumerate commits. The deepest module.
- **`phases`** — `runImplementer`, `runReviewer`, `runMerger`, `runAdvisoryPlanner`. Compose the runner with the right prompt and flags per phase.
- **`state`** — read/write `state.json` atomically. Pure I/O; tested with tmp dirs.
- **`observability`** — `summary.md` writer (append), `status.json` writer (overwrite), `osascript` notifier. Tested by writing to tmp paths.
- **`orchestrator`** — assembles all the above into the outer loop. The shallow integration layer.

## Testing Decisions

- **What makes a good test here**: integration tests that exercise the public CLI surface (`afk-loop plan`, `afk-loop implement <N>`, `afk-loop run --once`). Tests describe *what* the loop does ("when issue 42 has no blockers and issue 43 is blocked by 42, only 42 enters the frontier") not *how*. Tests must survive internal refactors.
- **Modules to test**:
  - `depgraph` — pure function with fixtures (sample issue bodies → expected frontier; cycle detection cases).
  - `issues` parser — fixtures of `gh` JSON output → typed Issue objects.
  - `state` — round-trip read/write to tmp directory; atomic-write doesn't corrupt on simulated crash.
  - `worktree` — integration test against a fresh `git init`'d throwaway repo: creates worktree, copies node_modules, writes deny-list, strips push, then tears down.
  - `claude-runner` — mock `claude` binary (a shell script that emits canned JSONL) to exercise stream parsing, rate-limit detection, commit enumeration.
- **End-to-end smoke test**: a tiny throwaway test repo with 3 fake AFK issues (one fully unblocked, one blocked by another, one cycle to detect) and a mocked `claude` that just commits a hardcoded change. Exercises plan → implement → review → merge end-to-end. Lives in `afk-loop/test/e2e/`.
- **Prior art**: `/tdd` skill's red-green loop. The orchestrator is itself a great candidate for TDD — vertical slices → one test → minimal implementation → next test.

## Out of Scope

- Docker / VM / sandbox-exec isolation. Revisit after ~10 real overnight runs.
- Multi-repo orchestration (one repo at a time per `afk-loop` invocation).
- PR-based merge strategy. User picked auto-merge to main; PR mode could be added later as a config flag.
- CI integration. The merger runs `npm run typecheck` and `npm run test` itself; we don't wait on GitHub Actions.
- Web UI / TUI dashboard.
- Slack, email, or webhook notifications. macOS `osascript` only.
- Generalisation beyond Node projects. The worktree seeder assumes `node_modules`; non-Node target repos are deferred until a real second project appears.
- Automatic stuck-loop retry (rejected branch + feedback respawn). Manual recovery via the preserved worktree is fine for v1.

## Further Notes

- **Migration**: KriliDar's existing 50+ issues use the `Sandcastle` label. A one-shot migration command relabels them to `AFK` in one go.
- **First-run target**: KriliDar. The tool is "stable" once it survives one full overnight run on KriliDar with a non-trivial frontier (≥5 issues) and produces a clean `summary.md` with no destructive incidents.
- **Risk concentration**: `bypassPermissions` + auto-merge-to-main + 3 parallel agents is the most aggressive combination of choices. The mitigations (deny-list, push-stripping, cwd pinning, JSONL audit) are weight-bearing. Any one mitigation removed materially raises risk.
- **Future generalisation**: when a second project adopts `afk-loop`, factor out the Node-specific seeding (`node_modules` copy) into a config-driven step list. Don't generalise prematurely.
- **Eventual Docker path**: if `afk-loop` ever runs against an infra-touching project (real DB, credentials, deploy keys), Docker becomes mandatory, not optional.
