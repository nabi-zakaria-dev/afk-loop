import { describe, it, expect } from "vitest";
import { migrateLabels } from "../src/migrate.ts";

describe("migrateLabels", () => {
  it("issues remove + add gh edit calls for each open issue", () => {
    const calls: string[][] = [];
    const result = migrateLabels({
      from: "Sandcastle",
      to: "AFK",
      ghJsonList: () => JSON.stringify([{ number: 42 }, { number: 43 }, { number: 44 }]),
      ghRun: (args) => { calls.push(args); },
    });
    expect(result.migrated).toBe(3);
    // Three edit calls (one per issue), each with both --remove-label and --add-label.
    const editCalls = calls.filter((c) => c[0] === "issue" && c[1] === "edit");
    expect(editCalls).toHaveLength(3);
    for (const c of editCalls) {
      expect(c).toContain("--remove-label");
      expect(c).toContain("Sandcastle");
      expect(c).toContain("--add-label");
      expect(c).toContain("AFK");
    }
  });

  it("returns 0 migrated when no issues match", () => {
    const calls: string[][] = [];
    const result = migrateLabels({
      from: "Sandcastle",
      to: "AFK",
      ghJsonList: () => "[]",
      ghRun: (args) => { calls.push(args); },
    });
    expect(result.migrated).toBe(0);
    expect(calls.filter((c) => c[1] === "edit")).toHaveLength(0);
  });

  it("dry-run does not invoke any gh edit calls", () => {
    const calls: string[][] = [];
    const result = migrateLabels({
      from: "Sandcastle",
      to: "AFK",
      dryRun: true,
      ghJsonList: () => JSON.stringify([{ number: 42 }]),
      ghRun: (args) => { calls.push(args); },
    });
    expect(result.migrated).toBe(0);
    expect(result.wouldMigrate).toBe(1);
    expect(calls.filter((c) => c[1] === "edit")).toHaveLength(0);
  });
});
