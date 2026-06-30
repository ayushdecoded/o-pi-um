import type { PromptInput, UnitSummary, WorkTask, WorkUnit } from "../runner-core/index.ts";

export function goalSetupPrompt({ run }: PromptInput): string {
  return [
    "Build shared understanding before implementation.",
    "Use code exploration to answer questions when possible. Ask one focused question at a time when requirements are unclear.",
    "After the user approves, record the approved contract and dependency-ordered task plan.",
    "Use units for major work boundaries. Task dependencies are only needed for earlier tasks in the same unit.",
    "Do not start implementation during setup.",
    "",
    `<intent>\n${escapeXml(run.intent)}\n</intent>`,
  ].join("\n");
}

export function goalWorkPrompt({
  task,
  summaries,
}: {
  unit: WorkUnit;
  task: WorkTask;
  summaries?: UnitSummary[];
}): string {
  return [
    task.name,
    "",
    "Objective:",
    task.objective,
    "",
    "Done when:",
    task.verification,
    formatSummaries(summaries),
  ]
    .filter(Boolean)
    .join("\n");
}

export function goalRollupPrompt({ unit }: { unit: WorkUnit }): string {
  return [
    `Summarize completed work for ${unit.name}.`,
    "Keep only durable facts: changed/read files, completed work, evidence, validation, decisions, blockers, and context needed for later tasks.",
    "Do not continue the work. Keep the summary focused on durable work context.",
  ].join("\n");
}

function formatSummaries(summaries: UnitSummary[] | undefined): string {
  const useful = (summaries ?? []).filter((item) => item.summary?.trim()).slice(-3);
  if (useful.length === 0) return "";
  return ["", "Context:", ...useful.map((item) => `- ${item.summary!.trim()}`)].join("\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
