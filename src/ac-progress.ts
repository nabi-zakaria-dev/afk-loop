export type AcState = "pending" | "red" | "green" | "refactored";

export interface AcProgress {
  n: number;
  title: string;
  layer?: string;
  state: AcState;
  redAt?: string;
  greenAt?: string;
}

export function parseAcceptanceCriteria(_body: string): AcProgress[] {
  throw new Error("not implemented");
}
