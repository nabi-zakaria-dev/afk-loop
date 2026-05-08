import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSummarySection,
  writeStatus,
  formatIterationSection,
  notify,
  type StatusJson,
} from "../src/observability.ts";

const mkDir = (): string => mkdtempSync(join(tmpdir(), "afk-obs-"));

describe("appendSummarySection", () => {
  it("creates summary.md with header on first call", () => {
    const dir = mkDir();
    try {
      appendSummarySection(dir, "## Iteration 1\n- ✅ #42\n");
      const content = readFileSync(join(dir, ".afk-loop", "summary.md"), "utf8");
      expect(content).toContain("# AFK Loop Run");
      expect(content).toContain("## Iteration 1");
      expect(content).toContain("✅ #42");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appends subsequent sections without duplicating header", () => {
    const dir = mkDir();
    try {
      appendSummarySection(dir, "## Iteration 1\n");
      appendSummarySection(dir, "## Iteration 2\n");
      const content = readFileSync(join(dir, ".afk-loop", "summary.md"), "utf8");
      const headers = content.match(/# AFK Loop Run/g) ?? [];
      expect(headers.length).toBe(1);
      expect(content).toContain("## Iteration 1");
      expect(content).toContain("## Iteration 2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeStatus", () => {
  it("writes status.json with current state", () => {
    const dir = mkDir();
    try {
      const status: StatusJson = {
        currentIteration: 2,
        frontier: [42, 43],
        inFlight: [],
        lastEventAt: "2030-01-01T00:00:00Z",
        runState: "running",
      };
      writeStatus(dir, status);
      const loaded = JSON.parse(readFileSync(join(dir, ".afk-loop", "status.json"), "utf8"));
      expect(loaded.currentIteration).toBe(2);
      expect(loaded.frontier).toEqual([42, 43]);
      expect(loaded.runState).toBe("running");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("overwrites previous status (not append)", () => {
    const dir = mkDir();
    try {
      writeStatus(dir, { currentIteration: 1, frontier: [], inFlight: [], lastEventAt: "x", runState: "running" });
      writeStatus(dir, { currentIteration: 2, frontier: [], inFlight: [], lastEventAt: "y", runState: "done" });
      const loaded = JSON.parse(readFileSync(join(dir, ".afk-loop", "status.json"), "utf8"));
      expect(loaded.currentIteration).toBe(2);
      expect(loaded.runState).toBe("done");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatIterationSection", () => {
  it("renders merged + failed counts in a header line", () => {
    const md = formatIterationSection({
      iteration: 3,
      merged: [42, 44],
      failedImplementer: [41],
      failedReviewer: [],
      mergeFailed: [],
      advisoryConcerns: undefined,
      commitUrls: { 42: "https://github.com/o/r/commit/abc", 44: "https://github.com/o/r/commit/def" },
    });
    expect(md).toContain("Iteration 3");
    expect(md).toContain("✅ #42");
    expect(md).toContain("https://github.com/o/r/commit/abc");
    expect(md).toContain("⚠️");
    expect(md).toContain("#41");
  });

  it("includes advisory concerns block when present", () => {
    const md = formatIterationSection({
      iteration: 1,
      merged: [],
      failedImplementer: [],
      failedReviewer: [],
      mergeFailed: [],
      advisoryConcerns: "- #42 and #43 both touch auth.ts",
      commitUrls: {},
    });
    expect(md).toContain("Planner concerns");
    expect(md).toContain("auth.ts");
  });
});

describe("notify", () => {
  it("invokes osascript on darwin", () => {
    const calls: string[][] = [];
    const fakeSpawn = (cmd: string, args: string[]) => { calls.push([cmd, ...args]); };
    notify("runStarted", "hello", { spawn: fakeSpawn, platform: "darwin" });
    expect(calls.length).toBe(1);
    expect(calls[0]![0]).toBe("osascript");
    expect(calls[0]!.join(" ")).toContain("hello");
  });

  it("is a no-op on linux", () => {
    const calls: string[][] = [];
    const fakeSpawn = (cmd: string, args: string[]) => { calls.push([cmd, ...args]); };
    notify("runStarted", "hello", { spawn: fakeSpawn, platform: "linux" });
    expect(calls.length).toBe(0);
  });
});
