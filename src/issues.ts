import { execSync } from "node:child_process";

export interface Issue {
  number: number;
  title: string;
  body: string;
  blockedBy: number[];
  isHITL: boolean;
}

interface GhIssue {
  number: number;
  title: string;
  body: string;
  labels: Array<{ name: string }>;
}

export function parseIssue(gh: GhIssue, opts: { hitlPattern: string }): Issue {
  const blockedBy = parseBlockedBy(gh.body);
  const hitlRegex = new RegExp(opts.hitlPattern);
  return {
    number: gh.number,
    title: gh.title,
    body: gh.body ?? "",
    blockedBy,
    isHITL: hitlRegex.test(gh.title),
  };
}

function parseBlockedBy(body: string): number[] {
  if (!body) return [];
  const lines = body.split("\n");
  let inSection = false;
  const blockers = new Set<number>();
  for (const line of lines) {
    const headerMatch = /^\s*#{0,6}\s*blocked\s*by\s*[:]?\s*$/i.test(line);
    const inlineMatch = line.match(/^\s*blocked\s*by\s*:\s*(.*)$/i);
    if (headerMatch) {
      inSection = true;
      continue;
    }
    if (inlineMatch) {
      const after = inlineMatch[1] ?? "";
      collectIssueRefs(after, blockers);
      inSection = true;
      continue;
    }
    if (inSection) {
      if (/^\s*#{1,6}\s/.test(line) && !/blocked\s*by/i.test(line)) {
        inSection = false;
        continue;
      }
      if (/none\b|can start immediately/i.test(line)) continue;
      collectIssueRefs(line, blockers);
    }
  }
  return [...blockers].sort((a, b) => a - b);
}

function collectIssueRefs(text: string, into: Set<number>): void {
  for (const match of text.matchAll(/#(\d+)/g)) {
    const numStr = match[1];
    if (!numStr) continue;
    const n = Number.parseInt(numStr, 10);
    if (Number.isFinite(n)) into.add(n);
  }
}

export function filterIssues(issues: Issue[]): Issue[] {
  return issues.filter((i) => !i.isHITL);
}

export interface FetchOpts {
  label: string;
  hitlPattern: string;
  cwd?: string;
}

export function fetchAfkIssues(opts: FetchOpts): Issue[] {
  const labelArg = opts.label.replace(/"/g, '\\"');
  const json = execSync(`gh issue list --label "${labelArg}" --state open --limit 200 --json number,title,body,labels`, {
    cwd: opts.cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const arr = JSON.parse(json) as GhIssue[];
  const parsed = arr.map((gh) => parseIssue(gh, { hitlPattern: opts.hitlPattern }));
  return filterIssues(parsed);
}
