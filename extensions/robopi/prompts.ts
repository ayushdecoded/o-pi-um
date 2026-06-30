import { goalRollupPrompt, goalWorkPrompt } from "../goal/prompts.ts";
import type { RollupPromptInput, SetupPromptInput, WorkPromptInput } from "../runner-core/index.ts";

export function robopiSetupPrompt({ run }: SetupPromptInput): string {
  return `Clarify ambiguous requirements before implementation; inspect code when faster than asking.
Keep the Q&A going until both you and the user share understanding of scope, constraints, risks, and verification.
Do not start implementation during setup.
After user approval, call robopi with { action:"approve", contract, plan } once to record the approved contract and dependency-ordered task plan.
Use concrete verification for every task.

<intent>
${escapeXml(run.intent)}
</intent>`;
}

export function robopiWorkPrompt(input: WorkPromptInput): string {
  return goalWorkPrompt(input);
}

export function robopiRollupPrompt(input: RollupPromptInput): string {
  return goalRollupPrompt(input);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
