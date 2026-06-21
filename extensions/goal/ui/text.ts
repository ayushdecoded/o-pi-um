import { activeObjective } from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { truncate } from "./format.ts";

export function formatGoalForTool(goal: GoalState): string {
  const lines = [
    goal.status === "complete"
      ? "✅ Goal complete"
      : goal.status === "active"
        ? "🎯 Goal active"
        : goal.status === "setup"
          ? "◇ Goal setup"
          : "Ⅱ Goal paused",
    `Objective: ${truncate(activeObjective(goal), 240)}`,
    goal.blockedDetail ? `Blocked: ${goal.blockedDetail}` : undefined,
    goal.subtasks.length > 0 ? `Checklist: ${checklistSummaryText(goal)}` : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatSubtaskUpdate(goal: GoalState, title: string, completed: boolean): string {
  return [
    `${completed ? "☑" : "☐"} Subtask ${completed ? "completed" : "tracked"}: ${title}`,
    `Checklist: ${checklistSummaryText(goal)}`,
  ].join("\n");
}

export function checklistSummaryText(goal: GoalState): string {
  const done = goal.subtasks.filter((item) => item.completed).length;
  const open = Math.max(0, goal.subtasks.length - done);
  return `${done}/${goal.subtasks.length} done${open > 0 ? ` · ${open} open` : ""}`;
}
