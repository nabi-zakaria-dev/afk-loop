# ADR 0001 — Inline `/tdd` doctrine into prompts; verify TDD evidence from artifacts

**Status:** Accepted
**Date:** 2026-05-08

## Context

The AFK orchestrator's implementer prompt initially referenced the `/tdd` skill in prose (*"Follow `/tdd`'s discipline: RED → GREEN → REFACTOR..."*) and trusted the agent to follow it. The reviewer prompt verified acceptance criteria but not *how* the work was done — implementer commits could ship test+impl together (horizontal slicing) and still pass review.

Two failure modes were observed in design:

1. **Skill instructions get skipped under context pressure.** In a 50-turn agentic run with a long task description, "remember to invoke `/tdd` first" is the kind of instruction the agent skips when other concerns dominate its working memory. Slash-command invocation in `claude -p` non-interactive mode works technically, but is fragile when the prompt also contains the actual task to do.

2. **Prose is unfalsifiable.** The reviewer reading "I followed TDD" in commits or comments cannot tell if it's true. Without an artifact-based check, the rule is decorative.

We need TDD discipline to be both (a) *delivered* to the implementer in a way that can't be forgotten, and (b) *verified* by the reviewer in a way that can't be bluffed.

## Decision

**Inline `/tdd`'s doctrine directly into `prompts/implement-prompt.md`.** Copy the relevant content from `/tdd`'s SKILL.md and supporting files (`tests.md`, `interface-design.md`, `mocking.md`, `refactoring.md`, `deep-modules.md`) into the prompt as a structured TDD section. The implementer never depends on the skill being invokable — the doctrine is in its system prompt every turn.

**Add an artifact-based TDD evidence check to `prompts/review-prompt.md`.** The reviewer runs `git log --reverse main..HEAD --name-only` and classifies each commit by which files it touched. For each test file added on the branch, the reviewer requires that *at least one preceding commit* be test-only (or test + stub-escape-hatch). If any test file lacks a preceding test-only commit, the reviewer refuses by omitting `<promise>COMPLETE</promise>` and comments on the issue with the missing-evidence list.

**Auto-skip the evidence check when no test file was added or modified on the branch.** This handles refactor-only, docs-only, and config-only issues without false-positive refusals. The reviewer's existing acceptance-criteria verification rule still catches "behavior shipped without tests" via a separate code path.

## Alternatives considered

**B. Commit-message tags (`AFK[RED]:`, `AFK[GREEN]:`, `AFK[REFACTOR]:`).** Rejected: tags are self-reported prose with brackets — same failure mode as the original "follow the discipline" instruction. The reviewer parsing tags trusts the implementer's labels rather than the artifacts.

**C. Hybrid (tags as hint + diff-shape as authoritative).** Rejected: introduces two enforcement systems with overlapping rules. When they disagree the reviewer must judge which wins, reintroducing the ambiguity we wanted to remove.

**D. Invoke `/tdd` skill at runtime.** Rejected: works in `claude -p` mode but depends on the implementer remembering to call it. Inlining is strictly more reliable — the doctrine is present in the system prompt regardless of the agent's choices.

**E. Universal evidence-check (no auto-skip).** Rejected: produces false-positive refusals on legitimate refactor-only and docs-only issues. Forcing a contrived test for a rename is exactly the kind of "test of implementation detail" that `/tdd`'s `tests.md` warns against — universal enforcement would break the rule it tries to enforce.

## Consequences

### Positive

- Implementer cannot forget the discipline; it's in its system prompt every turn.
- Reviewer cannot be bluffed; it inspects `git log --name-only` mechanically.
- Refactor and docs issues remain easy to ship.
- The "ship behavior without tests" loophole is closed by the *separate* AC verification rule, not by overloading the evidence check.
- Implementer commit shape becomes a stable contract — small, frequent commits with clear RED/GREEN/REFACTOR shapes — which is also healthy on its own.

### Negative

- `prompts/implement-prompt.md` grows by ~80 lines of inlined doctrine. Drift from `/tdd`'s upstream content is now possible; if `/tdd` evolves significantly we have to manually re-sync.
- Implementer must commit at the right granularity. A naive commit-everything-at-end pattern (single big commit with both tests and impl) gets refused. Implementer prompt makes this contract explicit.
- Reviewer adds a step that runs `git log` per branch — small cost, ~10ms.

### Out-of-scope (for this ADR)

- Whether the implementer follows TDD *internally* (within a single turn, in its agent context) is unobservable. The check fires at commit boundaries. An implementer that writes test-then-impl-then-commits-both-at-once still fails the evidence check, even if mentally it followed the discipline. This is acceptable: commit shape is a public artifact; private discipline is not.

## Related

- `prompts/implement-prompt.md` — contains the inlined `/tdd` doctrine.
- `prompts/review-prompt.md` — contains the TDD evidence step.
- `CONTEXT.md` — defines `TDD evidence`, `Stub escape hatch`, `Test-only commit`, `Behavioral issue`, `Non-behavioral issue`.
