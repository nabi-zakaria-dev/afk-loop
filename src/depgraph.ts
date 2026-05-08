import type { Issue } from "./issues.ts";

export interface FrontierOpts {
  maxParallel: number;
  failedThisRun: number[];
}

export function detectCycles(issues: Issue[]): number[][] {
  const openSet = new Set(issues.map((i) => i.number));
  const adj = new Map<number, number[]>();
  for (const issue of issues) {
    adj.set(
      issue.number,
      issue.blockedBy.filter((b) => openSet.has(b)),
    );
  }

  const cycles: number[][] = [];
  const stackSet = new Set<number>();
  const stack: number[] = [];
  const finished = new Set<number>();

  const dfs = (node: number): void => {
    if (finished.has(node)) return;
    if (stackSet.has(node)) {
      const idx = stack.indexOf(node);
      if (idx >= 0) cycles.push(stack.slice(idx));
      return;
    }
    stackSet.add(node);
    stack.push(node);
    for (const nbr of adj.get(node) ?? []) dfs(nbr);
    stack.pop();
    stackSet.delete(node);
    finished.add(node);
  };

  for (const issue of issues) dfs(issue.number);

  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: number[][]): number[][] {
  const seen = new Set<string>();
  const out: number[][] = [];
  for (const c of cycles) {
    const key = [...c].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export function computeFrontier(issues: Issue[], opts: FrontierOpts): Issue[] {
  const openSet = new Set(issues.map((i) => i.number));
  const failed = new Set(opts.failedThisRun);
  const ready = issues.filter((issue) => {
    if (failed.has(issue.number)) return false;
    return issue.blockedBy.every((b) => !openSet.has(b));
  });
  ready.sort((a, b) => a.number - b.number);
  return ready.slice(0, opts.maxParallel);
}

export function branchName(issue: Issue): string {
  return `afk/issue-${issue.number}`;
}
