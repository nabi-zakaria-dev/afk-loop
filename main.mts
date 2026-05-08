#!/usr/bin/env -S npx tsx
import { loadConfig } from "./src/config.ts";
import { fetchAfkIssues } from "./src/issues.ts";
import { detectCycles, computeFrontier, branchName } from "./src/depgraph.ts";
import { createWorktree, destroyWorktree, ensureGitignore } from "./src/worktree.ts";
import { runImplementer, runReviewer } from "./src/phases.ts";
import { mergeBranches } from "./src/merger.ts";
import { runOrchestrator } from "./src/orchestrator.ts";
import { migrateLabels } from "./src/migrate.ts";
import { initTarget } from "./src/init.ts";

type Subcommand =
  | "plan"
  | "create-worktree"
  | "destroy-worktree"
  | "implement"
  | "review"
  | "merge"
  | "run"
  | "migrate-labels"
  | "init"
  | "help";
const KNOWN: Subcommand[] = [
  "plan",
  "create-worktree",
  "destroy-worktree",
  "implement",
  "review",
  "merge",
  "run",
  "migrate-labels",
  "init",
  "help",
];

function parseArgs(argv: string[]): { sub: Subcommand; rest: string[] } {
  const [, , sub, ...rest] = argv;
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") return { sub: "help", rest: [] };
  if ((KNOWN as string[]).includes(sub)) return { sub: sub as Subcommand, rest };
  console.error(`Unknown subcommand: ${sub}`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  console.log(`afk-loop — personal AFK orchestrator

Usage:
  afk-loop plan                       Print the unblocked frontier as JSON.
  afk-loop create-worktree <issue>    Create a sandboxed worktree for one issue.
  afk-loop destroy-worktree <issue>   Remove the worktree and branch (success-only cleanup).
  afk-loop implement <issue>          Run the implementer end-to-end for one issue.
  afk-loop review <issue>             Run the reviewer on the issue's existing AFK branch.
  afk-loop merge --branches <list>    Merge approved AFK branches into main; close issues on success.
  afk-loop run [--once] [--max-parallel N]
                                      Run the orchestrator (plan→implement→review→merge) one or more times.
  afk-loop migrate-labels --from <X> --to <Y> [--dry-run]
                                      Bulk-relabel open issues from <X> to <Y>.
  afk-loop init [--force]             Bootstrap .afk-loop/ in the current target repo.
  afk-loop help                       Show this message.

Run inside a target repo that has .afk-loop/config.json present.
`);
}

async function runPlan(): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const issues = fetchAfkIssues({ label: config.label, hitlPattern: config.hitlPattern, cwd });
  const cycles = detectCycles(issues);
  if (cycles.length > 0) {
    const formatted = cycles.map((c) => c.map((n) => `#${n}`).join(" → ") + ` → #${c[0]}`).join("\n  ");
    console.error(`Cycle detected in dep-graph. Aborting:\n  ${formatted}`);
    process.exit(2);
  }
  const frontier = computeFrontier(issues, { maxParallel: config.maxParallel, failedThisRun: [] });
  const out = {
    frontier: frontier.map((i) => ({ number: i.number, title: i.title, branch: branchName(i) })),
  };
  console.log(JSON.stringify(out, null, 2));
}

function parseIssueNumber(rest: string[], cmd: string): number {
  const arg = rest[0];
  if (!arg) {
    console.error(`Usage: afk-loop ${cmd} <issue-number>`);
    process.exit(1);
  }
  const n = Number.parseInt(arg, 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`Invalid issue number: ${arg}`);
    process.exit(1);
  }
  return n;
}

async function runCreateWorktree(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const issueNumber = parseIssueNumber(rest, "create-worktree");
  ensureGitignore(cwd);
  const wt = createWorktree(cwd, issueNumber, config.mainBranch);
  console.log(JSON.stringify({ path: wt.path, branch: wt.branch, issueNumber: wt.issueNumber }, null, 2));
}

async function runDestroyWorktree(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  // Don't require config for destroy — should always be safe to clean up.
  const issueNumber = parseIssueNumber(rest, "destroy-worktree");
  destroyWorktree(cwd, issueNumber);
  console.log(JSON.stringify({ destroyed: issueNumber }, null, 2));
}

async function runImplementCmd(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const issueNumber = parseIssueNumber(rest, "implement");
  const issues = fetchAfkIssues({ label: config.label, hitlPattern: config.hitlPattern, cwd });
  const issue = issues.find((i) => i.number === issueNumber);
  if (!issue) {
    console.error(`Issue #${issueNumber} not found among open AFK issues.`);
    process.exit(1);
  }
  ensureGitignore(cwd);
  createWorktree(cwd, issueNumber, config.mainBranch);
  const result = await runImplementer({
    targetDir: cwd,
    issue,
    mainBranch: config.mainBranch,
    maxTurns: config.maxTurnsPerImplementer,
  });
  const summary: Record<string, unknown> = {
    outcome: result.outcome,
    branch: result.branch,
    commits: result.commits,
  };
  if (result.rateLimitedUntil !== undefined) summary.rateLimitedUntil = result.rateLimitedUntil;
  console.log(JSON.stringify(summary, null, 2));
  if (result.outcome === "complete") return;
  process.exit(result.outcome === "rate-limited" ? 3 : 4);
}

