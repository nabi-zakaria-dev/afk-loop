import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState, markInFlight, clearInFlight, markFailed, reconcileInFlight, type State } from "../src/state.ts";

const mkDir = (): string => mkdtempSync(join(tmpdir(), "afk-state-"));

describe("loadState / saveState", () => {
  it("returns defaults when state.json is missing", () => {
    const dir = mkDir();
    try {
      const state = loadState(dir);
      expect(state.schemaVersion).toBe(1);
      expect(state.rateLimitedUntil).toBeNull();
      expect(state.inFlight).toEqual({});
      expect(state.failedThisRun).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a full state", () => {
    const dir = mkDir();
    try {
      const original: State = {
        schemaVersion: 1,
        rateLimitedUntil: "2030-01-01T00:00:00Z",
        inFlight: {
          42: { phase: "implementer", branch: "afk/issue-42", startedAt: "2030-01-01T00:00:00Z", pid: 12345 },
        },
        failedThisRun: [41],
      };
      saveState(dir, original);
      const loaded = loadState(dir);
      expect(loaded).toEqual(original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("atomic write: a stray .tmp file does not corrupt loadState", () => {
    const dir = mkDir();
    try {
      const stateDir = join(dir, ".afk-loop");
      mkdirSync(stateDir, { recursive: true });
      // Pretend a previous write was interrupted: only .tmp exists, real file does not.
      writeFileSync(join(stateDir, "state.json.tmp"), "{garbage");
      const state = loadState(dir);
      // Defaults returned (no real state.json exists yet).
      expect(state.failedThisRun).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("markInFlight + clearInFlight update state on disk", () => {
    const dir = mkDir();
    try {
      let state = loadState(dir);
      state = markInFlight(state, 7, { phase: "implementer", branch: "afk/issue-7", pid: 99999 });
      saveState(dir, state);
      const reloaded = loadState(dir);
      expect(reloaded.inFlight[7]).toBeDefined();
      const cleared = clearInFlight(reloaded, 7);
      saveState(dir, cleared);
      expect(loadState(dir).inFlight[7]).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("markFailed adds to failedThisRun without duplicates", () => {
    const dir = mkDir();
    try {
      let state = loadState(dir);
      state = markFailed(state, 42);
      state = markFailed(state, 42);
      state = markFailed(state, 43);
      expect(state.failedThisRun.sort()).toEqual([42, 43]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reconcileInFlight (orphan detection)", () => {
  it("clears inFlight entries whose PIDs are dead", () => {
    let state: State = {
      schemaVersion: 1,
      rateLimitedUntil: null,
      inFlight: {
        42: { phase: "implementer", branch: "afk/issue-42", startedAt: "2030-01-01T00:00:00Z", pid: 1 }, // PID 1 (init) still alive
        43: { phase: "implementer", branch: "afk/issue-43", startedAt: "2030-01-01T00:00:00Z", pid: 9999999 }, // unlikely to exist
      },
      failedThisRun: [],
    };
    state = reconcileInFlight(state);
    expect(state.inFlight[43]).toBeUndefined();
  });
});
