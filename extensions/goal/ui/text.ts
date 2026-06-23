import { activeObjective, currentTasks } from "../domain/state.ts";
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
    currentTasks(goal).length > 0 ? taskSummaryText(goal) : undefined,
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatTaskUpdate(
  goal: GoalState,
  changed: string[],
  sliceChanged: boolean,
): string {
  const parts = [];
  if (sliceChanged && goal.currentSlice) parts.push(`Slice: ${goal.currentSlice.name}`);
  if (changed.length > 0) parts.push(...changed);
  parts.push(taskSummaryText(goal));
  return parts.join("\n");
}

export function taskSummaryText(goal: GoalState): string {
  const tasks = currentTasks(goal);
  const done = tasks.filter((item) => item.completed).length;
  const open = Math.max(0, tasks.length - done);
  return `Tasks: ${done}/${tasks.length} done${open > 0 ? ` · ${open} open` : ""}`;
}
