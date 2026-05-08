import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { runAdvisoryPlanner } from "../src/phases.ts";
import type { Issue } from "../src/issues.ts";

const MOCK_CLAUDE = fileURLToPath(new URL("./helpers/mock-claude.sh", import.meta.url));

const mkIssue = (number: number): Issue => ({
  number,
  title: `Issue ${number}`,
  body: "## Acceptance criteria\n- [ ] x\n",
  blockedBy: [],
  isHITL: false,
});

describe("runAdvisoryPlanner", () => {
  it("returns concerns string from <concerns> block", async () => {
    const repo = mkTmpRepo();
    try {
      // Write a custom mock that emits concerns inside the success scenario.
      const customMockDir = join(repo.dir, "mock");
      mkdirSync(customMockDir, { recursive: true });
      const customMock = join(customMockDir, "claude-with-concerns.sh");
      writeFileSync(
        customMock,
        `#!/bin/bash
echo '{"role":"assistant","message":{"content":[{"type":"text","text":"<concerns>- Issues #42 and #43 both touch auth/middleware.ts</concerns>"}]}}'
exit 0
`,
        { mode: 0o755 },
      );

      const result = await runAdvisoryPlanner({
        targetDir: repo.dir,
        iteration: 1,
        frontier: [mkIssue(42), mkIssue(43)],
        claudeBin: customMock,
      });
      expect(result.outcome).toBe("ok");
      expect(result.concerns).toContain("auth/middleware.ts");
    } finally {
      repo.cleanup();
    }
  });

  it("returns 'None' when planner outputs <concerns>None</concerns>", async () => {
    const repo = mkTmpRepo();
    try {
      const customMockDir = join(repo.dir, "mock");
      mkdirSync(customMockDir, { recursive: true });
      const customMock = join(customMockDir, "claude-clean.sh");
      writeFileSync(
        customMock,
        `#!/bin/bash
echo '{"role":"assistant","message":{"content":[{"type":"text","text":"<concerns>None</concerns>"}]}}'
exit 0
`,
        { mode: 0o755 },
      );

      const result = await runAdvisoryPlanner({
        targetDir: repo.dir,
        iteration: 1,
        frontier: [mkIssue(1)],
        claudeBin: customMock,
      });
      expect(result.concerns).toBe("None");
    } finally {
      repo.cleanup();
    }
  });

  it("skips with rate-limited outcome on rate-limit error", async () => {
    const repo = mkTmpRepo();
    try {
      const result = await runAdvisoryPlanner({
        targetDir: repo.dir,
        iteration: 1,
        frontier: [mkIssue(1)],
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "rate-limit" },
      });
      expect(result.outcome).toBe("rate-limited");
    } finally {
      repo.cleanup();
    }
  });
});
