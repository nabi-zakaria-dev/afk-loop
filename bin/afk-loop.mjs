#!/usr/bin/env node
// Entry shim for the globally installed `afk-loop` bin.
//
// `npm install -g github:nabi-zakaria-dev/afk-loop` symlinks this file into
// the user's npm-global bin directory. We resolve the package's installed
// `tsx` from its node_modules (not the user's), spawn it with `main.mts`,
// and forward stdio + exit code. The user's cwd is preserved so the
// orchestrator runs against the target repo, not against the package.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const main = resolve(packageRoot, "main.mts");
const tsxBin = resolve(packageRoot, "node_modules", ".bin", "tsx");

if (!existsSync(tsxBin)) {
  console.error(
    `afk-loop: tsx binary not found at ${tsxBin}.\n` +
      `This usually means dependencies were not installed. Try:\n` +
      `  npm install -g github:nabi-zakaria-dev/afk-loop\n` +
      `or, if you cloned this repo manually:\n` +
      `  cd ${packageRoot} && npm install`,
  );
  process.exit(1);
}

if (!existsSync(main)) {
  console.error(`afk-loop: main entrypoint not found at ${main}`);
  process.exit(1);
}

const child = spawn(tsxBin, [main, ...process.argv.slice(2)], {
  stdio: "inherit",
  cwd: process.cwd(),
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
