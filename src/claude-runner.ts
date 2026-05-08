import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

export type Outcome = "complete" | "incomplete" | "rate-limited" | "error";

export interface RunOptions {
  cwd: string;
  prompt: string;
  userMessage: string;
  maxTurns: number;
  logPath: string;
  claudeBin?: string;
  env?: Record<string, string>;
  commitRange?: { from: string; to: string };
  permissionMode?: string;
  extraArgs?: string[];
}

export interface RunResult {
  outcome: Outcome;
  rateLimitedUntil?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  commits: string[];
}

const RATE_LIMIT_RE = /rate.?limit|usage limit|too many requests/i;
const ISO_RE = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/;

export async function runClaudePhase(opts: RunOptions): Promise<RunResult> {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const log = createWriteStream(opts.logPath, { flags: "a" });

  const bin = opts.claudeBin ?? "claude";
  const args = [
    "-p",
    "--max-turns",
    String(opts.maxTurns),
    "--output-format",
    "stream-json",
    "--permission-mode",
    opts.permissionMode ?? "bypassPermissions",
    "--append-system-prompt",
    opts.prompt,
    ...(opts.extraArgs ?? []),
    opts.userMessage,
  ];

  const child = spawn(bin, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    const s = chunk.toString("utf8");
    stdout += s;
    log.write(s);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });

  log.end();

  let outcome: Outcome;
  let rateLimitedUntil: string | undefined;

  if (RATE_LIMIT_RE.test(stderr) || (exitCode !== 0 && RATE_LIMIT_RE.test(stdout))) {
    outcome = "rate-limited";
    const isoMatch = (stderr + stdout).match(ISO_RE);
    rateLimitedUntil = isoMatch?.[1] ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
  } else if (exitCode !== 0) {
    outcome = "error";
  } else if (/<promise>\s*COMPLETE\s*<\/promise>/i.test(stdout)) {
    outcome = "complete";
  } else {
    outcome = "incomplete";
  }

  const commits = enumerateCommits(opts.cwd, opts.commitRange);

  const result: RunResult = { outcome, exitCode, stdout, stderr, commits };
  if (rateLimitedUntil !== undefined) result.rateLimitedUntil = rateLimitedUntil;
  return result;
}

function enumerateCommits(cwd: string, range: { from: string; to: string } | undefined): string[] {
  if (!range) return [];
  try {
    const out = execFileSync("git", ["log", "--format=%H", `${range.from}..${range.to}`], {
      cwd,
      encoding: "utf8",
    });
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
