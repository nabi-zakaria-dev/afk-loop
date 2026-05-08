import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { execSync, execFileSync } from "node:child_process";

export const DENY_PATTERNS = [
  "Bash(rm -rf /)",
  "Bash(rm -rf ~)",
  "Bash(rm -rf ~/*)",
  "Bash(sudo *)",
  "Bash(sudo:*)",
  "Bash(git push --force*)",
  "Bash(git push -f*)",
  "Bash(git push --force-with-lease*)",
  "Bash(curl * | sh)",
  "Bash(curl * | bash)",
  "Bash(wget * | sh)",
  "Bash(wget * | bash)",
  "Bash(npm publish*)",
  "Bash(yarn publish*)",
  "Bash(pnpm publish*)",
  "Bash(gh release create*)",
];

export interface Worktree {
  path: string;
  branch: string;
  issueNumber: number;
}

export function worktreePath(targetDir: string, issueNumber: number): string {
  return join(targetDir, ".afk-loop", "worktrees", `issue-${issueNumber}`);
}

export function branchFor(issueNumber: number): string {
  return `afk/issue-${issueNumber}`;
}

export function createWorktree(targetDir: string, issueNumber: number, mainBranch: string): Worktree {
  const branch = branchFor(issueNumber);
  const path = worktreePath(targetDir, issueNumber);
  mkdirSync(join(targetDir, ".afk-loop", "worktrees"), { recursive: true });

  if (existsSync(path)) {
    // Already created (idempotent). Re-apply mitigations in case settings changed.
    writeDenyList(path);
    stripPush(path);
    return { path, branch, issueNumber };
  }

  const branchExists = listLocalBranches(targetDir).includes(branch);
  const args = branchExists
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, mainBranch];
  execFileSync("git", args, { cwd: targetDir, stdio: "ignore" });

  copyNodeModules(targetDir, path);
  copyEnv(targetDir, path);
  writeDenyList(path);
  stripPush(path);

  return { path, branch, issueNumber };
}

export function destroyWorktree(targetDir: string, issueNumber: number): void {
  const branch = branchFor(issueNumber);
  const path = worktreePath(targetDir, issueNumber);
  if (existsSync(path)) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", path], { cwd: targetDir, stdio: "ignore" });
    } catch {
      // Fall through; we'll best-effort remove the directory below.
    }
  }
  try {
    execFileSync("git", ["branch", "-D", branch], { cwd: targetDir, stdio: "ignore" });
  } catch {
    /* branch may not exist */
  }
}

function listLocalBranches(targetDir: string): string[] {
  const out = execFileSync("git", ["for-each-ref", "--format=%(refname:short)", "refs/heads/"], {
    cwd: targetDir,
    encoding: "utf8",
  });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

function copyNodeModules(targetDir: string, worktree: string): void {
  const src = join(targetDir, "node_modules");
  if (!existsSync(src)) return;
  const dst = join(worktree, "node_modules");
  // cp -al uses hard-links on macOS/Linux: near-instant and saves disk.
  // Fall back to plain -a if hard-link copy fails (different filesystem etc.).
  try {
    execFileSync("cp", ["-al", src, dst], { stdio: "ignore" });
  } catch {
    execFileSync("cp", ["-a", src, dst], { stdio: "ignore" });
  }
}

function copyEnv(targetDir: string, worktree: string): void {
  const src = join(targetDir, ".env");
  if (!existsSync(src)) return;
  copyFileSync(src, join(worktree, ".env"));
}

function writeDenyList(worktree: string): void {
  const dir = join(worktree, ".claude");
  mkdirSync(dir, { recursive: true });
  const settings = { permissions: { deny: DENY_PATTERNS } };
  writeFileSync(join(dir, "settings.local.json"), JSON.stringify(settings, null, 2));
}

function stripPush(worktree: string): void {
  try {
    execFileSync("git", ["remote", "set-url", "--push", "origin", "no-push://disabled"], {
      cwd: worktree,
      stdio: "ignore",
    });
  } catch {
    // No origin configured — nothing to strip.
  }
}

export function ensureGitignore(targetDir: string): void {
  const path = join(targetDir, ".gitignore");
  const line = ".afk-loop/";
  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`);
    return;
  }
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n").map((l) => l.trim());
  if (lines.includes(line) || lines.includes(line.slice(0, -1))) return;
  appendFileSync(path, content.endsWith("\n") ? `${line}\n` : `\n${line}\n`);
}
