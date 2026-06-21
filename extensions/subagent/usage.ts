import type { Message } from "@earendil-works/pi-ai";
import { addUsageTotals, usageTotalsFromUsage, zeroUsageTotals } from "../shared/usage.ts";
import type { RunUsage } from "./types.ts";

export function usageFromMessages(messages: Message[]): RunUsage {
  let totals = zeroUsageTotals();
  for (const message of messages) {
    const usage = (message as { usage?: Record<string, unknown> }).usage;
    if (usage) totals = addUsageTotals(totals, usageTotalsFromUsage(usage));
  }
  return { ...totals, tokens: totals.inputTokens + totals.outputTokens };
}
