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

  it("renders AC progress count and current AC state in the one-liner when acs are set", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [
        {
          issue: 42,
          title: "Display pending invoices",
          phase: "implementer",
          startedAt: "2026-05-08T14:30:00Z",
          lastTransitionAt: "2026-05-08T14:30:00Z",
          acs: [
            { n: 1, title: "first", state: "green" },
            { n: 2, title: "second", state: "red" },
            { n: 3, title: "third", state: "pending" },
          ],
        },
      ],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };
    const frame = renderFrame(status, { now: new Date("2026-05-08T14:30:00Z") });
    expect(frame).toContain("1/3");
    expect(frame).toMatch(/AC\s*2/);
    expect(frame).toContain("RED");
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

  it("renders a RECENT section with merged ✅ entries and commit URL", () => {
    const status: StatusJson = {
      currentIteration: 2,
      frontier: [],
      inFlight: [],
      done: [{ issue: 41, outcome: "merged", commitUrl: "https://example.com/c/abc123" }],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("RECENT");
    expect(frame).toContain("✅");
    expect(frame).toContain("#41");
    expect(frame).toContain("https://example.com/c/abc123");
  });

  it("renders an ERRORS section with ⚠ reason and log path", () => {
    const status: StatusJson = {
      currentIteration: 2,
      frontier: [],
      inFlight: [],
      failed: [
        {
          issue: 40,
          category: "reviewer-refused",
          reason: "AC3 unverified",
          logPath: ".afk-loop/logs/issue-40/reviewer-iter-1.jsonl",
        },
      ],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("ERRORS");
    expect(frame).toContain("⚠");
    expect(frame).toContain("#40");
    expect(frame).toContain("AC3 unverified");
    expect(frame).toContain(".afk-loop/logs/issue-40/reviewer-iter-1.jsonl");
  });

  it("shows a RATE-LIMITED banner in the header when runState is 'paused'", () => {
    const status: StatusJson = {
      currentIteration: 2,
      frontier: [],
      inFlight: [],
      rateLimitedUntil: "2026-05-08T15:42:00Z",
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "paused",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("RATE-LIMITED");
    expect(frame).toContain("2026-05-08T15:42:00Z");
    expect(frame).toContain("⚠");
  });

  it("shows a CYCLE DETECTED banner when runState is 'failed'", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "failed",
    };
    const frame = renderFrame(status);
    expect(frame).toContain("CYCLE DETECTED");
    expect(frame).toContain("✗");
  });

  it("shows a STALE banner when lastEventAt is older than 5 minutes and runState is 'running'", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      lastEventAt: "2026-05-08T14:00:00Z",
      runState: "running",
    };
    const frame = renderFrame(status, { now: new Date("2026-05-08T14:30:00Z") });
    expect(frame).toContain("STALE");
    expect(frame).toContain("✗");
  });

  it("shows a 'complete' banner when runState is 'done'", () => {
    const status: StatusJson = {
      currentIteration: 3,
      frontier: [],
      inFlight: [],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "done",
    };
    const frame = renderFrame(status);
    expect(frame).toMatch(/complete/i);
    expect(frame).toContain("summary.md");
  });

  it("focus mode shows the targeted issue's title and full AC list with states", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [
        {
          issue: 42,
          title: "Display pending invoices",
          phase: "implementer",
          startedAt: "2026-05-08T14:30:00Z",
          lastTransitionAt: "2026-05-08T14:30:00Z",
          acs: [
            { n: 1, title: "first criterion", layer: "UI", state: "green", greenAt: "2026-05-08T14:31:00Z" },
            { n: 2, title: "second criterion", layer: "API", state: "red", redAt: "2026-05-08T14:31:30Z" },
          ],
        },
      ],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };
    const frame = renderFrame(status, { focus: 42 });
    expect(frame).toContain("Display pending invoices");
    expect(frame).toContain("AC 1");
    expect(frame).toContain("first criterion");
    expect(frame).toContain("AC 2");
    expect(frame).toContain("second criterion");
    expect(frame).toContain("green");
    expect(frame).toContain("red");
  });

  it("focus mode prints 'issue #N is not in flight' when target is not in-flight", () => {
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };
    const frame = renderFrame(status, { focus: 99 });
    expect(frame).toContain("#99");
    expect(frame).toContain("not in flight");
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

  it("dumps error reasons and log paths to scrollback (after alt-screen exit) when 'l' is pressed", async () => {
    const writes: string[] = [];
    let keyHandler: ((k: string) => void) | null = null;
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      failed: [
        {
          issue: 40,
          category: "reviewer-refused",
          reason: "AC3 unverified",
          logPath: ".afk-loop/logs/issue-40/",
        },
        {
          issue: 41,
          category: "implementer-incomplete",
          reason: "max turns reached",
          logPath: ".afk-loop/logs/issue-41/",
        },
      ],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };

    const promise = watchLoop({
      readStatus: () => status,
      write: (s) => writes.push(s),
      onKey: (h) => {
        keyHandler = h;
        return () => {};
      },
      setInterval: () => () => {},
    });

    keyHandler!("l");
    await promise;

    const all = writes.join("");
    const exitIdx = all.indexOf("\x1b[?1049l");
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    const afterExit = all.slice(exitIdx);
    expect(afterExit).toContain("AC3 unverified");
    expect(afterExit).toContain(".afk-loop/logs/issue-40/");
    expect(afterExit).toContain("max turns reached");
    expect(afterExit).toContain(".afk-loop/logs/issue-41/");
  });

  it("'q' keypress exits without dumping the error list (only 'l' does that)", async () => {
    const writes: string[] = [];
    let keyHandler: ((k: string) => void) | null = null;
    const status: StatusJson = {
      currentIteration: 1,
      frontier: [],
      inFlight: [],
      failed: [
        {
          issue: 40,
          category: "reviewer-refused",
          reason: "AC3 unverified",
          logPath: ".afk-loop/logs/issue-40/",
        },
      ],
      lastEventAt: "2026-05-08T14:30:00Z",
      runState: "running",
    };

    const promise = watchLoop({
      readStatus: () => status,
      write: (s) => writes.push(s),
      onKey: (h) => {
        keyHandler = h;
        return () => {};
      },
      setInterval: () => () => {},
    });

    keyHandler!("q");
    await promise;

    const all = writes.join("");
    const exitIdx = all.indexOf("\x1b[?1049l");
    expect(exitIdx).toBeGreaterThanOrEqual(0);
    const afterExit = all.slice(exitIdx);
    // After q-exit, no error list should be dumped
    expect(afterExit).not.toContain("AC3 unverified");
    expect(afterExit).not.toContain(".afk-loop/logs/issue-40/");
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

  it("forwards the focus option to the loop callback", async () => {
    const dir = mkDir();
    try {
      writeStatus(dir, baseStatus(1));
      let receivedFocus: number | undefined;
      await runWatch({
        cwd: dir,
        log: () => {},
        focus: 42,
        loop: async (f) => {
          receivedFocus = f;
        },
      });
      expect(receivedFocus).toBe(42);
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
