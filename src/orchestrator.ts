import type { Config } from "./config.ts";
import { fetchAfkIssues, type Issue } from "./issues.ts";
import { branchName, computeFrontier, detectCycles } from "./depgraph.ts";
import { createWorktree, ensureGitignore } from "./worktree.ts";
import { runImplementer, runReviewer, runAdvisoryPlanner } from "./phases.ts";
import { mergeBranches, type MergeResult } from "./merger.ts";
import {
  loadState,
  saveState,
  markFailed,
  reconcileInFlight,
  setRateLimitedUntil,
  type State,
} from "./state.ts";
import {
  appendSummarySection,
  writeStatus,
  formatIterationSection,
  notify as defaultNotify,
  commitUrl,
  type NotifyEvent,
  type InFlightItem,
  type QueuedItem,
  type DoneItem,
  type FailedItem,
} from "./observability.ts";
import { parseAcceptanceCriteria } from "./ac-progress.ts";
import { execFileSync } from "node:child_process";

export type ExitReason = "DONE" | "TIME_BUDGET" | "CYCLE" | "RATE_LIMITED";

export interface IterationOutcome {
  iteration: number;
  frontier: Issue[];
  implemented: number[];
  approvedForMerge: number[];
  failedImplementer: number[];
  failedReviewer: number[];
  rateLimited: boolean;
  rateLimitedUntil?: string;
  merge?: MergeResult;
  cycleDetected?: number[][];
  advisoryConcerns?: string;
}

export interface RunOpts {
  cwd: string;
  config: Config;
  maxParallel?: number;
  once?: boolean;
  fetchIssues?: () => Issue[];
  ghRun?: (args: string[]) => void;
  claudeBin?: string;
  failedThisRun?: number[];
  /** Test-only hook to override the implementer scenario for a given issue number. */
  envForIssue?: (issue: Issue) => Record<string, string> | undefined;
  /** Async sleep injected for tests; defaults to setTimeout-based wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Test override of "now" used for rate-limit math. */
  now?: () => number;
  /** Notification callback (defaults to osascript on macOS, no-op elsewhere). */
  notify?: (event: NotifyEvent, message: string) => void;
  /** Streaming progress callback (defaults to timestamped lines on stderr). */
  progress?: (event: ProgressEvent, message: string) => void;
  /** Override for repo slug derivation (default: gh repo view nameWithOwner). */
  repoSlug?: string;
  /** Disable filesystem observability (summary.md / status.json). For tests. */
  disableObservability?: boolean;
}

export type ProgressEvent =
  | "runStarted"
  | "iterationStarted"
  | "frontierPicked"
  | "advisoryRunning"
  | "advisoryDone"
  | "worktreeReady"
  | "implementerStarted"
  | "implementerComplete"
  | "reviewerStarted"
  | "reviewerComplete"
  | "mergerStarted"
  | "mergerComplete"
  | "iterationCompleted"
  | "rateLimitPaused"
  | "runFinished"
  | "warning";

export interface RunResult {
  exit: ExitReason;
  iterations: IterationOutcome[];
}

const defaultProgress = (event: ProgressEvent, message: string): void => {
  const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
  process.stderr.write(`[afk-loop ${ts}] ${event.padEnd(20)} ${message}\n`);
};

