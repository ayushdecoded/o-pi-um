import type { Message } from "@earendil-works/pi-ai";
import type { RunUsage } from "./types.ts";

export function usageFromMessages(messages: Message[]): RunUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const message of messages) {
    const usage = (message as { usage?: Record<string, unknown> }).usage;
    if (!usage) continue;
    const split = tokenSplitFromUsage(usage);
    inputTokens += split.inputTokens;
    outputTokens += split.outputTokens;
    costUsd += costFromUsage(usage);
  }
  return { inputTokens, outputTokens, tokens: inputTokens + outputTokens, costUsd };
}

function tokenSplitFromUsage(usage: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const input = firstNumberField(usage, ["input", "input_tokens", "prompt_tokens", "promptTokens"]);
  const output = firstNumberField(usage, ["output", "output_tokens", "completion_tokens", "completionTokens"]);
  if (input > 0 || output > 0) return { inputTokens: Math.max(0, input), outputTokens: Math.max(0, output) };
  return { inputTokens: firstNumberField(usage, ["total", "total_tokens", "totalTokens"]), outputTokens: 0 };
}

function costFromUsage(usage: Record<string, unknown>): number {
  const cost = isRecord(usage.cost) ? numberField(usage.cost, "total") : numberField(usage, "cost");
  return Math.max(0, cost);
}

function firstNumberField(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = numberField(record, key);
    if (value > 0) return value;
  }
  return 0;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
