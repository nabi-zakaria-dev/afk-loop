export type AcState = "pending" | "red" | "green" | "refactored";

export interface AcProgress {
  n: number;
  title: string;
  layer?: string;
  state: AcState;
  redAt?: string;
  greenAt?: string;
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
