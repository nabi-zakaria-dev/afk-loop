import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkTmpRepo } from "./helpers/tmp-repo.ts";
import { initTarget } from "../src/init.ts";

describe("initTarget", () => {
  it("creates config.json + CODING_STANDARDS.md and updates .gitignore", () => {
    const repo = mkTmpRepo();
    try {
      initTarget(repo.dir);
      expect(existsSync(join(repo.dir, ".afk-loop", "config.json"))).toBe(true);
      expect(existsSync(join(repo.dir, ".afk-loop", "CODING_STANDARDS.md"))).toBe(true);
      const cfg = JSON.parse(readFileSync(join(repo.dir, ".afk-loop", "config.json"), "utf8"));
      expect(cfg.label).toBe("AFK");
      expect(cfg.maxParallel).toBe(3);
      const gitignore = readFileSync(join(repo.dir, ".gitignore"), "utf8");
      expect(gitignore).toContain(".afk-loop/");
    } finally {
      repo.cleanup();
    }
  });

  it("refuses to overwrite an existing config.json without --force", () => {
    const repo = mkTmpRepo({ withConfig: { label: "Existing" } });
    try {
      expect(() => initTarget(repo.dir)).toThrow(/already exists/i);
    } finally {
      repo.cleanup();
    }
  });

  it("overwrites config.json when force=true", () => {
    const repo = mkTmpRepo({ withConfig: { label: "Existing" } });
    try {
      initTarget(repo.dir, { force: true });
      const cfg = JSON.parse(readFileSync(join(repo.dir, ".afk-loop", "config.json"), "utf8"));
      expect(cfg.label).toBe("AFK");
    } finally {
      repo.cleanup();
    }
  });
});
