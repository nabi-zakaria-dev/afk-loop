# TASK

Merge each branch in `{{BRANCHES}}` into `{{MAIN_BRANCH}}` in order.

For each branch:

1. Run `git merge <branch> --no-edit`.
2. **If conflicts:** read both sides intelligently and pick the right resolution. Prefer the side that better satisfies the issue's acceptance criteria. After resolving, run `git add <conflicted-files> && git commit --no-edit`.
3. Run `npm run typecheck && npm run test`. If either fails:
   - Try one fix attempt directly. If that fails too:
   - `git reset --hard ORIG_HEAD` to revert this merge.
   - `gh issue comment <issue-id> --body "AFK merger could not integrate cleanly: <reason>"`
   - **Continue with the next branch.** Do not stop the whole merger.
4. **On clean merge with green tests:** `gh issue close <issue-id> --comment "Merged by afk-loop"`. Continue.

# ISSUES

The branches map to these issues:

{{ISSUES}}

# RULES

- Process branches in the listed order.
- A failure on one branch must not stop the others.
- Never `git push`. The orchestrator handles remotes.
- After all branches are processed, output `<promise>COMPLETE</promise>`.
