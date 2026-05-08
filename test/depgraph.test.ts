import { describe, it, expect } from "vitest";
import { computeFrontier, detectCycles } from "../src/depgraph.ts";
import type { Issue } from "../src/issues.ts";

const mkIssue = (number: number, blockedBy: number[] = []): Issue => ({
  number,
  title: `Issue ${number}`,
  body: blockedBy.length ? `## Blocked by\n${blockedBy.map((b) => `- #${b}`).join("\n")}` : "",
  blockedBy,
  isHITL: false,
});

describe("detectCycles", () => {
  it("returns empty array on empty input", () => {
    expect(detectCycles([])).toEqual([]);
  });

  it("returns empty array on a linear chain", () => {
    const issues = [mkIssue(1), mkIssue(2, [1]), mkIssue(3, [2])];
    expect(detectCycles(issues)).toEqual([]);
  });

  it("detects a self-loop", () => {
    const issues = [mkIssue(1, [1])];
    const cycles = detectCycles(issues);
    expect(cycles.length).toBe(1);
    expect(cycles[0]).toContain(1);
  });

  it("detects a two-node cycle", () => {
    const issues = [mkIssue(1, [2]), mkIssue(2, [1])];
    const cycles = detectCycles(issues);
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0]).toEqual(expect.arrayContaining([1, 2]));
  });

  it("detects a three-node cycle", () => {
    const issues = [mkIssue(1, [3]), mkIssue(2, [1]), mkIssue(3, [2])];
    const cycles = detectCycles(issues);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it("ignores blockers pointing at non-open issues", () => {
    const issues = [mkIssue(1, [99])];
    expect(detectCycles(issues)).toEqual([]);
  });
});

describe("computeFrontier", () => {
  it("returns single unblocked issue", () => {
    const issues = [mkIssue(1)];
    expect(computeFrontier(issues, { maxParallel: 3, failedThisRun: [] })).toEqual([mkIssue(1)]);
  });

  it("excludes blocked issues", () => {
    const issues = [mkIssue(1), mkIssue(2, [1])];
    const frontier = computeFrontier(issues, { maxParallel: 3, failedThisRun: [] });
    expect(frontier.map((i) => i.number)).toEqual([1]);
  });

  it("returns frontier when blocker not in open set (already closed)", () => {
    const issues = [mkIssue(2, [99])];
    const frontier = computeFrontier(issues, { maxParallel: 3, failedThisRun: [] });
    expect(frontier.map((i) => i.number)).toEqual([2]);
  });

  it("respects maxParallel cap", () => {
    const issues = [mkIssue(1), mkIssue(2), mkIssue(3), mkIssue(4)];
    const frontier = computeFrontier(issues, { maxParallel: 2, failedThisRun: [] });
    expect(frontier.length).toBe(2);
  });

  it("orders by issue number ascending under cap", () => {
    const issues = [mkIssue(5), mkIssue(2), mkIssue(7)];
    const frontier = computeFrontier(issues, { maxParallel: 2, failedThisRun: [] });
    expect(frontier.map((i) => i.number)).toEqual([2, 5]);
  });

  it("excludes failedThisRun", () => {
    const issues = [mkIssue(1), mkIssue(2)];
    const frontier = computeFrontier(issues, { maxParallel: 3, failedThisRun: [1] });
    expect(frontier.map((i) => i.number)).toEqual([2]);
  });

  it("handles diamond dependency: A→B,C→D unblocks B,C when A absent", () => {
    const issues = [mkIssue(2, [1]), mkIssue(3, [1]), mkIssue(4, [2, 3])];
    const frontier = computeFrontier(issues, { maxParallel: 3, failedThisRun: [] });
    expect(frontier.map((i) => i.number).sort()).toEqual([2, 3]);
  });
});
