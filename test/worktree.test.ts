import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { createWorktree, destroyWorktree, ensureGitignore } from "../src/worktree.ts";

describe("createWorktree", () => {
  it("creates worktree at expected path on the AFK branch", () => {
    const repo = mkTmpRepo();
    try {
      const wt = createWorktree(repo.dir, 42, "main");
      expect(wt.path).toBe(join(repo.dir, ".afk-loop", "worktrees", "issue-42"));
      expect(existsSync(wt.path)).toBe(true);
      expect(wt.branch).toBe("afk/issue-42");
      const branches = execSync("git branch --list afk/issue-42", { cwd: repo.dir, encoding: "utf8" });
      expect(branches.trim()).toContain("afk/issue-42");
    } finally {
      repo.cleanup();
    }
  });

  it("copies node_modules into worktree if present on host", () => {
    const repo = mkTmpRepo({ withNodeModules: true });
    try {
      const wt = createWorktree(repo.dir, 42, "main");
      expect(existsSync(join(wt.path, "node_modules", "fake-pkg", "index.js"))).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("copies .env into worktree if present", () => {
    const repo = mkTmpRepo({ withEnv: true });
    try {
      const wt = createWorktree(repo.dir, 42, "main");
      expect(readFileSync(join(wt.path, ".env"), "utf8")).toContain("FOO=bar");
    } finally {
      repo.cleanup();
    }
  });

  it("does not throw when .env is absent", () => {
    const repo = mkTmpRepo();
    try {
      expect(() => createWorktree(repo.dir, 42, "main")).not.toThrow();
    } finally {
      repo.cleanup();
    }
  });

  it("writes deny-list settings.local.json with nuclear patterns", () => {
    const repo = mkTmpRepo();
    try {
      const wt = createWorktree(repo.dir, 42, "main");
      const settingsPath = join(wt.path, ".claude", "settings.local.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      const deny = settings.permissions?.deny as string[] | undefined;
      expect(deny).toBeDefined();
      expect(deny).toEqual(expect.arrayContaining([expect.stringContaining("rm -rf /")]));
      expect(deny).toEqual(expect.arrayContaining([expect.stringContaining("git push --force")]));
      expect(deny).toEqual(expect.arrayContaining([expect.stringContaining("sudo")]));
      expect(deny).toEqual(expect.arrayContaining([expect.stringContaining("npm publish")]));
    } finally {
      repo.cleanup();
    }
  });

  it("strips push capability from origin remote", () => {
    const repo = mkTmpRepo();
    try {
      // Add a fake origin first so the strip logic has something to operate on.
      execSync("git remote add origin https://example.test/repo.git", { cwd: repo.dir });
      const wt = createWorktree(repo.dir, 42, "main");
      const url = execSync("git remote get-url --push origin", { cwd: wt.path, encoding: "utf8" }).trim();
      expect(url).toMatch(/no-push|disabled/i);
    } finally {
      repo.cleanup();
    }
  });

  it("reuses existing branch instead of failing", () => {
    const repo = mkTmpRepo();
    try {
      execSync("git branch afk/issue-42", { cwd: repo.dir });
      const wt = createWorktree(repo.dir, 42, "main");
      expect(wt.branch).toBe("afk/issue-42");
      expect(existsSync(wt.path)).toBe(true);
    } finally {
      repo.cleanup();
    }
  });

  it("is idempotent: second call on same issue does not throw", () => {
    const repo = mkTmpRepo();
    try {
      createWorktree(repo.dir, 42, "main");
      expect(() => createWorktree(repo.dir, 42, "main")).not.toThrow();
    } finally {
      repo.cleanup();
    }
  });
});

describe("destroyWorktree", () => {
  it("removes the worktree directory and the branch", () => {
    const repo = mkTmpRepo();
    try {
      const wt = createWorktree(repo.dir, 42, "main");
      destroyWorktree(repo.dir, 42);
      expect(existsSync(wt.path)).toBe(false);
      const branches = execSync("git branch --list afk/issue-42", { cwd: repo.dir, encoding: "utf8" });
      expect(branches.trim()).toBe("");
    } finally {
      repo.cleanup();
    }
  });

  it("does not throw if worktree does not exist", () => {
    const repo = mkTmpRepo();
    try {
      expect(() => destroyWorktree(repo.dir, 999)).not.toThrow();
    } finally {
      repo.cleanup();
    }
  });
});

describe("ensureGitignore", () => {
  it("adds .afk-loop/ to .gitignore if missing", () => {
    const repo = mkTmpRepo();
    try {
      ensureGitignore(repo.dir);
      const content = readFileSync(join(repo.dir, ".gitignore"), "utf8");
      expect(content).toContain(".afk-loop/");
    } finally {
      repo.cleanup();
    }
  });

  it("is idempotent", () => {
    const repo = mkTmpRepo();
    try {
      ensureGitignore(repo.dir);
      ensureGitignore(repo.dir);
      const content = readFileSync(join(repo.dir, ".gitignore"), "utf8");
      const occurrences = (content.match(/\.afk-loop\//g) ?? []).length;
      expect(occurrences).toBe(1);
    } finally {
      repo.cleanup();
    }
  });
});
