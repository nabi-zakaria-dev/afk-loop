import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { runOrchestrator } from "../src/orchestrator.ts";
import type { Issue } from "../src/issues.ts";
import type { Config } from "../src/config.ts";

const MOCK_CLAUDE = fileURLToPath(new URL("./helpers/mock-claude.sh", import.meta.url));

const cfg: Config = {
  label: "AFK",
  hitlPattern: "\\[HITL\\]",
  mainBranch: "main",
  maxParallel: 3,
  maxTurnsPerImplementer: 50,
  advisoryPlanner: false,
  runtimeBudgetHours: 8,
};

const mkIssue = (number: number, blockedBy: number[] = []): Issue => ({
  number,
  title: `Issue ${number}`,
  body: "## Acceptance criteria\n- [ ] x\n",
  blockedBy,
  isHITL: false,
});

const fakeGh = () => {
  const calls: string[][] = [];
  return { calls, runner: (args: string[]) => { calls.push(args); } };
};

describe("orchestrator (parallel cap=3)", () => {
  it("runs three implementers concurrently and merges all clean ones", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg,
        maxParallel: 3,
        once: true,
        fetchIssues: () => [mkIssue(101), mkIssue(102), mkIssue(103)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
      });
      const it1 = result.iterations[0]!;
      expect(it1.frontier.length).toBe(3);
      expect(it1.implemented.sort()).toEqual([101, 102, 103]);
      expect(it1.merge?.merged.sort()).toEqual([101, 102, 103]);
    } finally {
      repo.cleanup();
    }
  });

  it("isolates failure: one incomplete implementer does not stop others", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg,
        maxParallel: 3,
        once: true,
        fetchIssues: () => [mkIssue(201), mkIssue(202), mkIssue(203)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: (issue): Record<string, string> => issue.number === 202
          ? { MOCK_CLAUDE_SCENARIO: "incomplete" }
          : { MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" },
      });
      const it1 = result.iterations[0]!;
      expect(it1.implemented.sort()).toEqual([201, 203]);
      expect(it1.failedImplementer).toEqual([202]);
      expect(it1.merge?.merged.sort()).toEqual([201, 203]);
    } finally {
      repo.cleanup();
    }
  });
});
