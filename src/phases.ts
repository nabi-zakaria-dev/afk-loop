import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { runClaudePhase, type RunResult } from "./claude-runner.ts";
import type { Issue } from "./issues.ts";
import { branchFor, worktreePath } from "./worktree.ts";

const PROMPTS_DIR = fileURLToPath(new URL("../prompts/", import.meta.url));

export const promptPath = (name: string): string => join(PROMPTS_DIR, name);

export function loadPrompt(name: string, vars: Record<string, string>): string {
  const raw = readFileSync(promptPath(name), "utf8");
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key) => (key in vars ? vars[key]! : `{{${key}}}`));
}

export interface ImplementerPhaseOpts {
  targetDir: string;
  issue: Issue;
  mainBranch: string;
  maxTurns: number;
  iteration?: number;
  claudeBin?: string;
  env?: Record<string, string>;
}

export interface PhaseResult extends RunResult {
  branch: string;
  issueNumber: number;
}

export async function runImplementer(opts: ImplementerPhaseOpts): Promise<PhaseResult> {
  const branch = branchFor(opts.issue.number);
  const cwd = worktreePath(opts.targetDir, opts.issue.number);
  const iteration = opts.iteration ?? 1;
  const logPath = join(opts.targetDir, ".afk-loop", "logs", `issue-${opts.issue.number}`, `implementer-iter-${iteration}.jsonl`);

  const prompt = loadPrompt("implement-prompt.md", {
    ISSUE_NUMBER: String(opts.issue.number),
    ISSUE_TITLE: opts.issue.title,
    BRANCH: branch,
    MAX_TURNS: String(opts.maxTurns),
  });

  const baseSha = resolveSha(cwd, opts.mainBranch);

  const runOpts: Parameters<typeof runClaudePhase>[0] = {
    cwd,
    prompt,
    userMessage: `Work on issue #${opts.issue.number} on branch ${branch}.`,
    maxTurns: opts.maxTurns,
    logPath,
    commitRange: { from: baseSha, to: "HEAD" },
  };
  if (opts.claudeBin !== undefined) runOpts.claudeBin = opts.claudeBin;
  if (opts.env !== undefined) runOpts.env = opts.env;
  const result = await runClaudePhase(runOpts);

  return { ...result, branch, issueNumber: opts.issue.number };
}

function resolveSha(cwd: string, ref: string): string {
  try {
    return execFileSync("git", ["rev-parse", ref], { cwd, encoding: "utf8" }).trim();
  } catch {
    return ref;
  }
}

export interface ReviewerPhaseOpts {
  targetDir: string;
  issue: Issue;
  mainBranch: string;
  iteration?: number;
  claudeBin?: string;
  env?: Record<string, string>;
}

export async function runReviewer(opts: ReviewerPhaseOpts): Promise<PhaseResult> {
  const branch = branchFor(opts.issue.number);
  const cwd = worktreePath(opts.targetDir, opts.issue.number);
  const iteration = opts.iteration ?? 1;
  const logPath = join(opts.targetDir, ".afk-loop", "logs", `issue-${opts.issue.number}`, `reviewer-iter-${iteration}.jsonl`);

  const standardsPath = join(opts.targetDir, ".afk-loop", "CODING_STANDARDS.md");
  const codingStandardsArg = existsSync(standardsPath) ? standardsPath : "";

  const touchedFiles = listTouchedFiles(cwd, opts.mainBranch, branch);

  const prompt = loadPrompt("review-prompt.md", {
    ISSUE_NUMBER: String(opts.issue.number),
    BRANCH: branch,
    SOURCE_BRANCH: opts.mainBranch,
    TOUCHED_FILES: touchedFiles.join("\n"),
    CODING_STANDARDS_PATH: codingStandardsArg,
  });

  const baseSha = resolveSha(cwd, opts.mainBranch);

  const runOpts: Parameters<typeof runClaudePhase>[0] = {
    cwd,
    prompt,
    userMessage: `Review the work on branch ${branch} for issue #${opts.issue.number}.`,
    maxTurns: 1,
    logPath,
    commitRange: { from: baseSha, to: "HEAD" },
  };
  if (opts.claudeBin !== undefined) runOpts.claudeBin = opts.claudeBin;
  if (opts.env !== undefined) runOpts.env = opts.env;
  const result = await runClaudePhase(runOpts);

  return { ...result, branch, issueNumber: opts.issue.number };
}

function listTouchedFiles(cwd: string, source: string, branch: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${source}...${branch}`], { cwd, encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export interface AdvisoryPhaseOpts {
  targetDir: string;
  iteration: number;
  frontier: Issue[];
  claudeBin?: string;
  env?: Record<string, string>;
}

export interface AdvisoryResult {
  concerns: string;
  outcome: "ok" | "rate-limited" | "error";
}

export async function runAdvisoryPlanner(opts: AdvisoryPhaseOpts): Promise<AdvisoryResult> {
  const cwd = opts.targetDir;
  const logPath = join(opts.targetDir, ".afk-loop", "logs", `advisory-iter-${opts.iteration}.jsonl`);

  const frontierJson = JSON.stringify(
    opts.frontier.map((i) => ({ number: i.number, title: i.title, branch: `afk/issue-${i.number}` })),
    null,
    2,
  );
  const issueBodies = opts.frontier
    .map((i) => `### Issue #${i.number}: ${i.title}\n\n${i.body || "(empty body)"}\n`)
    .join("\n");

  const prompt = loadPrompt("plan-prompt.md", {
    FRONTIER_JSON: frontierJson,
    ISSUE_BODIES: issueBodies,
  });

  const runOpts: Parameters<typeof runClaudePhase>[0] = {
    cwd,
    prompt,
    userMessage: `Advisory check for iteration ${opts.iteration}.`,
    maxTurns: 3,
    logPath,
  };
  if (opts.claudeBin !== undefined) runOpts.claudeBin = opts.claudeBin;
  if (opts.env !== undefined) runOpts.env = opts.env;
  const result = await runClaudePhase(runOpts);

  if (result.outcome === "rate-limited") {
    return { concerns: "(advisory skipped: rate-limited)", outcome: "rate-limited" };
  }
  if (result.outcome === "error") {
    return { concerns: "(advisory skipped: error)", outcome: "error" };
  }

  const match = result.stdout.match(/<concerns>([\s\S]*?)<\/concerns>/i);
  const concerns = match ? match[1]!.trim() : "(advisory output missing <concerns> tag)";
  return { concerns, outcome: "ok" };
}
