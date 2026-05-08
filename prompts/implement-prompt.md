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

# EXECUTION — TDD (red-green-refactor)

Follow `/tdd`'s discipline:

1. **RED** — write ONE failing test for the next acceptance criterion. Run the test; confirm it fails for the right reason.
2. **GREEN** — write the minimal code that makes it pass. Run the test; confirm it passes.
3. **REFACTOR** — clean up only files you touched in this slice. Never refactor while red. Never refactor outside the touched-files set.
4. Repeat until every acceptance criterion has at least one test and passes.

Do **not** write all tests first then all implementation (horizontal slicing). Write one test, get it green, write the next.

# FEEDBACK LOOPS

Before each commit:

```
npm run typecheck
npm run test
```

If either fails, fix the failure before committing.

# COMMITS

Make commits as you go. Each commit message should:

1. Start with `AFK:` prefix.
2. Reference the issue: `(#{{ISSUE_NUMBER}})`.
3. State what landed in one line.

Example: `AFK: add cycle detection for self-loops (#42)`

# IF STUCK

If you cannot make progress after working through {{MAX_TURNS}} turns:

1. Leave a comment on the issue describing what was attempted, what you saw, and where you got stuck. Use `gh issue comment {{ISSUE_NUMBER}} --body "..."`.
2. Do **not** output `<promise>COMPLETE</promise>`.
3. Stop.

The orchestrator will see no completion promise, mark this issue as failed for this run, and skip it for the merger. The branch and worktree will be preserved so a human can pick up where you got stuck.

# COMPLETION

When every acceptance criterion is satisfied, all tests pass, typecheck is clean, and you have committed all your changes:

Output exactly: `<promise>COMPLETE</promise>`

Do not output the promise unless every acceptance criterion is genuinely met. The reviewer will verify against the diff.

# RULES

- Single issue only.
- TDD red-green-refactor.
- No unscoped refactors.
- No `git push` (push capability has been stripped from this worktree).
- No destructive commands (the deny-list is enforced in `.claude/settings.local.json`).