async function runReviewCmd(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const issueNumber = parseIssueNumber(rest, "review");
  const issues = fetchAfkIssues({ label: config.label, hitlPattern: config.hitlPattern, cwd });
  const issue = issues.find((i) => i.number === issueNumber);
  if (!issue) {
    console.error(`Issue #${issueNumber} not found among open AFK issues.`);
    process.exit(1);
  }
  const result = await runReviewer({
    targetDir: cwd,
    issue,
    mainBranch: config.mainBranch,
  });
  const verdict = result.outcome === "complete" ? "approved" : "refused";
  const summary: Record<string, unknown> = {
    verdict,
    branch: result.branch,
    commits: result.commits,
  };
  if (result.rateLimitedUntil !== undefined) summary.rateLimitedUntil = result.rateLimitedUntil;
  console.log(JSON.stringify(summary, null, 2));
  if (verdict !== "approved") process.exit(4);
}

function parseFlag(rest: string[], flag: string): string | undefined {
  const idx = rest.indexOf(flag);
  if (idx === -1) return undefined;
  return rest[idx + 1];
}

async function runMergeCmd(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const branchesArg = parseFlag(rest, "--branches");
  if (!branchesArg) {
    console.error("Usage: afk-loop merge --branches afk/issue-42,afk/issue-44");
    process.exit(1);
  }
  const branches = branchesArg.split(",").map((b) => b.trim()).filter(Boolean);
  // Derive issue numbers from branch names.
  const issues = branches.map((b) => {
    const m = b.match(/issue-(\d+)/);
    return { number: m ? Number.parseInt(m[1] ?? "0", 10) : 0, branch: b, title: "" };
  });
  const result = mergeBranches({
    cwd,
    mainBranch: config.mainBranch,
    branches,
    issues,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed.length > 0 && result.merged.length === 0) process.exit(4);
}

async function runRunCmd(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const once = rest.includes("--once");
  const maxParallelArg = parseFlag(rest, "--max-parallel");
  const opts: Parameters<typeof runOrchestrator>[0] = { cwd, config, once };
  if (maxParallelArg !== undefined) {
    const n = Number.parseInt(maxParallelArg, 10);
    if (Number.isFinite(n) && n > 0) opts.maxParallel = n;
  }
  const result = await runOrchestrator(opts);
  console.log(JSON.stringify(result, null, 2));
  if (result.exit !== "DONE") process.exit(3);
}

async function runMigrateLabelsCmd(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const from = parseFlag(rest, "--from");
  const to = parseFlag(rest, "--to");
  const dryRun = rest.includes("--dry-run");
  if (!from || !to) {
    console.error("Usage: afk-loop migrate-labels --from <X> --to <Y> [--dry-run]");
    process.exit(1);
  }
  const result = migrateLabels({ from, to, cwd, dryRun });
  if (dryRun) {
    console.log(`would migrate ${result.wouldMigrate} issue(s) from "${from}" to "${to}"`);
  } else {
    console.log(`migrated ${result.migrated} issue(s) from "${from}" to "${to}"`);
  }
}

async function runInitCmd(rest: string[]): Promise<void> {
  const cwd = process.cwd();
  const force = rest.includes("--force");
  initTarget(cwd, { force });
  console.log(`afk-loop initialized at ${cwd}/.afk-loop/`);
  console.log("Next steps:");
  console.log("  1. Edit .afk-loop/config.json if defaults need tuning.");
  console.log("  2. Customize .afk-loop/CODING_STANDARDS.md with your conventions.");
  console.log("  3. Label some issues 'AFK' (or run `afk-loop migrate-labels --from Sandcastle --to AFK`).");
  console.log("  4. Run `afk-loop run` and walk away.");
}

async function main(): Promise<void> {
  const { sub, rest } = parseArgs(process.argv);
  switch (sub) {
    case "help":
      printHelp();
      return;
    case "plan":
      await runPlan();
      return;
    case "create-worktree":
      await runCreateWorktree(rest);
      return;
    case "destroy-worktree":
      await runDestroyWorktree(rest);
      return;
    case "implement":
      await runImplementCmd(rest);
      return;
    case "review":
      await runReviewCmd(rest);
      return;
    case "merge":
      await runMergeCmd(rest);
      return;
    case "run":
      await runRunCmd(rest);
      return;
    case "migrate-labels":
      await runMigrateLabelsCmd(rest);
      return;
    case "init":
      await runInitCmd(rest);
      return;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
