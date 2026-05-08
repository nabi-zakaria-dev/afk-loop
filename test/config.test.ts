import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

const mkTmpRepo = (configContent?: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "afk-loop-test-"));
  if (configContent !== undefined) {
    const afkDir = join(dir, ".afk-loop");
    mkdirSync(afkDir, { recursive: true });
    writeFileSync(join(afkDir, "config.json"), configContent);
  }
  return dir;
};

describe("loadConfig", () => {
  it("loads a valid config with all defaults", () => {
    const dir = mkTmpRepo(JSON.stringify({}));
    try {
      const cfg = loadConfig(dir);
      expect(cfg.label).toBe("AFK");
      expect(cfg.hitlPattern).toBe("\\[HITL\\]");
      expect(cfg.mainBranch).toBe("main");
      expect(cfg.maxParallel).toBe(3);
      expect(cfg.maxTurnsPerImplementer).toBe(50);
      expect(cfg.advisoryPlanner).toBe(false);
      expect(cfg.runtimeBudgetHours).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("respects user-supplied values", () => {
    const dir = mkTmpRepo(
      JSON.stringify({
        label: "Sandcastle",
        maxParallel: 5,
        advisoryPlanner: true,
      }),
    );
    try {
      const cfg = loadConfig(dir);
      expect(cfg.label).toBe("Sandcastle");
      expect(cfg.maxParallel).toBe(5);
      expect(cfg.advisoryPlanner).toBe(true);
      expect(cfg.mainBranch).toBe("main");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a friendly error if config.json is missing", () => {
    const dir = mkTmpRepo();
    try {
      expect(() => loadConfig(dir)).toThrow(/config\.json not found/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on invalid JSON", () => {
    const dir = mkTmpRepo("{not valid json");
    try {
      expect(() => loadConfig(dir)).toThrow(/invalid json/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on wrong type", () => {
    const dir = mkTmpRepo(JSON.stringify({ maxParallel: "three" }));
    try {
      expect(() => loadConfig(dir)).toThrow(/maxParallel/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
