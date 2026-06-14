import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { GoalState } from "../domain/types.ts";

// Fallback live estimate for in-progress turns before provider usage arrives.
// Final accounting uses actual assistant usage fields when available.
export function estimateMessageTokens(message: AgentMessage): number {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return Math.ceil(content.length / 4);
  if (!Array.isArray(content)) return 0;
  let totalChars = 0;
  for (const part of content) {
    if (typeof part === "string") {
      totalChars += part.length;
    } else if (isRecord(part)) {
      // Text content
      if (typeof part.text === "string") totalChars += part.text.length;
      // Thinking / reasoning blocks
      if (typeof part.thinking === "string") totalChars += part.thinking.length;
      if (typeof part.reasoning === "string")
        totalChars += part.reasoning.length;
      // Tool calls
      if (part.type === "toolCall" && typeof part.name === "string") {
        totalChars += part.name.length;
        if (typeof part.arguments === "string")
          totalChars += part.arguments.length;
        else if (isRecord(part.arguments))
          totalChars += JSON.stringify(part.arguments).length;
      }
    }
  }
  return Math.max(1, Math.ceil(totalChars / 4));
}

export function assistantTokenUsage(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    const role = (message as { role?: string }).role;
    if (role !== "assistant" && role !== "model") continue;
    const usage = (message as { usage?: Record<string, unknown> }).usage;
    if (!usage) continue;
    total += tokenUsageFromUsage(usage);
  }
  return total;
}

// Normalize usage shapes across providers. Cache reads are subtracted so goal budget tracks
// effective new context/output rather than repeatedly charging cached prompt tokens.
export function tokenUsageFromUsage(usage: Record<string, unknown>): number {
  const input = firstNumberField(usage, [
    "input",
    "input_tokens",
    "prompt_tokens",
    "promptTokens",
  ]);
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

export function assistantCostUsage(messages: AgentMessage[]): number {
  let total = 0;
  for (const message of messages) {
    const role = (message as { role?: string }).role;
    if (role !== "assistant" && role !== "model") continue;
    const usage = (message as { usage?: Record<string, unknown> }).usage;
    const cost =
      usage && isRecord(usage.cost)
        ? numberField(usage.cost, "total")
        : usage
          ? numberField(usage, "cost")
          : 0;
    total += Math.max(0, cost);
  }
  return total;
}

// Deterministic budget gate. Only budgets explicitly set by the user participate.
export function goalBudgetExceeded(goal: GoalState): boolean {
  return (
    (goal.tokenBudget !== null && goal.tokensUsed >= goal.tokenBudget) ||
    (goal.timeBudgetSeconds != null &&
      goal.timeUsedSeconds >= goal.timeBudgetSeconds) ||
    (goal.turnBudget != null && (goal.turnsUsed ?? 0) >= goal.turnBudget) ||
    (goal.costBudgetUsd != null &&
      (goal.costUsedUsd ?? 0) >= goal.costBudgetUsd)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function numberField(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function firstNumberField(
  obj: Record<string, unknown>,
  keys: string[],
): number {
  for (const key of keys) {
    const value = numberField(obj, key);
    if (value > 0) return value;
  }
  return 0;
}

function nestedNumberField(
  obj: Record<string, unknown>,
  path: string[],
): number {
  let current: unknown = obj;
  for (const key of path) {
    if (!isRecord(current)) return 0;
    current = current[key];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

export function looksAborted(messages: AgentMessage[]): boolean {
  return messages.some((m) => {
    const stop = (m as { stopReason?: string }).stopReason;
    const error = (m as { errorMessage?: string }).errorMessage;
    return (
      stop === "aborted" ||
      /aborted|interrupted|cancelled|canceled/i.test(error ?? "")
    );
  });
}

// Auto-pause when the assistant clearly asks for user input/approval.
// This is a guardrail, not task classification.
export function assistantQuestionText(messages: AgentMessage[]): string | null {
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => (m as { role?: string }).role === "assistant");
  if (!lastAssistant) return null;
  const text = messageText(lastAssistant).trim();
  if (!text) return null;
  const asks =
    /[?？]|\b(please confirm|needs approval|approval needed|reply with|choose one|which option|what should|could you tell me|can you tell me|please tell me|confirm before|approve before|waiting for your|need your input|blocked on)\b/i.test(
      text,
    );
  if (!asks) return null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const question =
    [...lines].reverse().find((line) => /[?？]/.test(line)) ??
    lines.at(-1) ??
    text;
  return truncate(question, 220);
}

export function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
