import { mkdirSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGitignore } from "./worktree.ts";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

export interface InitOpts {
  force?: boolean;
}

export function initTarget(targetDir: string, opts: InitOpts = {}): void {
  const afkDir = join(targetDir, ".afk-loop");
  mkdirSync(afkDir, { recursive: true });

  const cfgDest = join(afkDir, "config.json");
  if (existsSync(cfgDest) && !opts.force) {
    throw new Error(`${cfgDest} already exists. Pass --force to overwrite.`);
  }
  copyFileSync(join(TEMPLATES_DIR, "config.json"), cfgDest);

  const standardsDest = join(afkDir, "CODING_STANDARDS.md");
  if (!existsSync(standardsDest)) {
    copyFileSync(join(TEMPLATES_DIR, "CODING_STANDARDS.md"), standardsDest);
  }

  ensureGitignore(targetDir);

  const summaryStub = join(afkDir, "summary.md");
  if (!existsSync(summaryStub)) {
    writeFileSync(summaryStub, "");
  }
}
