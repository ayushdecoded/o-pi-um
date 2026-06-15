import { formatCost } from "../../shared/format.ts";
import { activeObjective } from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { formatElapsed, formatTokens, truncate } from "./format.ts";
import { statusLabel } from "./statusline.ts";

// Text returned to the model/tool caller and plain status panels.
export function formatGoalForTool(goal: GoalState): string {
  const objective = truncate(activeObjective(goal), 220);
  const remaining =
    goal.tokenBudget === null
      ? "unbounded"
      : formatTokens(Math.max(0, goal.tokenBudget - goal.tokensUsed));
  const subtaskSummary =
    (goal.subtasks?.length ?? 0) > 0 ? `Checklist: ${checklistSummaryText(goal)}` : undefined;
  if (goal.status === "complete") {
    return [
      "✅ Goal achieved",
      `Objective: ${objective}`,
      `Time used: ${formatElapsed(goal.timeUsedSeconds)}`,
      `Tokens: ${formatTokens(goal.tokensUsed)}${goal.tokenBudget === null ? "" : ` / ${formatTokens(goal.tokenBudget)}`}`,
      formatExtraBudgets(goal),
      subtaskSummary,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    goal.status === "active" ? "🎯 Goal active" : `Goal: ${statusLabel(goal.status)}`,
    `Objective: ${objective}`,
    `Time used: ${formatElapsed(goal.timeUsedSeconds)}`,
    `Tokens: ${formatTokens(goal.tokensUsed)}${goal.tokenBudget === null ? "" : ` / ${formatTokens(goal.tokenBudget)} (${remaining} remaining)`}`,
    formatExtraBudgets(goal),
    subtaskSummary,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatExtraBudgets(goal: GoalState): string | undefined {
  const parts = [];
  if (goal.timeBudgetSeconds != null)
    parts.push(
      `time ${formatElapsed(goal.timeUsedSeconds)}/${formatElapsed(goal.timeBudgetSeconds)}`,
    );
  if (goal.turnBudget != null) parts.push(`turns ${goal.turnsUsed ?? 0}/${goal.turnBudget}`);
  if (goal.costBudgetUsd != null)
    parts.push(
      `cost $${formatCost(goal.costUsedUsd ?? 0, 4)}/$${formatCost(goal.costBudgetUsd, 4)}`,
    );
  return parts.length ? `Budgets: ${parts.join(" · ")}` : undefined;
}

export function formatSubtaskUpdate(goal: GoalState, title: string, completed: boolean): string {
  return [
    `${completed ? "☑" : "☐"} Subtask ${completed ? "completed" : "tracked"}: ${title}`,
    (goal.subtasks?.length ?? 0) > 0 ? `Checklist: ${checklistSummaryText(goal)}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function checklistSummaryText(goal: GoalState): string {
  const subtasks = goal.subtasks ?? [];
  const done = subtasks.filter((item) => item.completed).length;
  const open = Math.max(0, subtasks.length - done);
  return `${done}/${subtasks.length} done${open > 0 ? ` · ${open} open` : ""}`;
}

export function completionBudgetReport(goal: GoalState): string {
  const parts = [];
  if (goal.tokenBudget !== null)
    parts.push(
      `tokens used: ${formatTokens(goal.tokensUsed)} of ${formatTokens(goal.tokenBudget)}`,
    );
  if (goal.timeUsedSeconds > 0) parts.push(`time used: ${formatElapsed(goal.timeUsedSeconds)}`);
  return parts.length
    ? `Goal achieved. Final budget usage: ${parts.join("; ")}.`
    : "Goal achieved.";
}

export function compactGoalStateForAgent(goal: GoalState): Record<string, unknown> {
  const incomplete = (goal.subtasks ?? []).filter((s) => !s.completed);
  return {
    status: goal.status,
    intent: goal.intent.slice(0, 200),
    objective: activeObjective(goal).slice(0, 500),
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget,
    tokensRemaining:
      goal.tokenBudget === null ? null : Math.max(0, goal.tokenBudget - goal.tokensUsed),
    turnsUsed: goal.turnsUsed ?? 0,
    timeUsedSeconds: goal.timeUsedSeconds,
    timeBudgetSeconds: goal.timeBudgetSeconds ?? null,
    turnBudget: goal.turnBudget ?? null,
    costUsedUsd: goal.costUsedUsd ?? 0,
    costBudgetUsd: goal.costBudgetUsd ?? null,
    blockedReason: goal.blockedReason ?? null,
    blockedDetail: goal.blockedDetail ?? null,
    incompleteSubtasks: incomplete.length > 0 ? incomplete.map((s) => ({ title: s.title })) : null,
    totalSubtasks: (goal.subtasks ?? []).length,
  };
}
