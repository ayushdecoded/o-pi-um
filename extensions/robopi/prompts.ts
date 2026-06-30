import { goalRollupPrompt, goalWorkPrompt } from "../goal/prompts.ts";
import type { PromptInput } from "../runner-core/index.ts";

export { goalRollupPrompt as robopiRollupPrompt, goalWorkPrompt as robopiWorkPrompt };

export function robopiSetupPrompt(input: PromptInput): string {
  return [
    "Clarify ambiguous requirements before implementation; inspect code when faster than asking.",
    "Do not start implementation during setup.",
    "After user approval, record the approved contract and dependency-ordered task plan.",
    "Use concrete verification for every task.",
    "",
    `<intent>\n${escapeXml(input.run.intent)}\n</intent>`,
  ].join("\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
