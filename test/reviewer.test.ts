import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { createWorktree } from "../src/worktree.ts";
import { runReviewer } from "../src/phases.ts";

const MOCK_CLAUDE = fileURLToPath(new URL("./helpers/mock-claude.sh", import.meta.url));

const setupBranchWithCommit = (repoDir: string, issueNumber: number): void => {
  createWorktree(repoDir, issueNumber, "main");
  const wt = join(repoDir, ".afk-loop", "worktrees", `issue-${issueNumber}`);
  // Make a commit on the AFK branch so there's a diff to review.
  execFileSync("sh", ["-c", "echo work > w.txt && git add w.txt && git commit -q -m 'AFK: work (#1)'"], { cwd: wt });
};

describe("runReviewer", () => {
  it("returns approved on success scenario", async () => {
    const repo = mkTmpRepo();
    try {
      setupBranchWithCommit(repo.dir, 1);
      const result = await runReviewer({
        targetDir: repo.dir,
        issue: { number: 1, title: "test", body: "## Acceptance criteria\n- [ ] x", blockedBy: [], isHITL: false },
        mainBranch: "main",
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "0" },
      });
      expect(result.outcome).toBe("complete");
    } finally {
      repo.cleanup();
    }
  });

  it("returns incomplete (refused) on incomplete scenario", async () => {
    const repo = mkTmpRepo();
    try {
      setupBranchWithCommit(repo.dir, 2);
      const result = await runReviewer({
        targetDir: repo.dir,
        issue: { number: 2, title: "test", body: "## Acceptance criteria\n- [ ] x", blockedBy: [], isHITL: false },
        mainBranch: "main",
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "incomplete" },
      });
      expect(result.outcome).toBe("incomplete");
    } finally {
      repo.cleanup();
    }
  });
});