export async function runIteration(opts: RunOpts, iteration: number): Promise<IterationOutcome> {
  const progress = opts.progress ?? defaultProgress;
  progress("iterationStarted", `iter ${iteration}: fetching open AFK issues`);
  const cap = Math.min(opts.maxParallel ?? opts.config.maxParallel, opts.config.maxParallel);
  const fetcher = opts.fetchIssues ?? (() => fetchAfkIssues({
    label: opts.config.label,
    hitlPattern: opts.config.hitlPattern,
    cwd: opts.cwd,
  }));
  const issues = fetcher();
  const cycles = detectCycles(issues);
  if (cycles.length > 0) {
    return {
      iteration,
      frontier: [],
      implemented: [],
      approvedForMerge: [],
      failedImplementer: [],
      failedReviewer: [],
      rateLimited: false,
      cycleDetected: cycles,
    };
  }
  const frontier = computeFrontier(issues, { maxParallel: cap, failedThisRun: opts.failedThisRun ?? [] });
  progress(
    "frontierPicked",
    frontier.length === 0
      ? `iter ${iteration}: frontier empty (${issues.length} open, ${opts.failedThisRun?.length ?? 0} skipped)`
      : `iter ${iteration}: frontier = [${frontier.map((i) => `#${i.number}`).join(", ")}]`,
  );
  if (frontier.length === 0) {
    return {
      iteration,
      frontier: [],
      implemented: [],
      approvedForMerge: [],
      failedImplementer: [],
      failedReviewer: [],
      rateLimited: false,
    };
  }

  ensureGitignore(opts.cwd);

  let advisoryConcerns: string | undefined;
  if (opts.config.advisoryPlanner && frontier.length > 0) {
    progress("advisoryRunning", `iter ${iteration}: advisory planner running (max 3 turns)`);
    const advCall: Parameters<typeof runAdvisoryPlanner>[0] = {
      targetDir: opts.cwd,
      iteration,
      frontier,
    };
    if (opts.claudeBin !== undefined) advCall.claudeBin = opts.claudeBin;
    const adv = await runAdvisoryPlanner(advCall);
    advisoryConcerns = adv.concerns;
    progress("advisoryDone", `iter ${iteration}: advisory ${adv.outcome} — ${adv.concerns.slice(0, 80)}`);
  }

  // Pre-create worktrees serially — git's index lock makes concurrent
  // worktree creation flaky. Implementers and reviewers can then run
  // in parallel against pre-existing worktrees safely.
  for (const issue of frontier) {
    createWorktree(opts.cwd, issue.number, opts.config.mainBranch);
    progress("worktreeReady", `iter ${iteration}: worktree ready for #${issue.number}`);
  }

  const inFlightByIssue = new Map<number, InFlightItem>();
  if (!opts.disableObservability) {
    const startedAt = new Date().toISOString();
    for (const issue of frontier) {
      inFlightByIssue.set(issue.number, {
        issue: issue.number,
        title: issue.title,
        phase: "implementer",
        startedAt,
        lastTransitionAt: startedAt,
        acs: parseAcceptanceCriteria(issue.body),
      });
    }
    const frontierNumbers = new Set(frontier.map((i) => i.number));
    const failedSet = new Set(opts.failedThisRun ?? []);
    const queued: QueuedItem[] = issues
      .filter((i) => !frontierNumbers.has(i.number) && !i.isHITL && !failedSet.has(i.number))
      .map((i) => ({ issue: i.number, title: i.title }));
    writeStatus(opts.cwd, {
      currentIteration: iteration,
      frontier: frontier.map((i) => i.number),
      inFlight: [...inFlightByIssue.values()],
      queued,
      lastEventAt: startedAt,
      runState: "running",
    });
  }
  progress("implementerStarted", `iter ${iteration}: spawning ${frontier.length} implementer(s) in parallel`);
  const implResults = await Promise.allSettled(
    frontier.map(async (issue) => {
      const env = opts.envForIssue?.(issue);
      const implCall: Parameters<typeof runImplementer>[0] = {
        targetDir: opts.cwd,
        issue,
        mainBranch: opts.config.mainBranch,
        maxTurns: opts.config.maxTurnsPerImplementer,
        iteration,
      };
      if (opts.claudeBin !== undefined) implCall.claudeBin = opts.claudeBin;
      if (env !== undefined) implCall.env = env;
      const result = await runImplementer(implCall);
      progress(
        "implementerComplete",
        `iter ${iteration}: #${issue.number} implementer outcome=${result.outcome} commits=${result.commits.length}`,
      );
      return { issue, result };
    }),
  );

  const implemented: number[] = [];
  const failedImpl: number[] = [];
  const failedRev: number[] = [];
  const approved: { number: number; branch: string; title: string }[] = [];
  let rateLimited = false;
  let rateLimitedUntil: string | undefined;
  const toReview: Issue[] = [];

  for (const settled of implResults) {
    if (settled.status === "rejected") continue;
    const { issue, result } = settled.value;
    if (result.outcome === "rate-limited") {
      rateLimited = true;
      if (result.rateLimitedUntil !== undefined && rateLimitedUntil === undefined) {
        rateLimitedUntil = result.rateLimitedUntil;
      }
      continue;
    }
    if (result.outcome === "complete" && result.commits.length > 0) {
      implemented.push(issue.number);
      toReview.push(issue);
    } else {
      failedImpl.push(issue.number);
    }
  }

  if (toReview.length > 0) {
    if (!opts.disableObservability) {
      const transitionAt = new Date().toISOString();
      const updated: InFlightItem[] = [];
      for (const issue of toReview) {
        const prev = inFlightByIssue.get(issue.number);
        const next: InFlightItem = {
          issue: issue.number,
          title: issue.title,
          phase: "reviewer",
          startedAt: prev?.startedAt ?? transitionAt,
          lastTransitionAt: transitionAt,
        };
        inFlightByIssue.set(issue.number, next);
        updated.push(next);
      }
      writeStatus(opts.cwd, {
        currentIteration: iteration,
        frontier: frontier.map((i) => i.number),
        inFlight: updated,
        lastEventAt: transitionAt,
        runState: "running",
      });
    }
    progress("reviewerStarted", `iter ${iteration}: reviewing ${toReview.length} branch(es) with commits`);
    const revResults = await Promise.allSettled(
      toReview.map(async (issue) => {
        const env = opts.envForIssue?.(issue);
        const revCall: Parameters<typeof runReviewer>[0] = {
          targetDir: opts.cwd,
          issue,
          mainBranch: opts.config.mainBranch,
          iteration,
        };
        if (opts.claudeBin !== undefined) revCall.claudeBin = opts.claudeBin;
        if (env !== undefined) revCall.env = env;
        const result = await runReviewer(revCall);
        progress(
          "reviewerComplete",
          `iter ${iteration}: #${issue.number} reviewer verdict=${result.outcome === "complete" ? "approved" : "refused"}`,
        );
        return { issue, result };
      }),
    );

    for (const settled of revResults) {
      if (settled.status === "rejected") continue;
      const { issue, result } = settled.value;
      if (result.outcome === "rate-limited") {
        rateLimited = true;
        if (result.rateLimitedUntil !== undefined && rateLimitedUntil === undefined) {
          rateLimitedUntil = result.rateLimitedUntil;
        }
        continue;
      }
      if (result.outcome === "complete") {
        approved.push({ number: issue.number, branch: branchName(issue), title: issue.title });
      } else {
        failedRev.push(issue.number);
      }
    }
  }

  let merge: MergeResult | undefined;
  if (approved.length > 0) {
    progress("mergerStarted", `iter ${iteration}: merging ${approved.length} branch(es) into ${opts.config.mainBranch}`);
    const mergeOpts: Parameters<typeof mergeBranches>[0] = {
      cwd: opts.cwd,
      mainBranch: opts.config.mainBranch,
      branches: approved.map((a) => a.branch),
      issues: approved,
    };
    if (opts.ghRun !== undefined) mergeOpts.ghRun = opts.ghRun;
    merge = mergeBranches(mergeOpts);
    progress(
      "mergerComplete",
      `iter ${iteration}: merged=[${merge.merged.join(", ")}] failed=[${merge.failed.map((f) => f.issue).join(", ")}]`,
    );
  }

  progress(
    "iterationCompleted",
    `iter ${iteration}: ${implemented.length} implemented, ${approved.length} approved, ${merge?.merged.length ?? 0} merged, ${failedImpl.length + failedRev.length} failed`,
  );

  const out: IterationOutcome = {
    iteration,
    frontier,
    implemented,
    approvedForMerge: approved.map((a) => a.number),
    failedImplementer: failedImpl,
    failedReviewer: failedRev,
    rateLimited,
  };
  if (rateLimitedUntil !== undefined) out.rateLimitedUntil = rateLimitedUntil;
  if (merge !== undefined) out.merge = merge;
  if (advisoryConcerns !== undefined) out.advisoryConcerns = advisoryConcerns;
  return out;
}

