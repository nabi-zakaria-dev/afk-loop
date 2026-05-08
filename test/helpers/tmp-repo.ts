import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

export interface TmpRepo {
  dir: string;
  cleanup: () => void;
}

export function mkTmpRepo(opts: { withNodeModules?: boolean; withEnv?: boolean; withConfig?: object | string } = {}): TmpRepo {
  const dir = mkdtempSync(join(tmpdir(), "afk-loop-repo-"));
  execSync("git init -q -b main", { cwd: dir });
  execSync("git config user.email test@example.com && git config user.name Test", { cwd: dir, shell: "/bin/sh" });
  writeFileSync(join(dir, "README.md"), "# tmp repo\n");
  execSync("git add README.md && git commit -q -m initial", { cwd: dir, shell: "/bin/sh" });

  if (opts.withNodeModules) {
    const nm = join(dir, "node_modules");
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, ".package-lock.json"), "{}");
    mkdirSync(join(nm, "fake-pkg"), { recursive: true });
    writeFileSync(join(nm, "fake-pkg", "index.js"), "module.exports = 1;\n");
  }

  if (opts.withEnv) {
    writeFileSync(join(dir, ".env"), "FOO=bar\n");
  }

  if (opts.withConfig !== undefined) {
    const afkDir = join(dir, ".afk-loop");
    mkdirSync(afkDir, { recursive: true });
    const content = typeof opts.withConfig === "string" ? opts.withConfig : JSON.stringify(opts.withConfig);
    writeFileSync(join(afkDir, "config.json"), content);
  }

  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}
