import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderFrame, runWatch, watchLoop } from "../src/watch.ts";
import {
  writeStatus,
  type StatusJson,
  type InFlightItem,
  type QueuedItem,
  type DoneItem,
  type FailedItem,
} from "../src/observability.ts";

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

  it("renders a QUEUE section listing queued items by # and title", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      queued: [
        { issue: 50, title: "Send invoice reminder" },
        { issue: 51, title: "Bulk-archive" },
      ],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("QUEUE");
    expect(frame).toContain("#50");
    expect(frame).toContain("Send invoice reminder");
    expect(frame).toContain("#51");
    expect(frame).toContain("Bulk-archive");
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

describe("runWatch", () => {
  it("invokes the loop and returns 0 when status.json exists", async () => {
    const dir = mkDir();
    try {
      writeStatus(dir, baseStatus(1));
      let loopCalled = false;
      const exitCode = await runWatch({
        cwd: dir,
        log: () => {},
        loop: async () => {
          loopCalled = true;
        },
      });
      expect(loopCalled).toBe(true);
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints 'no run in progress' and returns 0 when status.json is missing", async () => {
    const dir = mkDir();
    try {
      let loopCalled = false;
      const logs: string[] = [];
      const exitCode = await runWatch({
        cwd: dir,
        log: (s) => logs.push(s),
        loop: async () => {
          loopCalled = true;
        },
      });
      expect(loopCalled).toBe(false);
      expect(logs.join("\n")).toContain("no run in progress");
      expect(exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("roundtrips queued, done, and failed arrays", () => {
    const dir = mkDir();
    try {
      const queued: QueuedItem[] = [{ issue: 50, title: "Send invoice reminder" }];
      const done: DoneItem[] = [
        { issue: 41, outcome: "merged", commitUrl: "https://example.com/c/abc" },
      ];
      const failed: FailedItem[] = [
        {
          issue: 40,
          category: "reviewer-refused",
          reason: "AC3 unverified",
          logPath: ".afk-loop/logs/issue-40/reviewer-iter-1.jsonl",
        },
      ];
      const status: StatusJson = {
        currentIteration: 1,
        frontier: [],
        inFlight: [],
        queued,
        done,
        failed,
        lastEventAt: "2026-05-08T14:30:00Z",
        runState: "running",
      };
      writeStatus(dir, status);
      const parsed = JSON.parse(readFileSync(join(dir, ".afk-loop", "status.json"), "utf8")) as StatusJson;
      expect(parsed.queued).toEqual(queued);
      expect(parsed.done).toEqual(done);
      expect(parsed.failed).toEqual(failed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
