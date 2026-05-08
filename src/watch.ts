import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InFlightItem, StatusJson } from "./observability.ts";

export interface RenderOpts {
  now?: Date;
  width?: number;
}

export interface WatchLoopDeps {
  readStatus: () => StatusJson | null;
  write: (s: string) => void;
  onKey: (handler: (key: string) => void) => () => void;
  setInterval: (fn: () => void, ms: number) => () => void;
}

export interface RunWatchDeps {
  cwd: string;
  log: (s: string) => void;
  loop: () => Promise<void>;
}

export async function runWatch(_deps: RunWatchDeps): Promise<number> {
  throw new Error("not implemented");
}

export const TICK_MS = 3000;
const ALT_SCREEN_ENTER = "\x1b[?1049h";
const ALT_SCREEN_EXIT = "\x1b[?1049l";
const CLEAR_AND_HOME = "\x1b[2J\x1b[H";

export function watchLoop(deps: WatchLoopDeps): Promise<void> {
  return new Promise<void>((resolve) => {
    deps.write(ALT_SCREEN_ENTER);
    const renderOnce = (): void => {
      const status = deps.readStatus();
      if (status === null) return;
      deps.write(CLEAR_AND_HOME + renderFrame(status));
    };
    renderOnce();
    const clearTick = deps.setInterval(renderOnce, TICK_MS);
    const unsubKey = deps.onKey((key) => {
      if (key === "q") {
        clearTick();
        unsubKey();
        deps.write(ALT_SCREEN_EXIT);
        resolve();
      }
    });
  });
}

const PHASE_LABEL: Record<InFlightItem["phase"], string> = {
  implementer: "impl",
  reviewer: "review",
  merger: "merge",
};

export function renderFrame(status: StatusJson, opts?: RenderOpts): string {
  const now = opts?.now ?? new Date();
  const header = `afk-loop · iter ${status.currentIteration} · ${status.runState}`;

  if (status.inFlight.length === 0) {
    return [header, "no issues in flight"].join("\n");
  }

  const lines = status.inFlight.map((item) => formatInFlight(item, now));
  return [header, ...lines].join("\n");
}

function formatInFlight(item: InFlightItem, now: Date): string {
  const phase = PHASE_LABEL[item.phase];
  const elapsedMs = now.getTime() - new Date(item.lastTransitionAt).getTime();
  const elapsed = formatElapsed(elapsedMs);
  return `#${item.issue} [${phase}] ${item.title} · ${elapsed}`;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
