import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { runOrchestrator } from "../src/orchestrator.ts";
import type { Issue } from "../src/issues.ts";
import type { Config } from "../src/config.ts";
import type { StatusJson, InFlightItem, QueuedItem, DoneItem, FailedItem } from "../src/observability.ts";

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

describe("orchestrator streaming progress", () => {
  it("calls the progress callback at key milestones during the run", async () => {
    const repo = mkTmpRepo();
    try {
      const events: Array<{ event: string; message: string }> = [];
      const gh = fakeGh();
      await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
        progress: (event, message) => { events.push({ event, message }); },
      });
      const eventNames = events.map((e) => e.event);
      // Minimum-viable progress: user must see iteration boundaries and per-issue
      // implementer outcomes streaming as they happen, not just at the end.
      expect(eventNames).toContain("iterationStarted");
      expect(eventNames).toContain("implementerComplete");
      expect(eventNames).toContain("iterationCompleted");
      expect(eventNames).toContain("runFinished");
    } finally {
      repo.cleanup();
    }
  });
});

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

describe("orchestrator status.json inFlight", () => {
  it("writes inFlight items with phase, startedAt, lastTransitionAt at implementer-start", async () => {
    const repo = mkTmpRepo();
    try {
      let capturedInFlight: InFlightItem[] | null = null;
      const gh = fakeGh();
      await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
        progress: (event) => {
          if (event === "implementerStarted" && capturedInFlight === null) {
            const path = join(repo.dir, ".afk-loop", "status.json");
            if (existsSync(path)) {
              const status = JSON.parse(readFileSync(path, "utf8")) as StatusJson;
              capturedInFlight = status.inFlight;
            }
          }
        },
      });
      expect(capturedInFlight).not.toBeNull();
      const items = capturedInFlight as unknown as InFlightItem[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ issue: 42, phase: "implementer" });
      expect(items[0]!.title).toBe("Issue 42");
      expect(items[0]!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(items[0]!.lastTransitionAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    } finally {
      repo.cleanup();
    }
  });

  it("updates inFlight phase to reviewer and refreshes lastTransitionAt at reviewer-start", async () => {
    const repo = mkTmpRepo();
    try {
      let capturedAtReviewerStart: InFlightItem[] | null = null;
      const gh = fakeGh();
      await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
        progress: (event) => {
          if (event === "reviewerStarted" && capturedAtReviewerStart === null) {
            const path = join(repo.dir, ".afk-loop", "status.json");
            if (existsSync(path)) {
              const status = JSON.parse(readFileSync(path, "utf8")) as StatusJson;
              capturedAtReviewerStart = status.inFlight;
            }
          }
        },
      });
      expect(capturedAtReviewerStart).not.toBeNull();
      const items = capturedAtReviewerStart as unknown as InFlightItem[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ issue: 42, phase: "reviewer" });
      expect(items[0]!.lastTransitionAt >= items[0]!.startedAt).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("writes queued[] with issues beyond the current frontier at implementer-start", async () => {
    const repo = mkTmpRepo();
    try {
      let captured: QueuedItem[] | undefined;
      const gh = fakeGh();
      await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42), mkIssue(43)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
        progress: (event) => {
          if (event === "implementerStarted" && captured === undefined) {
            const path = join(repo.dir, ".afk-loop", "status.json");
            if (existsSync(path)) {
              const status = JSON.parse(readFileSync(path, "utf8")) as StatusJson;
              captured = status.queued;
            }
          }
        },
      });
      expect(captured).toBeDefined();
      expect(captured!).toHaveLength(1);
      expect(captured![0]).toMatchObject({ issue: 43, title: "Issue 43" });
    } finally {
      repo.cleanup();
    }
  });

  it("writes done[] with merged issues after the iteration completes", async () => {
    const repo = mkTmpRepo();
    try {
      const gh = fakeGh();
      await runOrchestrator({
        cwd: repo.dir,
        config: cfg({ maxParallel: 1 }),
        maxParallel: 1,
        once: true,
        fetchIssues: () => [mkIssue(42)],
        ghRun: gh.runner,
        claudeBin: MOCK_CLAUDE,
        envForIssue: () => ({ MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "1" }),
      });
      const path = join(repo.dir, ".afk-loop", "status.json");
      const status = JSON.parse(readFileSync(path, "utf8")) as StatusJson;
      const done = status.done as DoneItem[] | undefined;
      expect(done).toBeDefined();
      expect(done!.find((d) => d.issue === 42)).toBeDefined();
      expect(done!.find((d) => d.issue === 42)!.outcome).toBe("merged");
    } finally {
      repo.cleanup();
    }
  });
});
