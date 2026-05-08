import { describe, it, expect } from "vitest";
import { computeAcStates, parseAcceptanceCriteria } from "../src/ac-progress.ts";
import type { AcProgress, CommitInfo } from "../src/ac-progress.ts";

describe("parseAcceptanceCriteria", () => {
  it("parses ACs from a `## Acceptance criteria` checklist", () => {
    const body = `## What to build

Stuff.

## Acceptance criteria

- [ ] \`[API]\` Returns 401 when token missing
- [ ] \`[UI]\` Shows error toast
- [ ] Plain criterion with no layer

## Blocked by

- None
`;
    const acs = parseAcceptanceCriteria(body);
    expect(acs).toHaveLength(3);
    expect(acs[0]).toMatchObject({ n: 1, title: "Returns 401 when token missing", layer: "API", state: "pending" });
    expect(acs[1]).toMatchObject({ n: 2, title: "Shows error toast", layer: "UI", state: "pending" });
    expect(acs[2]).toMatchObject({ n: 3, title: "Plain criterion with no layer", state: "pending" });
    expect(acs[2].layer).toBeUndefined();
  });
});

describe("computeAcStates", () => {
  const pendingAcs = (n: number): AcProgress[] =>
    Array.from({ length: n }, (_, i) => ({ n: i + 1, title: `AC ${i + 1}`, state: "pending" as const }));

  it("maps test: commit with [AC N] tag to red state with redAt timestamp", () => {
    const commits: CommitInfo[] = [
      { subject: "test: add cycle detection [AC 1] (#42)", authoredAt: "2026-05-08T14:30:00Z" },
    ];
    const out = computeAcStates(pendingAcs(2), commits);
    expect(out[0]).toMatchObject({ state: "red", redAt: "2026-05-08T14:30:00Z" });
    expect(out[1]!.state).toBe("pending");
  });

  it("promotes AC to green when feat: commit with same [AC N] follows test:", () => {
    const commits: CommitInfo[] = [
      { subject: "test: add cycle detection [AC 1] (#42)", authoredAt: "2026-05-08T14:30:00Z" },
      { subject: "feat: detect cycles [AC 1] (#42)", authoredAt: "2026-05-08T14:30:30Z" },
    ];
    const out = computeAcStates(pendingAcs(2), commits);
    expect(out[0]).toMatchObject({
      state: "green",
      redAt: "2026-05-08T14:30:00Z",
      greenAt: "2026-05-08T14:30:30Z",
    });
  });

  it("falls back to positional pairing when [AC N] tags are absent", () => {
    const commits: CommitInfo[] = [
      { subject: "test: scenario A (#42)", authoredAt: "2026-05-08T14:30:00Z" },
      { subject: "feat: implement A (#42)", authoredAt: "2026-05-08T14:30:30Z" },
      { subject: "test: scenario B (#42)", authoredAt: "2026-05-08T14:31:00Z" },
    ];
    const out = computeAcStates(pendingAcs(3), commits);
    expect(out[0]!.state).toBe("green");
    expect(out[1]!.state).toBe("red");
    expect(out[2]!.state).toBe("pending");
  });
});
