import { MAX_OBJECTIVE_CHARS } from "./constants.ts";

export type ParsedGoalIntent = {
  intent: string;
  error: string | null;
};

export function parseGoalIntent(raw: string): ParsedGoalIntent {
  const intent = raw
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  return { intent, error: validateObjective(intent) };
}

export function validateObjective(objective: string): string | null {
  if (!objective) return "Goal intent must not be empty.";
  if ([...objective].length > MAX_OBJECTIVE_CHARS)
    return `Goal objective is too long. Limit: ${MAX_OBJECTIVE_CHARS} characters.`;
  return null;
}
