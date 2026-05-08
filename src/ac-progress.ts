export type AcState = "pending" | "red" | "green" | "refactored";

export interface AcProgress {
  n: number;
  title: string;
  layer?: string;
  state: AcState;
  redAt?: string;
  greenAt?: string;
}

export interface CommitInfo {
  subject: string;
  authoredAt: string;
}

const COMMIT_TYPE_RE = /^(test|feat|fix|refactor)\b/;
const AC_TAG_RE = /\[AC\s+(\d+)\]/i;

type Phase = "test" | "impl" | "refactor";

function classifyCommit(subject: string): Phase | null {
  const m = subject.match(COMMIT_TYPE_RE);
  if (!m) return null;
  if (m[1] === "test") return "test";
  if (m[1] === "feat" || m[1] === "fix") return "impl";
  return "refactor";
}

export function computeAcStates(acs: AcProgress[], commits: CommitInfo[]): AcProgress[] {
  const out = acs.map((a) => ({ ...a }));
  let positionalCursor = 0;

  for (const c of commits) {
    const phase = classifyCommit(c.subject);
    if (!phase) continue;
    const tagged = c.subject.match(AC_TAG_RE);
    let idx: number;
    if (tagged) {
      idx = Number.parseInt(tagged[1]!, 10) - 1;
      if (idx < 0 || idx >= out.length) continue;
    } else if (phase === "test") {
      idx = positionalCursor;
      if (idx >= out.length) continue;
    } else {
      idx = positionalCursor;
      if (idx >= out.length) continue;
    }

    const ac = out[idx]!;
    if (phase === "test") {
      ac.state = "red";
      ac.redAt = c.authoredAt;
    } else if (phase === "impl") {
      ac.state = "green";
      ac.greenAt = c.authoredAt;
      if (!tagged) positionalCursor = Math.max(positionalCursor, idx + 1);
    } else if (phase === "refactor" && ac.state === "green") {
      ac.state = "refactored";
    }
  }
  return out;
}

export function parseAcceptanceCriteria(body: string): AcProgress[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+Acceptance\s+criteria\b/i.test(l));
  if (start === -1) return [];
  const out: AcProgress[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s/.test(line)) break;
    const m = line.match(/^\s*-\s*\[[ xX]\]\s+(.*)$/);
    if (!m) continue;
    const text = m[1]!.trim();
    const layered = text.match(/^`?\[([^\]]+)\]`?\s+(.+)$/);
    const ac: AcProgress = layered
      ? { n: out.length + 1, title: layered[2]!.trim(), layer: layered[1]!.trim(), state: "pending" }
      : { n: out.length + 1, title: text, state: "pending" };
    out.push(ac);
  }
  return out;
}
