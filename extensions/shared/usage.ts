export type TokenSplit = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
export type ToolUsage = { tokens: number; costUsd: number };
export type UsageTotals = TokenSplit & { costUsd: number };

export function zeroUsageTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
}

export function goalTokenUsageFromUsage(usage: Record<string, unknown>): number {
  const totals = usageTotalsFromUsage(usage);
  return totals.inputTokens + totals.outputTokens;
}

export function subagentTokenSplitFromUsage(usage: Record<string, unknown>): TokenSplit {
  const input = firstNumberField(usage, ["input", "input_tokens", "prompt_tokens", "promptTokens"]);
  const output = firstNumberField(usage, [
    "output",
    "output_tokens",
    "completion_tokens",
    "completionTokens",
  ]);
  const cacheRead = cacheReadTokensFromUsage(usage);
  const cacheWrite = cacheWriteTokensFromUsage(usage);
  if (input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0)
    return {
      inputTokens: Math.max(0, input),
      outputTokens: Math.max(0, output),
      cacheReadTokens: Math.max(0, cacheRead),
      cacheWriteTokens: Math.max(0, cacheWrite),
    };
  return {
    inputTokens: firstNumberField(usage, ["total", "total_tokens", "totalTokens"]),
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

export function usageCostFromUsage(usage: Record<string, unknown>): number {
  const cost = isRecord(usage.cost) ? numberField(usage.cost, "total") : numberField(usage, "cost");
  return Math.max(0, cost);
}

export function usageTotalsFromUsage(usage: Record<string, unknown>): UsageTotals {
  const split = subagentTokenSplitFromUsage(usage);
  return { ...split, costUsd: usageCostFromUsage(usage) };
}

export function cacheHitRateFromUsage(usage: Record<string, unknown>): number | undefined {
  return cacheHitRateFromTotals(usageTotalsFromUsage(usage));
}

export function cacheHitRateFromTotals(totals: UsageTotals): number | undefined {
  const promptTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return promptTokens > 0 ? (totals.cacheReadTokens / promptTokens) * 100 : undefined;
}

export function addUsageTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

export function sessionUsageTotals(entries: unknown[]): UsageTotals {
  let totals = zeroUsageTotals();
  for (const entry of entries) totals = addEntryUsageTotals(totals, entry);
  return totals;
}

export function addEntryUsageTotals(totals: UsageTotals, entry: unknown): UsageTotals {
  if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) return totals;
  if (entry.message.role === "assistant" && isRecord(entry.message.usage))
    return addUsageTotals(totals, usageTotalsFromUsage(entry.message.usage));
  if (entry.message.role === "toolResult" && entry.message.toolName === "subagent")
    return addUsageTotals(totals, subagentToolResultTotals(entry.message));
  return totals;
}

export function subagentToolResultTotals(result: unknown): UsageTotals {
  const details = isRecord(result) ? result.details : undefined;
  const runs = isRecord(details) && Array.isArray(details.runs) ? details.runs : [];
  let totals = zeroUsageTotals();
  for (const run of runs) {
    if (!isRecord(run) || !isRecord(run.usage)) continue;
    totals = addUsageTotals(totals, {
      inputTokens: numberField(run.usage, "inputTokens"),
      outputTokens: numberField(run.usage, "outputTokens"),
      cacheReadTokens: numberField(run.usage, "cacheReadTokens"),
      cacheWriteTokens: numberField(run.usage, "cacheWriteTokens"),
      costUsd: numberField(run.usage, "costUsd"),
    });
  }
  return totals;
}

export function subagentToolResultUsage(result: unknown): ToolUsage {
  const totals = subagentToolResultTotals(result);
  return { tokens: totals.inputTokens + totals.outputTokens, costUsd: totals.costUsd };
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

function cacheReadTokensFromUsage(usage: Record<string, unknown>): number {
  return (
    firstNumberField(usage, [
      "cacheRead",
      "cache_read",
      "cached_input_tokens",
      "cachedInputTokens",
    ]) ||
    nestedNumberField(usage, ["prompt_tokens_details", "cached_tokens"]) ||
    nestedNumberField(usage, ["input_token_details", "cache_read"]) ||
    nestedNumberField(usage, ["input_tokens_details", "cached_tokens"])
  );
}

function cacheWriteTokensFromUsage(usage: Record<string, unknown>): number {
  return firstNumberField(usage, [
    "cacheWrite",
    "cache_write",
    "cachedInputWriteTokens",
    "cached_input_write_tokens",
  ]);
}
