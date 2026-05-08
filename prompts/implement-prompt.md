# TASK

You are implementing GitHub issue **#{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}** on branch `{{BRANCH}}`.

Pull the issue:

```
gh issue view {{ISSUE_NUMBER}}
```

If the issue body has a Parent (PRD) reference, also pull that:

```
gh issue view <PARENT_NUMBER>
```

The acceptance criteria in the issue body are the contract. Each one must be satisfied by your changes and verified by an automated test.

# SCOPE

ONLY work on this single issue. Do not touch unrelated files. Do not refactor code outside the area this issue requires changing. If you find an unrelated bug, leave a comment on the issue noting it and move on — do not fix it here.

---

# TDD DOCTRINE

You will use Test-Driven Development for this work. The doctrine below is **inlined** here, not delegated to a slash command. Read it carefully — the reviewer mechanically verifies your discipline from your commit history.

## Philosophy

**Tests verify behavior through public interfaces, not implementation details.** Code can change entirely; tests should not. Tests describe *what* the system does, not *how* it does it. A good test reads like a specification — "user can checkout with valid cart" tells you what capability exists. These tests survive refactors because they don't care about internal structure.

**Bad tests** are coupled to implementation. They mock internal collaborators, test private methods, or verify through external means (querying a database directly instead of using the interface). The warning sign: your test breaks when you refactor, but behavior hasn't changed. If you rename an internal function and tests fail, those tests were testing implementation, not behavior.

## Anti-pattern: Horizontal slicing — DO NOT DO THIS

**Do not write all tests first, then all implementation.** This is "horizontal slicing." It produces tests of imagined behavior, not actual behavior — tests that pass when behavior breaks and fail when behavior is fine. You commit to test structure before understanding the implementation.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED→GREEN: test1→impl1
  RED→GREEN: test2→impl2
  RED→GREEN: test3→impl3
