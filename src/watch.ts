import { existsSync } from "node:fs";
import { join } from "node:path";
import type { InFlightItem, StatusJson } from "./observability.ts";

export interface RenderOpts {
  now?: Date;
  width?: number;
  focus?: number;
}

export interface WatchLoopDeps {
  readStatus: () => StatusJson | null;
  write: (s: string) => void;
  onKey: (handler: (key: string) => void) => () => void;
  setInterval: (fn: () => void, ms: number) => () => void;
  renderOpts?: RenderOpts;
}

export interface RunWatchDeps {
  cwd: string;
  log: (s: string) => void;
  loop: (focus?: number) => Promise<void>;
  focus?: number;
}

export async function runWatch(deps: RunWatchDeps): Promise<number> {
  const path = join(deps.cwd, ".afk-loop", "status.json");
  if (!existsSync(path)) {
    deps.log("no run in progress");
    return 0;
  }
  await deps.loop(deps.focus);
  return 0;
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
      deps.write(CLEAR_AND_HOME + renderFrame(status, deps.renderOpts));
    };
    renderOnce();
    const clearTick = deps.setInterval(renderOnce, TICK_MS);
    const unsubKey = deps.onKey((key) => {
      if (key === "q") {
        clearTick();
        unsubKey();
        deps.write(ALT_SCREEN_EXIT);
        resolve();
      } else if (key === "l") {
        clearTick();
        unsubKey();
        deps.write(ALT_SCREEN_EXIT);
        const status = deps.readStatus();
        if (status?.failed && status.failed.length > 0) {
          deps.write(`\nERRORS (${status.failed.length}):\n`);
          for (const f of status.failed) {
            deps.write(`  ⚠ #${f.issue} ${f.category}: ${f.reason} · ${f.logPath}\n`);
          }
        }
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

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export function renderFrame(status: StatusJson, opts?: RenderOpts): string {
  const now = opts?.now ?? new Date();
  if (opts?.focus !== undefined) {
    return renderFocus(status, opts.focus, now);
  }
  const header = renderHeader(status, now);

  const sections: string[] = [header];
  if (status.inFlight.length === 0) {
    sections.push("no issues in flight");
  } else {
    sections.push(...status.inFlight.map((item) => formatInFlight(item, now)));
  }

  if (status.queued && status.queued.length > 0) {
    sections.push(`QUEUE (${status.queued.length})`);
    for (const q of status.queued) sections.push(`  #${q.issue} ${q.title}`);
  }

  if (status.done && status.done.length > 0) {
    sections.push("RECENT");
    for (const d of status.done) {
      const url = d.commitUrl ? ` · ${d.commitUrl}` : "";
      sections.push(`  ✅ #${d.issue} ${d.outcome}${url}`);
    }
  }

  if (status.failed && status.failed.length > 0) {
    sections.push(`ERRORS (${status.failed.length})`);
    for (const f of status.failed) {
      sections.push(`  ⚠ #${f.issue} ${f.category}: ${f.reason} · ${f.logPath}`);
    }
  }

  return sections.join("\n");
}

function renderFocus(status: StatusJson, focus: number, now: Date): string {
  const item = status.inFlight.find((i) => i.issue === focus);
  if (!item) {
    return `afk-loop · focus #${focus}\nissue #${focus} is not in flight`;
  }
  const phase = PHASE_LABEL[item.phase];
  const elapsed = formatElapsed(now.getTime() - new Date(item.lastTransitionAt).getTime());
  const lines = [`afk-loop · focus #${item.issue} · ${item.title}`, `[${phase}] · ${elapsed}`];
  if (!item.acs || item.acs.length === 0) {
    lines.push("(no acceptance criteria parsed)");
    return lines.join("\n");
  }
  for (const ac of item.acs) {
    const layer = ac.layer ? ` [${ac.layer}]` : "";
    const stamp = ac.greenAt ?? ac.redAt ?? "";
    const stampSuffix = stamp ? ` · ${stamp}` : "";
    lines.push(`  AC ${ac.n}${layer} ${ac.title} · ${ac.state}${stampSuffix}`);
  }
  return lines.join("\n");
}

function renderHeader(status: StatusJson, now: Date): string {
  const base = `afk-loop · iter ${status.currentIteration} · ${status.runState}`;
  if (status.runState === "paused") {
    const until = status.rateLimitedUntil ? ` until ${status.rateLimitedUntil}` : "";
    return `${base}\n⚠ RATE-LIMITED${until}`;
  }
  if (status.runState === "failed") {
    return `${base}\n✗ CYCLE DETECTED — run aborted`;
  }
  if (status.runState === "done") {
    return `${base}\n✅ run complete — see summary.md`;
  }
  if (status.runState === "running") {
    const ageMs = now.getTime() - new Date(status.lastEventAt).getTime();
    if (ageMs > STALE_THRESHOLD_MS) {
      const ageMin = Math.floor(ageMs / 60000);
      return `${base}\n✗ STALE (last event ${ageMin}m ago — orchestrator may have crashed)`;
    }
  }
  return base;
}

function formatInFlight(item: InFlightItem, now: Date): string {
  const phase = PHASE_LABEL[item.phase];
  const elapsedMs = now.getTime() - new Date(item.lastTransitionAt).getTime();
  const elapsed = formatElapsed(elapsedMs);
  const ac = formatAcSegment(item);
  return `#${item.issue} [${phase}] ${item.title}${ac} · ${elapsed}`;
}

function formatAcSegment(item: InFlightItem): string {
  if (!item.acs || item.acs.length === 0) return "";
  const total = item.acs.length;
  const greenLike = item.acs.filter((a) => a.state === "green" || a.state === "refactored").length;
  const current = item.acs.find((a) => a.state === "red") ?? item.acs.find((a) => a.state === "pending");
  if (!current) return ` · ${greenLike}/${total}`;
  const stateLabel = current.state === "red" ? "RED" : "pending";
  return ` · ${greenLike}/${total} · AC${current.n} ${stateLabel}`;
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
