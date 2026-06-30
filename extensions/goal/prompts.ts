import type {
  RollupPromptInput,
  SetupPromptInput,
  UnitSummary,
  WorkPromptInput,
} from "../runner-core/index.ts";

export function goalSetupPrompt({ run }: SetupPromptInput): string {
  return `Goal setup. Build shared understanding before approval; no implementation.
Use existing session context and codebase evidence first; do not re-ask already-resolved points.
Interview relentlessly on unresolved plan branches/dependencies; ask exactly one question at a time and include your recommended answer.
If codebase exploration can answer a question, explore instead of asking.
Keep the Q&A going until both you and the user share understanding of scope, dependencies, risks, and verification.
After approval call goal with { action:"approve", contract, plan } once; do no implementation. Then reply with one short handoff line only. Units are ordered; each has short name and concrete tasks.
Task dependencies are only needed for earlier tasks in the same unit.

<untrusted_intent>
${escapeXml(run.intent)}
</untrusted_intent>`;
}

export function goalWorkPrompt({ task, summaries }: WorkPromptInput): string {
  return `${task.name}

Objective:
${task.objective}

Done when:
${task.verification}${formatSummaries(summaries)}`;
}

export function goalRollupPrompt({ unit }: RollupPromptInput): string {
  return `Summarize completed work for ${unit.name}.
Keep only durable facts: changed/read files, completed work, evidence, validation, decisions, blockers, and context needed for later tasks.
Summarize only. Do not perform additional work.`;
}

function formatSummaries(summaries: UnitSummary[] | undefined): string {
  const useful = (summaries ?? []).filter((item) => item.summary?.trim()).slice(-3);
  if (useful.length === 0) return "";
  return `\nContext:\n${useful.map((item) => `- ${item.summary!.trim()}`).join("\n")}`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
