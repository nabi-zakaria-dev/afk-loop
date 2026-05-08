import { describe, it, expect } from "vitest";
import { execFileSync as exec } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { mergeBranches } from "../src/merger.ts";

const setBranch = (cwd: string, branch: string, file: string, contents: string): void => {
  exec("git", ["checkout", "-q", "-b", branch], { cwd });
  writeFileSync(join(cwd, file), contents);
  exec("git", ["add", file], { cwd });
  exec("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", `add ${file}`], { cwd });
  exec("git", ["checkout", "-q", "main"], { cwd });
};

const fakeGhRunner = () => {
  const calls: string[][] = [];
  const runner = (args: string[]) => {
    calls.push(args);
  };
  return { calls, runner };
};

describe("mergeBranches", () => {
  it("cleanly merges a single non-conflicting branch and closes its issue", () => {
    const repo = mkTmpRepo();
    try {
      setBranch(repo.dir, "afk/issue-42", "feature.txt", "feature");
      const gh = fakeGhRunner();
      const result = mergeBranches({
        cwd: repo.dir,
        mainBranch: "main",
        branches: ["afk/issue-42"],
        issues: [{ number: 42, branch: "afk/issue-42", title: "feature" }],
        ghRun: gh.runner,
      });
      expect(result.merged).toEqual([42]);
      expect(result.failed).toEqual([]);
      expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "close" && c[2] === "42")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("reverts and continues on conflict; merges next branch cleanly", () => {
    const repo = mkTmpRepo();
    try {
      setBranch(repo.dir, "afk/issue-42", "shared.txt", "from-42");
      // Branch 43 modifies the same file from main → conflict with 42's merge.
      // We need to checkout from a state without 42's changes.
      exec("git", ["checkout", "-q", "-b", "afk/issue-43", "main"], { cwd: repo.dir });
      writeFileSync(join(repo.dir, "shared.txt"), "from-43");
      exec("git", ["add", "shared.txt"], { cwd: repo.dir });
      exec("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "from-43"], { cwd: repo.dir });
      exec("git", ["checkout", "-q", "main"], { cwd: repo.dir });

      // 44 is a clean branch on a different file.
      setBranch(repo.dir, "afk/issue-44", "another.txt", "another");

      const gh = fakeGhRunner();
      const result = mergeBranches({
        cwd: repo.dir,
        mainBranch: "main",
        branches: ["afk/issue-42", "afk/issue-43", "afk/issue-44"],
        issues: [
          { number: 42, branch: "afk/issue-42", title: "x" },
          { number: 43, branch: "afk/issue-43", title: "y" },
          { number: 44, branch: "afk/issue-44", title: "z" },
        ],
        ghRun: gh.runner,
      });
      // 42 merges first cleanly. 43 conflicts and is reverted. 44 still merges.
      expect(result.merged).toContain(42);
      expect(result.merged).toContain(44);
      expect(result.failed.find((f) => f.issue === 43)).toBeDefined();
      // Conflicting issue should have a comment.
      expect(gh.calls.some((c) => c[0] === "issue" && c[1] === "comment" && c[2] === "43")).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("reverts on post-merge test failure when checkCommands fail", () => {
    const repo = mkTmpRepo();
    try {
      setBranch(repo.dir, "afk/issue-50", "a.txt", "x");
      const gh = fakeGhRunner();
      const result = mergeBranches({
        cwd: repo.dir,
        mainBranch: "main",
        branches: ["afk/issue-50"],
        issues: [{ number: 50, branch: "afk/issue-50", title: "x" }],
        ghRun: gh.runner,
        checkCommands: [["sh", "-c", "exit 1"]],
      });
      expect(result.merged).toEqual([]);
      expect(result.failed.find((f) => f.issue === 50)?.reason).toMatch(/check/i);
      // Main HEAD should not contain the file from afk/issue-50.
      const ls = exec("git", ["ls-tree", "--name-only", "HEAD"], { cwd: repo.dir, encoding: "utf8" });
      expect(ls).not.toContain("a.txt");
    } finally {
      repo.cleanup();
    }
  });
});
