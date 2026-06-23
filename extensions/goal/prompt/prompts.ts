import { MAX_PLANNED_SLICES, MAX_SLICE_TASKS } from "../domain/constants.ts";
import { activeObjective, currentTasks } from "../domain/state.ts";
import type { GoalState, GoalTask } from "../domain/types.ts";

export function setupPrompt(goal: GoalState): string {
  return [
    "Goal setup. Ask only for missing success criteria, validation, boundaries, or ask-before rules.",
    `No implementation. After user approval call goal({contract}) only. Limit: ${MAX_SLICE_TASKS} tasks/slice.`,
    "",
    `<untrusted_intent>\n${escapeXml(goal.intent)}\n</untrusted_intent>`,
  ].join("\n");
}

export function sliceWorkOrderPrompt(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Goal slice: ${sliceLabel(goal)}.`,
    `One coherent milestone only. State via goal({action:"tasks"}): slice?, tasks≤${MAX_SLICE_TASKS}, slices≤${MAX_PLANNED_SLICES}.`,
    "Task fields: name, objective, verification; add evidence when completed.",
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

export function sliceSummaryInstructions(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Summarize Goal slice ${sliceLabel(goal)} for continuation.`,
    "Keep: objective, completed tasks, evidence/validation, files changed/read, blockers, next slice name/objective.",
    "Be compact; omit boilerplate.",
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
      (slice) => `- ${escapeXml(slice.name)}: ${escapeXml(slice.objective)}`,
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
