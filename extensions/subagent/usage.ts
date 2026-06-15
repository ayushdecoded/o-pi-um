import type { Message } from "@earendil-works/pi-ai";
import { addUsageTotals, usageTotalsFromUsage, type UsageTotals } from "../shared/usage.ts";
import type { RunUsage } from "./types.ts";

export function usageFromMessages(messages: Message[]): RunUsage {
  let totals: UsageTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const message of messages) {
    const usage = (message as { usage?: Record<string, unknown> }).usage;
    if (usage) totals = addUsageTotals(totals, usageTotalsFromUsage(usage));
  }
  return { ...totals, tokens: totals.inputTokens + totals.outputTokens };
}
