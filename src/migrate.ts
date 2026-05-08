import { execFileSync, spawnSync } from "node:child_process";

export interface MigrateOpts {
  from: string;
  to: string;
  cwd?: string;
  dryRun?: boolean;
  ghJsonList?: () => string;
  ghRun?: (args: string[]) => void;
}

export interface MigrateResult {
  migrated: number;
  wouldMigrate: number;
}

const defaultGhJsonList = (cwd: string | undefined, label: string): string => {
  const safe = label.replace(/"/g, '\\"');
  return execFileSync("gh", ["issue", "list", "--label", safe, "--state", "open", "--limit", "500", "--json", "number"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
};

const defaultGhRun = (args: string[]): void => {
  const r = spawnSync("gh", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed (exit ${r.status})`);
};

export function migrateLabels(opts: MigrateOpts): MigrateResult {
  const list = opts.ghJsonList ?? (() => defaultGhJsonList(opts.cwd, opts.from));
  const run = opts.ghRun ?? defaultGhRun;
  const issues = JSON.parse(list()) as Array<{ number: number }>;

  if (opts.dryRun) {
    return { migrated: 0, wouldMigrate: issues.length };
  }

  let migrated = 0;
  for (const issue of issues) {
    try {
      run(["issue", "edit", String(issue.number), "--remove-label", opts.from, "--add-label", opts.to]);
      migrated += 1;
    } catch (err) {
      console.error(`gh edit failed for #${issue.number}: ${(err as Error).message}`);
    }
  }
  return { migrated, wouldMigrate: 0 };
}
