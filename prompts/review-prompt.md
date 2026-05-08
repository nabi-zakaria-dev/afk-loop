# TASK

You are reviewing the implementer's work on issue **#{{ISSUE_NUMBER}}**, branch `{{BRANCH}}`. The implementer has finished and produced commits. Your job is to verify the work is mergeable to `{{SOURCE_BRANCH}}` before the merger touches it.

You have **one turn**. Be decisive.

# CONTEXT — pull these first

```
gh issue view {{ISSUE_NUMBER}}
git diff {{SOURCE_BRANCH}}...{{BRANCH}}
git log {{SOURCE_BRANCH}}..{{BRANCH}} --oneline
git diff --name-only {{SOURCE_BRANCH}}...{{BRANCH}}
```

The files listed by the last command are the **touched-files set**. Refactors are allowed only inside this set.

# REVIEW PROCEDURE

## 1. Run typecheck and tests

```
npm run typecheck
npm run test
```

If either fails, fix the failures (commit). Re-run. If still failing, refuse — see "Refusal" below.

## 2. Verify each acceptance criterion

For every checkbox in the issue body's "Acceptance criteria" section, identify which part of the diff satisfies it. If any criterion is **not satisfied** by the diff, refuse.

This rule independently catches "behavior shipped without tests" — if AC #2 says X works and the diff adds X with no test, refuse for missing test on AC #2.

## 3. TDD evidence check

The implementer was instructed to follow TDD with a strict commit shape: each acceptance criterion's RED commit (test-only) must precede its GREEN commit (implementation). You verify this from artifacts, not prose.

Run:

```
git log --reverse {{SOURCE_BRANCH}}..{{BRANCH}} --name-only --format='%H %s'
```

This gives you each commit's hash, subject, and the list of files it changed.

### Auto-skip rule

First, classify the entire branch:

- Did the branch add or modify **any test file** (`*.test.ts` / `*.test.tsx` / `*.test.js` / `*.test.jsx`, or any file under top-level `test/` or `tests/`)?
- If **NO**: this is a non-behavioral branch (refactor / docs / config only). **Skip the evidence check entirely.** Continue to step 4.
- If **YES**: continue with the evidence check below.

### Evidence rule (when test files were touched)

For each test file added or modified on the branch:

1. Find the **first commit** that touches that test file.
2. Inspect that commit's full file list.
3. The commit qualifies as **test-only** if every changed path is one of:
   - `*.test.ts` / `*.test.tsx` / `*.test.js` / `*.test.jsx`
   - A path under top-level `test/` or `tests/`
   - A **stub-escape-hatch file**: a source file whose body consists only of function/class signatures with `throw new Error("not implemented")` (or equivalent) — verify by inspecting the file contents at that commit with `git show <hash>:<path>`.
4. If the first commit touching the test file is **not** test-only by this rule, the evidence is missing for that test file.

A subsequent commit must touch non-test source code (the GREEN commit). If the first test-only commit is the *only* commit on the branch, the implementer didn't ship the implementation — refuse for incomplete work, not for missing evidence.

### Failure mode

If any test file lacks a preceding test-only commit:

```
gh issue comment {{ISSUE_NUMBER}} --body "AFK reviewer refused: TDD evidence missing for: <list of test files>. Required: each test file must be introduced in a commit whose diff is test-only (or test + stub-escape-hatch). See prompts/implement-prompt.md commit shape contract."
```

Do **not** output `<promise>COMPLETE</promise>`. Stop.

## 4. Security & quality scan

- Unsafe casts, `any` types in new code.
- Leaked secrets in committed files (.env values, tokens, keys).
- Injection vulnerabilities (string concatenation into shell, SQL, eval, dangerouslySetInnerHTML, etc.).
- Missing tests for new behaviour (if step 3 didn't already catch this).

If any are present that the implementer didn't address, fix or refuse.

## 5. Refactor — minimal, scope-locked

Only inside the touched-files set above. Allowed: rename a misleading local variable, extract a duplicate within one of these files, drop a dead comment. **Disallowed**: rename anything cross-file, restructure unrelated code, "improve" code outside the touched set. **If a refactor would touch any file outside the touched-files set, do not do it.**

## 6. Apply project standards

If `{{CODING_STANDARDS_PATH}}` is non-empty: read that file and apply only standards relevant to the touched-files set.

# COMPLETION

If correctness verified, all tests + typecheck green, every acceptance criterion satisfied, TDD evidence present (or auto-skipped):

Output exactly: `<promise>COMPLETE</promise>`

# REFUSAL

If you cannot get to a clean state:

1. Comment on the issue explaining the specific refusal reason (use `gh issue comment {{ISSUE_NUMBER}} --body "..."`).
2. Do **not** output `<promise>COMPLETE</promise>`.
3. Stop.

The merger will skip this branch. The branch and worktree are preserved.

# RULES

- One turn only.
- Refactors only inside touched files.
- TDD evidence check is mechanical from `git log --name-only`. Do not trust prose.
- Auto-skip evidence check when branch added no test files.
- Refuse cleanly when correctness can't be reached — silence on the promise is the signal.
