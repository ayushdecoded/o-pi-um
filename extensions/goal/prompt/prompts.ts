import type { GoalState } from "../domain/types.ts";
import { activeObjective, sliceSubtasks } from "../domain/state.ts";
import { MAX_SLICE_SUBTASKS } from "../domain/constants.ts";

export function setupPrompt(goal: GoalState): string {
  return [
    "The user wants to start a long-running goal.",
    "Clarify only if the success criteria, validation evidence, boundaries, or ask-before constraints are unclear.",
    "Do not begin implementation work yet.",
    "When the contract is clear, call goal with contract set to the full approved contract and no action.",
    `Each execution slice may track at most ${MAX_SLICE_SUBTASKS} subtasks, so keep slice checklists focused.`,
    "",
    "User intent:",
    `<untrusted_intent>\n${escapeXml(goal.intent)}\n</untrusted_intent>`,
  ].join("\n");
}

export function goalFramePrompt(goal: GoalState): string {
  if (goal.status === "setup") return setupPrompt(goal);
  return [
    "Active long-running goal context.",
    "Stay inside the approved contract. Use goal only for durable checklist, expansion, pause, or completion state.",
    "Do not manage scheduling; the extension schedules and rolls up slices.",
    "",
    "Approved contract:",
    `<contract>\n${escapeXml(goal.contract ?? goal.intent)}\n</contract>`,
    "",
    "Current objective:",
    `<objective>\n${escapeXml(activeObjective(goal))}\n</objective>`,
    formatSubtasks(goal),
  ]
    .filter(Boolean)
    .join("\n");
}

export function sliceWorkOrderPrompt(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Goal slice ${slice?.id ?? goal.sliceCounter + 1}.`,
    "Do one coherent slice toward the approved contract; prefer one subsystem or milestone over the whole goal.",
    `Track at most ${MAX_SLICE_SUBTASKS} focused subtasks for this slice.`,
    "The controller has seeded one slice subtask; mark it complete only when the slice is implemented, reviewed, and verified.",
    "After implementing this slice, review it thoroughly, find and fix bugs, then run focused validation before marking the slice complete.",
    'Use goal(action="subtask") to create/update the slice checklist as work becomes clear or completed.',
    'Call goal(action="complete") only if the full contract is verified. If user input is needed, call goal(action="pause").',
    "",
    goalFramePrompt(goal),
  ].join("\n");
}

export function sliceSummaryInstructions(goal: GoalState): string {
  const slice = goal.currentSlice;
  return [
    `Summarize goal slice ${slice?.id ?? goal.sliceCounter}.`,
    "Preserve:",
    "- concrete work completed",
    "- files read/changed and why",
    "- validation/tests/evidence",
    "- current checklist state",
    "- blockers or user decisions needed",
    "- recommended next slice",
    "Keep it compact but sufficient to continue from this summary as the active context.",
  ].join("\n");
}

function formatSubtasks(goal: GoalState): string {
  const current = sliceSubtasks(goal, goal.currentSlice?.id);
  const carried = goal.subtasks.filter(
    (item) => !item.completed && item.sliceId !== goal.currentSlice?.id,
  );
  const subtasks = current.length > 0 ? current : carried;
  if (subtasks.length === 0) return "";
  return [
    "",
    current.length > 0 ? "Current slice subtasks:" : "Open carried subtasks:",
    ...subtasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${escapeXml(item.title)}`),
  ].join("\n");
}

export function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
