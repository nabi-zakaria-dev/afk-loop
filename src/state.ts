import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface InFlightEntry {
  phase: "implementer" | "reviewer" | "merger";
  branch: string;
  startedAt: string;
  pid: number;
}

export interface State {
  schemaVersion: 1;
  rateLimitedUntil: string | null;
  inFlight: Record<number, InFlightEntry>;
  failedThisRun: number[];
}

const DEFAULT: State = {
  schemaVersion: 1,
  rateLimitedUntil: null,
  inFlight: {},
  failedThisRun: [],
};

const stateDir = (target: string): string => join(target, ".afk-loop");
const statePath = (target: string): string => join(stateDir(target), "state.json");

export function loadState(target: string): State {
  const p = statePath(target);
  if (!existsSync(p)) return clone(DEFAULT);
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return clone(DEFAULT);
    return {
      schemaVersion: 1,
      rateLimitedUntil: typeof parsed.rateLimitedUntil === "string" ? parsed.rateLimitedUntil : null,
      inFlight: parsed.inFlight && typeof parsed.inFlight === "object" ? parsed.inFlight : {},
      failedThisRun: Array.isArray(parsed.failedThisRun) ? parsed.failedThisRun.filter((n: unknown) => typeof n === "number") : [],
    };
  } catch {
    return clone(DEFAULT);
  }
}

export function saveState(target: string, state: State): void {
  mkdirSync(stateDir(target), { recursive: true });
  const p = statePath(target);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, p);
}

export function markInFlight(
  state: State,
  issueNumber: number,
  entry: { phase: InFlightEntry["phase"]; branch: string; pid: number; startedAt?: string },
): State {
  const next = clone(state);
  next.inFlight[issueNumber] = {
    phase: entry.phase,
    branch: entry.branch,
    pid: entry.pid,
    startedAt: entry.startedAt ?? new Date().toISOString(),
  };
  return next;
}

export function clearInFlight(state: State, issueNumber: number): State {
  const next = clone(state);
  delete next.inFlight[issueNumber];
  return next;
}

export function markFailed(state: State, issueNumber: number): State {
  if (state.failedThisRun.includes(issueNumber)) return state;
  const next = clone(state);
  next.failedThisRun = [...next.failedThisRun, issueNumber];
  return next;
}

export function setRateLimitedUntil(state: State, iso: string | null): State {
  const next = clone(state);
  next.rateLimitedUntil = iso;
  return next;
}

export function reconcileInFlight(state: State): State {
  const next = clone(state);
  for (const [key, entry] of Object.entries(next.inFlight)) {
    if (!isProcessAlive(entry.pid)) {
      delete next.inFlight[Number(key)];
    }
  }
  return next;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EPERM") return true;
    return false;
  }
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
