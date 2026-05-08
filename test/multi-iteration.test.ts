import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { runOrchestrator } from "../src/orchestrator.ts";
import type { Issue } from "../src/issues.ts";
import type { Config } from "../src/config.ts";

const MOCK_CLAUDE = fileURLToPath(new URL("./helpers/mock-claude.sh", import.meta.url));

const cfg = (over: Partial<Config> = {}): Config => ({
  label: "AFK",
  hitlPattern: "\\[HITL\\]",
  mainBranch: "main",
  maxParallel: 1,
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

describe("multi-iteration outer loop", () => {
  it("runs a chain across multiple iterations until frontier is empty", async () => {
    const repo = mkTmpRepo();
    try {
      const allIssues = [mkIssue(1), mkIssue(2, [1]), mkIssue(3, [2])];
      let closed = new Set<number>();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg(),
        once: false,
        fetchIssues: () => allIssues.filter((i) => !closed.has(i.number)),
        ghRun: (args) => {
          if (args[0] === "issue" && args[1] === "close") closed.add(Number(args[2]));
        },
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
        sleep: async () => {},
        notify: () => {},
      });
      expect(result.exit).toBe("DONE");
      // We expect 3 iterations (one per chain link) plus a final empty-frontier iteration.
      expect(result.iterations.length).toBeGreaterThanOrEqual(3);
      expect(closed.has(1)).toBe(true);
      expect(closed.has(2)).toBe(true);
      expect(closed.has(3)).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("exits TIME_BUDGET when wall-clock exceeds runtimeBudgetHours", async () => {
    const repo = mkTmpRepo();
    try {
      // Tiny budget; first iteration completes, second iteration trips the budget check.
      const start = 1_000_000_000_000;
      let nowVal = start;
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ runtimeBudgetHours: 0.0001 }), // ~360ms budget
        once: false,
        fetchIssues: () => [mkIssue(42)],
        ghRun: () => {},
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
        sleep: async () => {},
        now: () => {
          const t = nowVal;
          nowVal += 10_000_000; // each call advances "time" by lots of ms
          return t;
        },
        notify: () => {},
      });
      expect(result.exit).toBe("TIME_BUDGET");
    } finally {
      repo.cleanup();
    }
  });

  it("exits CYCLE when the dep-graph has a cycle", async () => {
    const repo = mkTmpRepo();
    try {
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg(),
        once: false,
        fetchIssues: () => [mkIssue(1, [2]), mkIssue(2, [1])],
        ghRun: () => {},
        claudeBin: MOCK_CLAUDE,
        sleep: async () => {},
        notify: () => {},
      });
      expect(result.exit).toBe("CYCLE");
      expect(result.iterations[0]!.cycleDetected).toBeDefined();
    } finally {
      repo.cleanup();
    }
  });
});