export async function runOrchestrator(opts: RunOpts): Promise<RunResult> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const notify = opts.notify ?? ((event: NotifyEvent, msg: string) => defaultNotify(event, msg));
  const progress = opts.progress ?? defaultProgress;
  const budgetMs = opts.config.runtimeBudgetHours * 60 * 60 * 1000;
  const startedAt = now();
  const obs = !opts.disableObservability;
  const repoSlug = opts.repoSlug ?? deriveRepoSlug(opts.cwd);

  // Hydrate persisted state and reconcile orphans before any new work starts.
  let state = reconcileInFlight(loadState(opts.cwd));
  saveState(opts.cwd, state);

  // If we crashed/exited during a previous rate-limit pause, sleep the remainder.
  await waitOutRateLimit(state, sleep, now, notify);

  // Initial run-started notification + status.
  progress("runStarted", `afk-loop run started — runtimeBudget=${opts.config.runtimeBudgetHours}h maxParallel=${opts.maxParallel ?? opts.config.maxParallel}`);
  notify("runStarted", "AFK loop started");
  if (obs) writeStatus(opts.cwd, { currentIteration: 0, frontier: [], inFlight: [], lastEventAt: new Date().toISOString(), runState: "running" });

  const iterations: IterationOutcome[] = [];
  const runDone: DoneItem[] = [];
  const runFailed: FailedItem[] = [];
  let i = 1;
  while (true) {
    const failedThisRun = opts.failedThisRun ?? state.failedThisRun;
    const outcome = await runIteration({ ...opts, failedThisRun }, i);
    iterations.push(outcome);

    state = applyOutcomeToState(state, outcome);
    saveState(opts.cwd, state);

    // Per-iteration observability: summary section + live status.
    if (obs) {
      const commitUrls: Record<number, string> = {};
      const merged = outcome.merge?.merged ?? [];
      const failedMerge = outcome.merge?.failed ?? [];
      if (repoSlug) {
        for (const issueNum of merged) {
          const sha = lastCommitOnBranch(opts.cwd, `afk/issue-${issueNum}`);
          if (sha) commitUrls[issueNum] = commitUrl(repoSlug, sha);
        }
      }
      for (const n of merged) {
        const item: DoneItem = { issue: n, outcome: "merged" };
        if (commitUrls[n]) item.commitUrl = commitUrls[n];
        runDone.push(item);
      }
      const logDir = (n: number): string => `.afk-loop/logs/issue-${n}`;
      for (const n of outcome.failedImplementer) {
        runFailed.push({
          issue: n,
          category: "implementer-incomplete",
          reason: "implementer did not complete (max turns or stuck)",
          logPath: logDir(n),
        });
      }
      for (const n of outcome.failedReviewer) {
        runFailed.push({
          issue: n,
          category: "reviewer-refused",
          reason: "reviewer refused (acceptance criteria unmet or tests failed)",
          logPath: logDir(n),
        });
      }
      for (const f of failedMerge) {
        runFailed.push({
          issue: f.issue,
          category: "merge-conflict",
          reason: f.reason,
          logPath: logDir(f.issue),
        });
      }
      const section = formatIterationSection({
        iteration: outcome.iteration,
        merged,
        failedImplementer: outcome.failedImplementer,
        failedReviewer: outcome.failedReviewer,
        mergeFailed: failedMerge,
        advisoryConcerns: outcome.advisoryConcerns,
        commitUrls,
      });
      appendSummarySection(opts.cwd, section);
      writeStatus(opts.cwd, {
        currentIteration: outcome.iteration,
        frontier: outcome.frontier.map((iss) => iss.number),
        inFlight: [],
        done: runDone,
        failed: runFailed,
        lastEventAt: new Date().toISOString(),
        runState: outcome.rateLimited ? "paused" : "running",
      });
      const summary = `iter ${outcome.iteration}: ${merged.length} merged, ${outcome.failedImplementer.length + outcome.failedReviewer.length + failedMerge.length} failed`;
      notify("iterationCompleted", summary);
    }

    if (outcome.cycleDetected && outcome.cycleDetected.length > 0) {
      if (obs) appendSummarySection(opts.cwd, `\n## Run aborted: CYCLE\nCycle in dep-graph: ${JSON.stringify(outcome.cycleDetected)}\n`);
      progress("runFinished", `run aborted: CYCLE detected in dep-graph`);
      notify("runFinished", `AFK loop aborted: cycle detected in dep-graph`);
      if (obs) writeStatus(opts.cwd, { currentIteration: i, frontier: [], inFlight: [], done: runDone, failed: runFailed, lastEventAt: new Date().toISOString(), runState: "failed" });
      return { exit: "CYCLE", iterations };
    }

    if (outcome.rateLimited) {
      progress("rateLimitPaused", `rate-limited — pausing until ${state.rateLimitedUntil ?? "unknown"}`);
      if (opts.once) {
        if (obs) writeStatus(opts.cwd, { currentIteration: i, frontier: [], inFlight: [], done: runDone, failed: runFailed, lastEventAt: new Date().toISOString(), runState: "paused" });
        progress("runFinished", "run exited: RATE_LIMITED (--once)");
        return { exit: "RATE_LIMITED", iterations };
      }
      await waitOutRateLimit(state, sleep, now, notify);
      state = setRateLimitedUntil(state, null);
      saveState(opts.cwd, state);
      if (now() - startedAt >= budgetMs) {
        if (obs) appendSummarySection(opts.cwd, `\n## Run complete: TIME_BUDGET\n`);
        notify("runFinished", "AFK loop exited: TIME_BUDGET");
        return { exit: "TIME_BUDGET", iterations };
      }
      i++;
      continue;
    }
    if (outcome.frontier.length === 0) {
      if (obs) appendSummarySection(opts.cwd, `\n## Run complete: DONE\n`);
      if (obs) writeStatus(opts.cwd, { currentIteration: i, frontier: [], inFlight: [], done: runDone, failed: runFailed, lastEventAt: new Date().toISOString(), runState: "done" });
      progress("runFinished", `run complete: DONE after ${i} iteration(s)`);
      notify("runFinished", "AFK loop finished");
      return { exit: "DONE", iterations };
    }
    if (opts.once) {
      if (obs) writeStatus(opts.cwd, { currentIteration: i, frontier: [], inFlight: [], done: runDone, failed: runFailed, lastEventAt: new Date().toISOString(), runState: "done" });
      progress("runFinished", "run complete: DONE (--once)");
      notify("runFinished", "AFK loop finished (once)");
      return { exit: "DONE", iterations };
    }
    if (now() - startedAt >= budgetMs) {
      if (obs) appendSummarySection(opts.cwd, `\n## Run complete: TIME_BUDGET\n`);
      progress("runFinished", "run complete: TIME_BUDGET (wall-clock budget exceeded)");
      notify("runFinished", "AFK loop exited: TIME_BUDGET");
      return { exit: "TIME_BUDGET", iterations };
    }
    i++;
  }
}

