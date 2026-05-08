import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runClaudePhase, buildClaudeArgs } from "../src/claude-runner.ts";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";

const headSha = (cwd: string): string =>
  execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();

const MOCK_CLAUDE = fileURLToPath(new URL("./helpers/mock-claude.sh", import.meta.url));

describe("buildClaudeArgs", () => {
  it("includes --verbose when output-format is stream-json (required by Claude Code)", () => {
    const args = buildClaudeArgs({
      maxTurns: 50,
      prompt: "do work",
      userMessage: "issue 42",
      permissionMode: "bypassPermissions",
    });
    expect(args).toContain("--verbose");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    // The order matters less than the presence — but --print + stream-json without
    // --verbose is the bug the failing run exposed; this test gates against regression.
  });
});

describe("runClaudePhase", () => {
  it("captures success outcome with commits", async () => {
    const repo = mkTmpRepo();
    try {
      const baseSha = headSha(repo.dir);
      const logPath = join(repo.dir, "log.jsonl");
      const result = await runClaudePhase({
        cwd: repo.dir,
        prompt: "do the thing",
        userMessage: "issue 42",
        maxTurns: 50,
        logPath,
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "success", MOCK_CLAUDE_COMMITS: "2" },
        commitRange: { from: baseSha, to: "HEAD" },
      });
      expect(result.outcome).toBe("complete");
      expect(result.commits.length).toBe(2);
      expect(existsSync(logPath)).toBe(true);
      const lines = readFileSync(logPath, "utf8").trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(3);
    } finally {
      repo.cleanup();
    }
  });

  it("captures incomplete outcome (no completion promise)", async () => {
    const repo = mkTmpRepo();
    try {
      const baseSha = headSha(repo.dir);
      const result = await runClaudePhase({
        cwd: repo.dir,
        prompt: "do the thing",
        userMessage: "issue 42",
        maxTurns: 50,
        logPath: join(repo.dir, "log.jsonl"),
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "incomplete" },
        commitRange: { from: baseSha, to: "HEAD" },
      });
      expect(result.outcome).toBe("incomplete");
      expect(result.commits.length).toBe(1);
    } finally {
      repo.cleanup();
    }
  });

  it("detects rate-limit and parses reset time", async () => {
    const repo = mkTmpRepo();
    try {
      const baseSha = headSha(repo.dir);
      const reset = "2030-01-01T12:00:00Z";
      const result = await runClaudePhase({
        cwd: repo.dir,
        prompt: "do the thing",
        userMessage: "issue 42",
        maxTurns: 50,
        logPath: join(repo.dir, "log.jsonl"),
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "rate-limit", MOCK_CLAUDE_RESET: reset },
        commitRange: { from: baseSha, to: "HEAD" },
      });
      expect(result.outcome).toBe("rate-limited");
      expect(result.rateLimitedUntil).toBe(reset);
    } finally {
      repo.cleanup();
    }
  });

  it("falls back to default reset time when none in error", async () => {
    const repo = mkTmpRepo();
    try {
      const baseSha = headSha(repo.dir);
      const result = await runClaudePhase({
        cwd: repo.dir,
        prompt: "do the thing",
        userMessage: "issue 42",
        maxTurns: 50,
        logPath: join(repo.dir, "log.jsonl"),
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "rate-limit" },
        commitRange: { from: baseSha, to: "HEAD" },
      });
      expect(result.outcome).toBe("rate-limited");
      expect(result.rateLimitedUntil).toBeDefined();
      const ms = Date.parse(result.rateLimitedUntil!);
      expect(ms).toBeGreaterThan(Date.now() + 30 * 60 * 1000);
    } finally {
      repo.cleanup();
    }
  });

  it("captures error outcome on non-rate-limit failure", async () => {
    const repo = mkTmpRepo();
    try {
      const baseSha = headSha(repo.dir);
      const result = await runClaudePhase({
        cwd: repo.dir,
        prompt: "do the thing",
        userMessage: "issue 42",
        maxTurns: 50,
        logPath: join(repo.dir, "log.jsonl"),
        claudeBin: MOCK_CLAUDE,
        env: { MOCK_CLAUDE_SCENARIO: "error" },
        commitRange: { from: baseSha, to: "HEAD" },
      });
      expect(result.outcome).toBe("error");
    } finally {
      repo.cleanup();
    }
  });
});
