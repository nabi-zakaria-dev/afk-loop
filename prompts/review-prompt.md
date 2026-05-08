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

1. **Run typecheck and tests.** If they fail, fix the failures (commit). Re-run. If still failing, refuse — see "Refusal" below.
   ```
   npm run typecheck
   npm run test
   ```

2. **Verify each acceptance criterion.** For every checkbox in the issue body's "Acceptance criteria" section, identify which part of the diff satisfies it. If any criterion is **not satisfied** by the diff, refuse.

3. **Security & quality scan.**
   - Unsafe casts, `any` types in new code.
   - Leaked secrets in committed files (.env values, tokens, keys).
   - Injection vulnerabilities (string concatenation into shell, SQL, eval, dangerouslySetInnerHTML, etc.).
   - Missing tests for new behaviour.
   If any are present that the implementer didn't address, fix or refuse.

4. **Refactor — minimal, scope-locked.** Only inside the touched-files set above. Allowed: rename a misleading local variable, extract a duplicate within one of these files, drop a dead comment. **Disallowed**: rename anything cross-file, restructure unrelated code, "improve" code outside the touched set. **If a refactor would touch any file outside the touched-files set, do not do it.**

5. **Apply project standards** if `{{CODING_STANDARDS_PATH}}` is non-empty: read that file and apply only standards relevant to the touched-files set.

# COMPLETION

If correctness verified, all tests + typecheck green, every acceptance criterion satisfied:

Output exactly: `<promise>COMPLETE</promise>`

# REFUSAL

If you cannot get to a clean state — tests still failing, an acceptance criterion clearly unmet, a security issue you can't fix in one turn:

1. Comment on the issue explaining what's wrong:
   ```
   gh issue comment {{ISSUE_NUMBER}} --body "AFK reviewer refused: <reason>"
   ```
2. Do **not** output `<promise>COMPLETE</promise>`.
3. Stop.

The merger will skip this branch. The branch and worktree are preserved.

# RULES

- One turn only.
- Refactors only inside touched files.
- Refuse cleanly when correctness can't be reached — silence on the promise is the signal.
