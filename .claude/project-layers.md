# Project layers — `afk-loop`

Inferred from `README.md`, `DESIGN.md`, `CONTEXT.md`, `PRD.md`, `ISSUES.md`, and `docs/adr/` on first run of `/to-issues`. Used to tag acceptance criteria as `[layer] criterion text`.

Re-infer with: tell `/to-issues` to "re-infer layers" or delete this file.

## Code layers (`src/`)

- `[orchestrator]` — the loop coordination, phase sequencing, status writes (`src/orchestrator.ts`, `src/phases.ts`)
- `[observability]` — `summary.md`, `status.json`, stderr progress stream, desktop notifications (`src/observability.ts`)
- `[claude-runner]` — `claude -p` subprocess wrapper, JSONL streaming, stderr sidecar (`src/claude-runner.ts`)
- `[depgraph]` — dependency-graph parsing + cycle detection (`src/depgraph.ts`)
- `[issues]` — `gh` CLI interaction for issue fetch/comment/close (`src/issues.ts`)
- `[merger]` — branch merging into main with revert-and-continue (`src/merger.ts`)
- `[worktree]` — git worktree create/destroy + sandbox setup (`src/worktree.ts`)
- `[state]` — `state.json` persistence and atomic writes (`src/state.ts`)
- `[config]` — `config.json` validation + types (`src/config.ts`)
- `[migrate]` — bulk label migration (`src/migrate.ts`)
- `[init]` — `afk-loop init` bootstrap (`src/init.ts`)

## Surfaces

- `[cli]` — subcommand wiring in `main.mts` and the `bin/` shim
- `[prompt]` — implementer / reviewer / merger / planner doctrine in `prompts/*.md`

## Quality

- `[tests]` — vitest tests under `test/` using `mkTmpRepo` and a mock `claude` shell script

## Feature additions

- `[watcher]` — *new for `afk-loop watch`*: live progress dashboard renderer (likely `src/watch.ts`); reads `status.json`, alt-screen ANSI, hand-rolled

## Always-valid HITL extensions

`[decision]`, `[review]`, `[research]` are valid layer tags for HITL slices regardless of the layers above.
