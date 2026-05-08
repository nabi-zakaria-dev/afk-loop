import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFrame } from "../src/watch.ts";
import { writeStatus, type StatusJson, type InFlightItem } from "../src/observability.ts";

const mkDir = (): string => mkdtempSync(join(tmpdir(), "afk-watch-"));

describe("renderFrame", () => {
  it("includes the current iteration and run state in the header", () => {
    const status: StatusJson = {
      currentIteration: 2,
      frontier: [],
      inFlight: [],
      lastEventAt: "2026-05-08T14:32:01Z",
      runState: "running",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("iter 2");
    expect(frame).toContain("running");
  });

  it("renders one line per inFlight item with issue, phase, title, and elapsed", () => {
    const status: StatusJson = {
      currentIteration: 2,
      frontier: [],
      inFlight: [
        {
          issue: 42,
          title: "Display pending invoices",
          phase: "implementer",
          startedAt: "2026-05-08T14:30:00Z",
          lastTransitionAt: "2026-05-08T14:30:00Z",
        },
      ],
      lastEventAt: "2026-05-08T14:31:12Z",
      runState: "running",
    };
    const frame = renderFrame(status, { now: new Date("2026-05-08T14:31:12Z") });
    expect(frame).toContain("#42");
    expect(frame).toContain("impl");
    expect(frame).toContain("Display pending invoices");
    expect(frame).toContain("1m 12s");
  });

  it("shows 'no issues in flight' when inFlight is empty", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      lastEventAt: "2026-05-08T14:32:01Z",
      runState: "running",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("no issues in flight");
  });
});

describe("writeStatus inFlight shape", () => {
  it("roundtrips InFlightItem entries with issue, title, phase, and timestamps", () => {
    const dir = mkDir();
    try {
      const item: InFlightItem = {
        issue: 42,
        title: "Display pending invoices",
        phase: "implementer",
        startedAt: "2026-05-08T14:30:11Z",
        lastTransitionAt: "2026-05-08T14:30:11Z",
      };
      const status: StatusJson = {
        currentIteration: 1,
        frontier: [42],
        inFlight: [item],
        lastEventAt: "2026-05-08T14:30:11Z",
        runState: "running",
      };
      writeStatus(dir, status);
      const parsed = JSON.parse(readFileSync(join(dir, ".afk-loop", "status.json"), "utf8")) as StatusJson;
      expect(parsed.inFlight).toHaveLength(1);
      expect(parsed.inFlight[0]).toMatchObject({
        issue: 42,
        title: "Display pending invoices",
        phase: "implementer",
        startedAt: "2026-05-08T14:30:11Z",
        lastTransitionAt: "2026-05-08T14:30:11Z",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
