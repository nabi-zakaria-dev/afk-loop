import { describe, it, expect } from "vitest";
import { renderFrame } from "../src/watch.ts";
import type { StatusJson } from "../src/observability.ts";

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