function deriveRepoSlug(cwd: string): string | undefined {
  try {
    const out = execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

function lastCommitOnBranch(cwd: string, branch: string): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-n", "1", "--format=%H", branch], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function waitOutRateLimit(
  state: State,
  sleep: (ms: number) => Promise<void>,
  now: () => number,
  notify: (event: NotifyEvent, message: string) => void,
): Promise<void> {
  if (!state.rateLimitedUntil) return;
  const target = Date.parse(state.rateLimitedUntil);
  if (!Number.isFinite(target)) return;
  const ms = target - now();
  if (ms <= 0) return;
  notify("rateLimitPaused", `AFK loop paused until ${state.rateLimitedUntil} (${Math.round(ms / 60000)}min)`);
  await sleep(ms);
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function applyOutcomeToState(state: State, outcome: IterationOutcome): State {
  let next = state;
  for (const issueNum of outcome.failedImplementer) next = markFailed(next, issueNum);
  for (const issueNum of outcome.failedReviewer) next = markFailed(next, issueNum);
  if (outcome.merge) {
    for (const failure of outcome.merge.failed) next = markFailed(next, failure.issue);
  }
  if (outcome.rateLimited && outcome.rateLimitedUntil) {
    next = setRateLimitedUntil(next, outcome.rateLimitedUntil);
  } else if (!outcome.rateLimited && next.rateLimitedUntil !== null) {
    next = setRateLimitedUntil(next, null);
  }
  return next;
}
