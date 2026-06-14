export type TokenSplit = { inputTokens: number; outputTokens: number };
export type ToolUsage = { tokens: number; costUsd: number };

export function goalTokenUsageFromUsage(usage: Record<string, unknown>): number {
  const input = firstNumberField(usage, ["input", "input_tokens", "prompt_tokens", "promptTokens"]);
  const output = firstNumberField(usage, [
    "output",
    "output_tokens",
    "completion_tokens",
    "completionTokens",
  ]);
  const cacheRead =
    firstNumberField(usage, [
      "cacheRead",
      "cache_read",
      "cached_input_tokens",
      "cachedInputTokens",
    ]) ||
    nestedNumberField(usage, ["prompt_tokens_details", "cached_tokens"]) ||
    nestedNumberField(usage, ["input_token_details", "cache_read"]) ||
    nestedNumberField(usage, ["input_tokens_details", "cached_tokens"]);
  if (input > 0 || output > 0 || cacheRead > 0)
    return Math.max(0, input - cacheRead) + Math.max(0, output);
  return firstNumberField(usage, ["total", "total_tokens", "totalTokens"]);
}

export function subagentTokenSplitFromUsage(usage: Record<string, unknown>): TokenSplit {
  const input = firstNumberField(usage, ["input", "input_tokens", "prompt_tokens", "promptTokens"]);
  const output = firstNumberField(usage, [
    "output",
    "output_tokens",
    "completion_tokens",
    "completionTokens",
  ]);
  if (input > 0 || output > 0)
    return { inputTokens: Math.max(0, input), outputTokens: Math.max(0, output) };
  return {
    inputTokens: firstNumberField(usage, ["total", "total_tokens", "totalTokens"]),
    outputTokens: 0,
  };
}

export function usageCostFromUsage(usage: Record<string, unknown>): number {
  const cost = isRecord(usage.cost) ? numberField(usage.cost, "total") : numberField(usage, "cost");
  return Math.max(0, cost);
}

export function subagentToolResultUsage(result: unknown): ToolUsage {
  const details = isRecord(result) ? result.details : undefined;
  const runs = isRecord(details) && Array.isArray(details.runs) ? details.runs : [];
  let tokens = 0;
  let costUsd = 0;
  for (const run of runs) {
    if (!isRecord(run) || !isRecord(run.usage)) continue;
    tokens += numberField(run.usage, "tokens");
    costUsd += numberField(run.usage, "costUsd");
  }
  return { tokens, costUsd };
}

export function firstNumberField(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = numberField(record, key);
    if (value > 0) return value;
  }
  return 0;
}

export function nestedNumberField(record: Record<string, unknown>, path: string[]): number {
  let value: unknown = record;
  for (const key of path) {
    if (!isRecord(value)) return 0;
    value = value[key];
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
