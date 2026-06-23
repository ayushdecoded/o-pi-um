import { MAX_SLICE_TASKS } from "../domain/constants.ts";
import { activeObjective, currentTasks } from "../domain/state.ts";
import type { GoalState, GoalTask } from "../domain/types.ts";

export function setupPrompt(goal: GoalState): string {
  return [
    "Goal setup. Build shared understanding before approval; no implementation.",
    "Use existing session context and codebase evidence first; do not re-ask already-resolved points.",
    "Interview relentlessly on unresolved plan branches/dependencies; ask exactly one question at a time and include your recommended answer.",
    "If codebase exploration can answer a question, explore instead of asking.",
    `After approval call goal({contract,slices}) once; do no implementation. Then reply with one short handoff line only. Slices are ordered; each has short name,tasks≤${MAX_SLICE_TASKS}.`,
    "",
    `<untrusted_intent>\n${escapeXml(goal.intent)}\n</untrusted_intent>`,
  ].join("\n");
}

export function sliceWorkOrderPrompt(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Goal slice: ${sliceLabel(goal)}.`,
    `One coherent milestone only. State via goal({action:"tasks"}): slice?, tasks≤${MAX_SLICE_TASKS}.`,
    "Task fields: name, objective, verification; add concise evidence when completed.",
    "Review/fix/validate before final task. Pause if blocked. Complete only after full-contract verification.",
    "",
    `<contract>\n${escapeXml(goal.contract ?? goal.intent)}\n</contract>`,
    `<slice name="${escapeXml(slice?.name ?? sliceLabel(goal))}">\n${escapeXml(slice?.objective ?? activeObjective(goal))}\n</slice>`,
    formatPlannedSlices(goal),
    formatTasks(currentTasks(goal)),
  ]
    .filter(Boolean)
    .join("\n");
}

export function sliceSummaryInstructions(_goal: GoalState): string {
  return [
    "Compact this work segment for continuation.",
    "Keep: durable requirements, completed work/evidence, validation, important files/APIs/commands, decisions, next work, blockers.",
    "Omit dialogue, tool chatter, transient plans, repeated instructions, and Goal/slice/branch/controller wording. No preamble.",
  ].join("\n");
}

export function sliceLabel(goal: GoalState): string {
  const slice = goal.currentSlice;
  if (!slice) return `s${goal.sliceCounter + 1}`;
  return `s${slice.id} ${slice.name}`.trim();
}

function formatPlannedSlices(goal: GoalState): string {
  if (goal.plannedSlices.length === 0) return "";
  return [
    "",
    "Queued slices:",
    ...goal.plannedSlices.map(
      (slice) =>
        `- ${escapeXml(slice.name)}${slice.objective ? `: ${escapeXml(slice.objective)}` : ""}`,
    ),
  ].join("\n");
}

function formatTasks(tasks: GoalTask[]): string {
  if (tasks.length === 0) return "";
  return [
    "",
    "Tasks:",
    ...tasks.map((task) => {
      const lines = [
        `- ${task.completed ? "[x]" : "[ ]"} ${escapeXml(task.name)}`,
        `  obj: ${escapeXml(task.objective)}`,
        `  verify: ${escapeXml(task.verification)}`,
      ];
      if (task.evidence) lines.push(`  evidence: ${escapeXml(task.evidence)}`);
      return lines.join("\n");
    }),
  ].join("\n");
}

export function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
