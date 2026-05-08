import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Config {
  label: string;
  hitlPattern: string;
  mainBranch: string;
  maxParallel: number;
  maxTurnsPerImplementer: number;
  advisoryPlanner: boolean;
  runtimeBudgetHours: number;
}

const DEFAULTS: Config = {
  label: "AFK",
  hitlPattern: "\\[HITL\\]",
  mainBranch: "main",
  maxParallel: 3,
  maxTurnsPerImplementer: 50,
  advisoryPlanner: false,
  runtimeBudgetHours: 8,
};

const TYPE_OF: Record<keyof Config, "string" | "number" | "boolean"> = {
  label: "string",
  hitlPattern: "string",
  mainBranch: "string",
  maxParallel: "number",
  maxTurnsPerImplementer: "number",
  advisoryPlanner: "boolean",
  runtimeBudgetHours: "number",
};

export const configPath = (targetDir: string): string => join(targetDir, ".afk-loop", "config.json");

export function loadConfig(targetDir: string): Config {
  const path = configPath(targetDir);
  if (!existsSync(path)) {
    throw new Error(`config.json not found at ${path}. Run 'afk-loop init' to create one.`);
  }
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config must be a JSON object, got ${typeof parsed}`);
  }
  const cfg = { ...DEFAULTS };
  for (const [key, expected] of Object.entries(TYPE_OF) as Array<[keyof Config, string]>) {
    const value = (parsed as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== expected) {
      throw new Error(`Config field "${key}" must be ${expected}, got ${typeof value}`);
    }
    (cfg as Record<string, unknown>)[key] = value;
  }
  return cfg;
}
