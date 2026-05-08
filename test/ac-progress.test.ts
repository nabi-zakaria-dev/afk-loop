import { describe, it, expect } from "vitest";
import { parseAcceptanceCriteria } from "../src/ac-progress.ts";

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
