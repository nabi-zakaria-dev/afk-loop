import { execFileSync, spawnSync } from "node:child_process";

export interface MergeIssueRef {
  number: number;
  branch: string;
  title: string;
}

export interface MergeOpts {
  cwd: string;
  mainBranch: string;
  branches: string[];
  issues: MergeIssueRef[];
  /** Inject a custom `gh` runner for tests (default: spawnSync gh). */
  ghRun?: (args: string[]) => void;
  /** Commands to run after a successful merge to verify (default: empty — skip). */
  checkCommands?: string[][];
}

export interface MergeFailure {
  issue: number;
  branch: string;
  reason: string;
}

export interface MergeResult {
  merged: number[];
  failed: MergeFailure[];
}

const defaultGhRun = (args: string[]): void => {
  const r = spawnSync("gh", args, { stdio: "inherit" });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed (exit ${r.status})`);
  }
};

export function mergeBranches(opts: MergeOpts): MergeResult {
  const ghRun = opts.ghRun ?? defaultGhRun;
  const merged: number[] = [];
  const failed: MergeFailure[] = [];

  // Always start on the main branch.
  execFileSync("git", ["checkout", "-q", opts.mainBranch], { cwd: opts.cwd });

  for (const branch of opts.branches) {
    const issue = opts.issues.find((i) => i.branch === branch);
    if (!issue) {
      failed.push({ issue: -1, branch, reason: "no matching issue" });
      continue;
    }

    const mergeAttempt = spawnSync("git", ["merge", "--no-edit", "--no-ff", branch], {
      cwd: opts.cwd,
      encoding: "utf8",
    });

    if (mergeAttempt.status !== 0) {
      // Conflict (or other merge error). Abort.
      spawnSync("git", ["merge", "--abort"], { cwd: opts.cwd, encoding: "utf8" });
      // If --abort itself fails (e.g. no merge in progress), reset hard.
      execFileSync("git", ["reset", "--hard", opts.mainBranch], { cwd: opts.cwd });
      const reason = (mergeAttempt.stderr || "merge conflict").split("\n")[0] ?? "merge conflict";
      failed.push({ issue: issue.number, branch, reason });
      tryGhComment(ghRun, issue.number, `AFK merger could not integrate cleanly: ${reason}`);
      continue;
    }

    // Optionally run check commands to confirm post-merge state is healthy.
    let checksFailed: string | null = null;
    for (const cmd of opts.checkCommands ?? []) {
      const [bin, ...args] = cmd;
      if (!bin) continue;
      const r = spawnSync(bin, args, { cwd: opts.cwd, stdio: "pipe", encoding: "utf8" });
      if (r.status !== 0) {
        checksFailed = `check failed: ${cmd.join(" ")}`;
        break;
      }
    }

    if (checksFailed !== null) {
      // Revert this merge by resetting to the pre-merge state.
      execFileSync("git", ["reset", "--hard", "HEAD~1"], { cwd: opts.cwd });
      failed.push({ issue: issue.number, branch, reason: checksFailed });
      tryGhComment(ghRun, issue.number, `AFK merger reverted: ${checksFailed}`);
      continue;
    }

    merged.push(issue.number);
    tryGh(ghRun, ["issue", "close", String(issue.number), "--comment", "Merged by afk-loop"]);
  }

  return { merged, failed };
}

function tryGh(ghRun: (args: string[]) => void, args: string[]): void {
  try {
    ghRun(args);
  } catch (err) {
    console.error(`gh call failed (continuing): ${(err as Error).message}`);
  }
}

function tryGhComment(ghRun: (args: string[]) => void, issue: number, body: string): void {
  tryGh(ghRun, ["issue", "comment", String(issue), "--body", body]);
}
