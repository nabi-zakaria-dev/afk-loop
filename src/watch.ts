import type { StatusJson } from "./observability.ts";

export function renderFrame(status: StatusJson): string {
  const header = `afk-loop · iter ${status.currentIteration} · ${status.runState}`;
  const body = status.inFlight.length === 0 ? "no issues in flight" : "";
  return [header, body].join("\n");
}
