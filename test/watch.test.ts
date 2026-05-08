import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFrame, watchLoop } from "../src/watch.ts";
import { writeStatus, type StatusJson, type InFlightItem } from "../src/observability.ts";

const mkDir = (): string => mkdtempSync(join(tmpdir(), "afk-watch-"));

const baseStatus = (iter: number): StatusJson => ({
  currentIteration: iter,
  frontier: [],
  inFlight: [],
  lastEventAt: "2026-05-08T14:30:00Z",
  runState: "running",
});

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

describe("watchLoop", () => {
  it("writes a rendered frame on initial call and on each tick", async () => {
    const writes: string[] = [];
    let tickFn: (() => void) | null = null;
    let keyHandler: ((k: string) => void) | null = null;

    const promise = watchLoop({
      readStatus: () => baseStatus(5),
      write: (s) => writes.push(s),
      onKey: (h) => {
        keyHandler = h;
        return () => {};
      },
      setInterval: (fn) => {
        tickFn = fn;
        return () => {};
      },
    });

    expect(writes.join("")).toContain("iter 5");

    const lengthBefore = writes.join("").length;
    tickFn!();
    expect(writes.join("").length).toBeGreaterThan(lengthBefore);

    keyHandler!("q");
    await promise;
  });

  it("only resolves on 'q' keypress, ignoring other keys", async () => {
    let keyHandler: ((k: string) => void) | null = null;
    let resolved = false;

    const promise = watchLoop({
      readStatus: () => baseStatus(1),
      write: () => {},
      onKey: (h) => {
        keyHandler = h;
        return () => {};
      },
      setInterval: () => () => {},
    }).then(() => {
      resolved = true;
    });

    keyHandler!("x");
    keyHandler!("a");
    keyHandler!("\r");
    await Promise.resolve();
    expect(resolved).toBe(false);

    keyHandler!("q");
    await promise;
    expect(resolved).toBe(true);
  });

  it("wraps output in alt-screen enter (start) and exit (end) escape sequences", async () => {
    const writes: string[] = [];
    let keyHandler: ((k: string) => void) | null = null;

    const promise = watchLoop({
      readStatus: () => baseStatus(7),
      write: (s) => writes.push(s),
      onKey: (h) => {
        keyHandler = h;
        return () => {};
      },
      setInterval: () => () => {},
    });

    // \x1b[?1049h is the standard alt-screen enter sequence
    expect(writes.join("")).toContain("\x1b[?1049h");

    keyHandler!("q");
    await promise;

    // \x1b[?1049l is the standard alt-screen exit sequence
    expect(writes.join("")).toContain("\x1b[?1049l");
    // Exit must come after enter
    const all = writes.join("");
    expect(all.indexOf("\x1b[?1049l")).toBeGreaterThan(all.indexOf("\x1b[?1049h"));
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
