import type { Message } from "@earendil-works/pi-ai";
import { subagentTokenSplitFromUsage, usageCostFromUsage } from "../shared/usage.ts";
import type { RunUsage } from "./types.ts";

export function usageFromMessages(messages: Message[]): RunUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  for (const message of messages) {
    const usage = (message as { usage?: Record<string, unknown> }).usage;
    if (!usage) continue;
    const split = subagentTokenSplitFromUsage(usage);
    inputTokens += split.inputTokens;
    outputTokens += split.outputTokens;
    costUsd += usageCostFromUsage(usage);
  }
  return { inputTokens, outputTokens, tokens: inputTokens + outputTokens, costUsd };
}
