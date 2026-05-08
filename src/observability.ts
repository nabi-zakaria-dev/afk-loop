import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

export interface InFlightItem {
  issue: number;
  title: string;
  phase: "implementer" | "reviewer" | "merger";
  startedAt: string;
  lastTransitionAt: string;
}

export interface StatusJson {
  currentIteration: number;
  frontier: number[];
  inFlight: number[];
  lastEventAt: string;
  runState: "running" | "paused" | "done" | "failed";
}

export type NotifyEvent = "runStarted" | "rateLimitPaused" | "iterationCompleted" | "runFinished";

const obsDir = (target: string): string => join(target, ".afk-loop");
const summaryPath = (target: string): string => join(obsDir(target), "summary.md");
const statusPath = (target: string): string => join(obsDir(target), "status.json");

export function appendSummarySection(target: string, section: string): void {
  mkdirSync(obsDir(target), { recursive: true });
  const path = summaryPath(target);
  // Header is written if the file is missing OR empty (afk-loop init creates an
  // empty stub, so existsSync alone misses the case where the file exists but
  // has no header yet).
  const needsHeader = !existsSync(path) || readFileSync(path, "utf8").trim().length === 0;
  if (needsHeader) {
    const header = `# AFK Loop Run — ${new Date().toISOString()}\n\n`;
    writeFileSync(path, header);
  }
  const trailing = section.endsWith("\n") ? section : section + "\n";
  appendFileSync(path, trailing + "\n");
}

export function writeStatus(target: string, status: StatusJson): void {
  mkdirSync(obsDir(target), { recursive: true });
  writeFileSync(statusPath(target), JSON.stringify(status, null, 2));
}

export interface IterationSectionData {
  iteration: number;
  merged: number[];
  failedImplementer: number[];
  failedReviewer: number[];
  mergeFailed: { issue: number; reason: string }[];
  advisoryConcerns: string | undefined;
  commitUrls: Record<number, string>;
}

export function formatIterationSection(data: IterationSectionData): string {
  const lines: string[] = [];
  lines.push(`## Iteration ${data.iteration}`);
  lines.push("");
  if (data.merged.length > 0) {
    for (const n of data.merged) {
      const url = data.commitUrls[n];
      lines.push(`- ✅ #${n}${url ? ` — [commit](${url})` : ""}`);
    }
  }
  if (data.failedImplementer.length > 0) {
    for (const n of data.failedImplementer) {
      lines.push(`- ⚠️ #${n} — implementer did not complete (max turns or stuck)`);
    }
  }
  if (data.failedReviewer.length > 0) {
    for (const n of data.failedReviewer) {
      lines.push(`- ⚠️ #${n} — reviewer refused (acceptance criteria unmet or tests failed)`);
    }
  }
  if (data.mergeFailed.length > 0) {
    for (const f of data.mergeFailed) {
      lines.push(`- ⚠️ #${f.issue} — merge reverted: ${f.reason}`);
    }
  }
  if (data.merged.length === 0 && data.failedImplementer.length === 0 && data.failedReviewer.length === 0 && data.mergeFailed.length === 0) {
    lines.push("- (no work)");
  }
  if (data.advisoryConcerns && data.advisoryConcerns !== "None" && !data.advisoryConcerns.startsWith("(")) {
    lines.push("");
    lines.push("**Planner concerns:**");
    lines.push("");
    lines.push(data.advisoryConcerns);
  }
  return lines.join("\n");
}

export interface NotifyOpts {
  spawn?: (cmd: string, args: string[]) => void;
  platform?: NodeJS.Platform | string;
}

export function notify(event: NotifyEvent, message: string, opts: NotifyOpts = {}): void {
  const platform = opts.platform ?? process.platform;
  if (platform !== "darwin") return;
  const spawner = opts.spawn ?? defaultSpawn;
  const escaped = message.replace(/"/g, '\\"');
  const script = `display notification "${escaped}" with title "AFK Loop" subtitle "${event}"`;
  spawner("osascript", ["-e", script]);
}

function defaultSpawn(cmd: string, args: string[]): void {
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    /* swallow — notifications are best-effort */
  }
}

export function commitUrl(repoSlug: string, sha: string): string {
  return `https://github.com/${repoSlug}/commit/${sha}`;
}
