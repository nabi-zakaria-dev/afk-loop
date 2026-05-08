import { describe, it, expect } from "vitest";
import { parseIssue, filterIssues } from "../src/issues.ts";

const sampleGhIssue = (overrides: Partial<{ number: number; title: string; body: string; labels: string[] }> = {}) => ({
  number: overrides.number ?? 42,
  title: overrides.title ?? "Sample issue",
  body: overrides.body ?? "",
  labels: (overrides.labels ?? ["AFK"]).map((name) => ({ name })),
});

describe("parseIssue", () => {
  it("parses basic issue with no blockers", () => {
    const parsed = parseIssue(sampleGhIssue({ body: "## What to build\nstuff" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.blockedBy).toEqual([]);
    expect(parsed.isHITL).toBe(false);
  });

  it("parses 'Blocked by: #N' single blocker", () => {
    const parsed = parseIssue(sampleGhIssue({ body: "## Blocked by\n- #42" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.blockedBy).toEqual([42]);
  });

  it("parses comma-separated blockers", () => {
    const parsed = parseIssue(sampleGhIssue({ body: "Blocked by: #42, #43" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.blockedBy.sort()).toEqual([42, 43]);
  });

  it("parses multiple blockers across lines", () => {
    const parsed = parseIssue(sampleGhIssue({ body: "## Blocked by\n- #5\n- #7\n- #9" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.blockedBy.sort()).toEqual([5, 7, 9]);
  });

  it("treats 'None' or 'can start immediately' as no blockers", () => {
    const parsed = parseIssue(sampleGhIssue({ body: "## Blocked by\nNone - can start immediately" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.blockedBy).toEqual([]);
  });

  it("flags HITL via title pattern", () => {
    const parsed = parseIssue(sampleGhIssue({ title: "[Phase 5] Launch checklist [HITL]" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.isHITL).toBe(true);
  });

  it("does not flag non-HITL titles", () => {
    const parsed = parseIssue(sampleGhIssue({ title: "Build feature X" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.isHITL).toBe(false);
  });

  it("is case-insensitive on Blocked by header", () => {
    const parsed = parseIssue(sampleGhIssue({ body: "blocked BY: #11" }), { hitlPattern: "\\[HITL\\]" });
    expect(parsed.blockedBy).toEqual([11]);
  });
});

describe("filterIssues", () => {
  it("filters out HITL issues", () => {
    const issues = [
      parseIssue(sampleGhIssue({ number: 1, title: "AFK one" }), { hitlPattern: "\\[HITL\\]" }),
      parseIssue(sampleGhIssue({ number: 2, title: "Manual review [HITL]" }), { hitlPattern: "\\[HITL\\]" }),
    ];
    const filtered = filterIssues(issues);
    expect(filtered.map((i) => i.number)).toEqual([1]);
  });
});
