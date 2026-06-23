import { MAX_SLICE_TASKS } from "../domain/constants.ts";
import { activeObjective, currentTasks } from "../domain/state.ts";
import type { GoalState, GoalTask } from "../domain/types.ts";

export function setupPrompt(goal: GoalState): string {
  return [
    "Goal setup.",
    "Clarify only if success criteria, validation evidence, boundaries, or ask-before constraints are unclear.",
    "Do not begin implementation work yet.",
    "When the contract is clear and the user approves it, call goal with contract set to the full approved contract and no action.",
    `Each execution slice may track at most ${MAX_SLICE_TASKS} tasks.`,
    "",
    "User intent:",
    `<untrusted_intent>\n${escapeXml(goal.intent)}\n</untrusted_intent>`,
  ].join("\n");
}

export function sliceWorkOrderPrompt(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Goal slice ${sliceLabel(goal)}.`,
    "Do one coherent slice toward the approved contract; prefer one subsystem or milestone over the whole goal.",
    `Track at most ${MAX_SLICE_TASKS} focused tasks for this slice. Each task should have name, objective, and verification.`,
    "After implementing, review thoroughly, fix bugs, and run focused validation before marking tasks complete.",
    'Use goal(action="tasks") to name/refine the slice, update current task progress, and optionally queue future slices in bulk. Add evidence when marking tasks complete.',
    'Call goal(action="complete") only if the full contract is verified. If user input is needed, call goal(action="pause").',
    "",
    "Approved contract:",
    `<contract>\n${escapeXml(goal.contract ?? goal.intent)}\n</contract>`,
    "",
    "Current slice:",
    `<slice>\nname: ${escapeXml(slice?.name ?? sliceLabel(goal))}\nobjective: ${escapeXml(slice?.objective ?? activeObjective(goal))}\n</slice>`,
    formatPlannedSlices(goal),
    formatTasks(currentTasks(goal)),
  ]
    .filter(Boolean)
    .join("\n");
}

export function sliceSummaryInstructions(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Summarize goal slice ${sliceLabel(goal)}.`,
    "Preserve:",
    "- slice objective and completed tasks",
    "- evidence/validation for each completed task",
    "- files read/changed and why",
    "- blockers or user decisions needed",
    "- recommended next slice name/objective",
    "Keep it compact but sufficient to continue from this branch summary.",
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
    "Queued future slices:",
    ...goal.plannedSlices.map(
      (slice) => `- ${escapeXml(slice.name)}: ${escapeXml(slice.objective)}`,
    ),
  ].join("\n");
}

function formatTasks(tasks: GoalTask[]): string {
  if (tasks.length === 0) return "";
  return [
    "",
    "Current slice tasks:",
    ...tasks.map((task) => {
      const lines = [
        `- ${task.completed ? "[x]" : "[ ]"} ${escapeXml(task.name)}`,
        `  objective: ${escapeXml(task.objective)}`,
        `  verification: ${escapeXml(task.verification)}`,
      ];
      if (task.evidence) lines.push(`  evidence: ${escapeXml(task.evidence)}`);
      return lines.join("\n");
    }),
  ].join("\n");
}

export function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
