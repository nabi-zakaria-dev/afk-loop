import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { runOrchestrator } from "../src/orchestrator.ts";
import type { Issue } from "../src/issues.ts";
import type { Config } from "../src/config.ts";

const MOCK_CLAUDE = fileURLToPath(new URL("./helpers/mock-claude.sh", import.meta.url));

const cfg = (over: Partial<Config> = {}): Config => ({
  label: "AFK",
  hitlPattern: "\\[HITL\\]",
  mainBranch: "main",
  maxParallel: 3,
  maxTurnsPerImplementer: 50,
  advisoryPlanner: false,
  runtimeBudgetHours: 8,
  ...over,
});

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

describe("orchestrator (single iteration, serial)", () => {
  it("runs full pipeline for one unblocked issue (success path)", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
      });
      expect(result.exit).toBe("DONE");
      expect(result.iterations).toHaveLength(1);
      const it1 = result.iterations[0]!;
      expect(it1.implemented).toEqual([42]);
      expect(it1.approvedForMerge).toEqual([42]);
      expect(it1.merge?.merged).toEqual([42]);
      expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "close" && c[2] === "42")).toBe(true);
      // main now has the merge.
      const log = execFileSync("git", ["log", "--oneline", "main"], { cwd: repo.dir, encoding: "utf8" });
      expect(log).toContain("AFK: mock commit");
    } finally {
      repo.cleanup();
    }
  });

  it("skips reviewer + merger when implementer is incomplete", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "incomplete" }),
      });
      const it1 = result.iterations[0]!;
      expect(it1.implemented).toEqual([]);
      expect(it1.failedImplementer).toEqual([42]);
      expect(it1.approvedForMerge).toEqual([]);
      expect(it1.merge).toBeUndefined();
    } finally {
      repo.cleanup();
    }
  });

  it("exits DONE when frontier is empty", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
      });
      expect(result.exit).toBe("DONE");
      expect(result.iterations[0]!.frontier).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });

  it("exits with empty frontier when cycle is detected", async () => {
    // Cycle detection in the orchestrator returns empty-frontier outcome (DONE),
    // which the multi-iteration loop in #11 will distinguish as CYCLE.
    const repo = mkTmpRepo();
    try {
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(1, [2]), mkIssue(2, [1])],
        claudeBin: MOCK_CLAUDE,
      });
      expect(result.iterations[0]!.frontier).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });
});
