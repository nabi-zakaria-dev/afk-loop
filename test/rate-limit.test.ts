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
  maxParallel: 1,
  maxTurnsPerImplementer: 50,
  advisoryPlanner: false,
  runtimeBudgetHours: 8,
};

const mkIssue = (number: number): Issue => ({
  number,
  title: `Issue ${number}`,
  body: "## Acceptance criteria\n- [ ] x\n",
  blockedBy: [],
  isHITL: false,
});

const fakeGh = () => {
  const calls: string[][] = [];
  return { calls, runner: (args: string[]) => { calls.push(args); } };
};

describe("rate-limit pause-and-resume", () => {
  it("sleeps until reset and resumes the next iteration", async () => {
    const repo = mkTmpRepo();
    try {
      const sleeps: number[] = [];
      const gh = fakeGh();
      let call = 0;
      const reset = new Date(Date.now() + 5_000).toISOString();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg,
        maxParallel: 1,
        once: false,
        fetchIssues: () => {
          // First call: 1 unblocked issue. After it succeeds, frontier is empty.
          return call === 0 ? [mkIssue(42)] : [];
        },
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: (): Record<string, string> => {
          call++;
          return call === 1
            ? { MOCK_CLAUDE_SCENARIO: "rate-limit", MOCK_CLAUDE_RESET: reset }
            : { MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" };
        },
        sleep: async (ms: number) => { sleeps.push(ms); },
        notify: () => {},
      });
      expect(sleeps.length).toBeGreaterThan(0);
      expect(result.exit).toBe("DONE");
      // First iteration was rate-limited; second iteration finished it.
      expect(result.iterations.length).toBeGreaterThanOrEqual(2);
      expect(result.iterations[0]!.rateLimited).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("returns RATE_LIMITED immediately when --once is set", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      const result = await runOrchestrator({
        cwd: repo.dir,
        config: cfg,
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "rate-limit" }),
        sleep: async () => {},
        notify: () => {},
      });
      expect(result.exit).toBe("RATE_LIMITED");
    } finally {
      repo.cleanup();
    }
  });
});
