import type { StatusJson } from "./observability.ts";

export function renderFrame(status: StatusJson): string {
  return `afk-loop · iter ${status.currentIteration} · ${status.runState}`;
}