```

Each test responds to what you learned from the previous cycle. You know exactly what behavior matters because you just wrote the code.

## Workflow

### 1. Plan

Before writing any code:

- List the behaviors to test (not the implementation steps).
- Identify opportunities for *deep modules* — small interface, deep implementation. Hide complexity behind a simple API that rarely changes.
- Design interfaces for testability: pure functions where possible, dependency injection at boundaries, no global state in core logic.
- Use the project's domain glossary (see `CONTEXT.md` if present) so test names and interfaces match the project's language.

### 2. Tracer bullet

Write **ONE** test that confirms ONE thing about the system:

```
RED:   Write the first test → it fails (for the right reason).
GREEN: Write the minimal code that makes it pass → it passes.
```

This is your tracer bullet — it proves the path through every layer end-to-end.

### 3. Incremental loop

For each remaining acceptance criterion:

```
RED:   Write the next test → it fails.
GREEN: Minimal code to pass → it passes.
```

Rules:

- **One test at a time.** Never write tests in bulk.
- **Only enough code to pass the current test.** Don't anticipate future tests.
- **Don't refactor while RED.** Get to GREEN first.
- **Tests focus on observable behavior**, not implementation details.

### 4. Refactor

After all tests pass, look for refactor candidates:

- Extract duplication.
- Deepen modules — move complexity behind simple interfaces.
- Apply SOLID where natural.
- Run tests after each refactor step.

**Refactor only inside files this issue's diff already touches.** If a refactor would touch any file outside the touched-files set, skip it.

## Mocking guidance

- Do not mock internal collaborators. Mock at system boundaries only — external APIs, real-time clocks, filesystem (only when integration tests aren't an option), random sources.
- Prefer integration-style tests that exercise real code paths through the public API.
- If you can't test something without mocking an internal function, the design is wrong — split the module so the boundary is testable.

## Stub escape hatch

When the test you're about to write needs to import a module that doesn't exist yet:

- You may include in the **same RED commit** a source file consisting *only* of function/class signatures with `throw new Error("not implemented")` bodies.
- This counts as a test-only commit for evidence purposes.
- The next commit (GREEN) replaces the `throw` body with real implementation.

This handles "the test won't compile until the import resolves" without giving you license to ship real code in a "test-only" commit.

---

# COMMIT SHAPE CONTRACT

The reviewer will inspect your commit history mechanically. The shape of your commits IS your TDD evidence. Read this contract carefully — it cannot be bluffed with prose.

## Required commit pattern

For each acceptance criterion:

1. **RED commit** — touches ONLY test files (or test files + stub escape hatch). The diff matches one of:
   - All paths end in `.test.ts` / `.test.tsx` / `.test.js` / `.test.jsx`, OR
   - All paths live under a top-level `test/` or `tests/` directory, OR
   - A mix of the above plus stub-escape-hatch files.
2. **GREEN commit** — touches non-test source code. Makes the test from the RED commit pass.
3. **REFACTOR commit (optional)** — touches only files modified in this branch. Behavior unchanged; tests stay green.

You commit *as you go*. Do NOT batch all RED, then all GREEN — that's horizontal slicing. Per acceptance criterion: RED → GREEN → optional REFACTOR.

## Commit message format

Use Conventional Commits. Each commit message starts with one of:

- `feat:` — new feature or capability (typically the GREEN commits).
- `fix:` — bug fix (typically GREEN commits when fixing a regression).
- `refactor:` — internal restructure, no behavior change (REFACTOR commits).
- `test:` — test-only change (RED commits).
- `docs:` — README, ADR, comments only.
- `chore:` — build, deps, tooling.

Optional scope: `feat(reviewer):`, `test(depgraph):`.

End the subject line (or include in the body) with the issue reference: `(#{{ISSUE_NUMBER}})`.

**Include the AC tag `[AC N]` in the commit subject** for every RED, GREEN, and REFACTOR commit, where `N` is the 1-based index of the acceptance criterion (in the order they appear in the issue body). The `afk-loop watch` dashboard reads these tags to show live AC progress; without them, AC mapping falls back to positional pairing of `test:` and `feat:`/`fix:` commits, which is correct only when the discipline is followed strictly. Tags make the mapping explicit and unambiguous.

Example sequence for a single AC:

```
test: add cycle detection for self-loops [AC 2] (#42)
feat: detect self-loops in dep-graph DFS [AC 2] (#42)
refactor: extract dedupeCycles helper [AC 2] (#42)
```

## What the reviewer checks

The reviewer runs:

```
git log --reverse {{SOURCE_BRANCH}}..HEAD --name-only --format='%H %s'
```

It classifies each commit by file shape, then for every *new test file* on the branch it requires:

- A preceding commit whose diff is test-only (or test + stub escape hatch).
- Followed by another commit whose diff includes the corresponding non-test source.

If any test file is missing a preceding test-only commit, the reviewer refuses with `<concerns>TDD evidence missing for <files></concerns>` and does not output `<promise>COMPLETE</promise>`. Your branch is preserved; the merger skips it.

**Refactor-only and docs-only issues:** if your branch adds or modifies *no test files at all*, the evidence check is auto-skipped. The reviewer's acceptance-criteria check still applies — you must satisfy each AC.

---

# FEEDBACK LOOPS

Before each commit:

```
npm run typecheck
npm run test
```

If either fails, fix the failure before committing.

# IF STUCK

If you cannot make progress after working through {{MAX_TURNS}} turns:

1. Leave a comment on the issue describing what was attempted, what you saw, and where you got stuck:
   ```
   gh issue comment {{ISSUE_NUMBER}} --body "..."
   ```
2. Do **not** output `<promise>COMPLETE</promise>`.
3. Stop.

The orchestrator will see no completion promise, mark this issue as failed for this run, and skip it for the merger. The branch and worktree will be preserved so a human can pick up where you got stuck.

# COMPLETION

When every acceptance criterion is satisfied, all tests pass, typecheck is clean, and you have committed all your changes following the commit shape contract above:

Output exactly: `<promise>COMPLETE</promise>`

Do not output the promise unless every acceptance criterion is genuinely met AND your commits follow the RED-before-GREEN pattern. The reviewer will mechanically verify both.

# RULES

- Single issue only.
- TDD red-green-refactor, vertical slicing per acceptance criterion.
- RED commit precedes GREEN commit. Always.
- No unscoped refactors.
- No `git push` (push capability has been stripped from this worktree).
- No destructive commands (the deny-list is enforced in `.claude/settings.local.json`).
