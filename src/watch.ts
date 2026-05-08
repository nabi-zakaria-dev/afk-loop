import type { StatusJson } from "./observability.ts";

export interface RenderOpts {
  now?: Date;
  width?: number;
}

export function renderFrame(status: StatusJson, _opts?: RenderOpts): string {
  const header = `afk-loop · iter ${status.currentIteration} · ${status.runState}`;
  const body = status.inFlight.length === 0 ? "no issues in flight" : "";
  return [header, body].join("\n");
}
