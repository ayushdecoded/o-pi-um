import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isApprovedGoal, nowSeconds } from "../domain/state.ts";
import type { GoalState, GoalStatus } from "../domain/types.ts";
import { liveElapsedBaseline, runtime } from "../core/runtime.ts";
import { formatElapsed, formatTokens, truncate } from "./format.ts";
import { checklistSummaryText } from "./text.ts";

// Compact one-line status text shown in the TUI footer.
export function liveGoalSeconds(goal: GoalState): number {
  if (goal.status !== "active") return goal.timeUsedSeconds;
  return goal.timeUsedSeconds + Math.max(0, nowSeconds() - liveElapsedBaseline(goal));
}

export function tokenUsageLabel(goal: GoalState): string {
  const active = isGoalTurnActive(goal);
  const total = formatTokens(exactGoalTokensSoFar(goal));
  const budget = goal.tokenBudget === null ? null : formatTokens(goal.tokenBudget);
  const activeGlyph = active ? ` ${activityGlyph()}` : "";
  const base = budget === null ? `${total} tokens` : `${total}/${budget} tokens`;
  return `${base}${activeGlyph}`;
}

export function exactGoalTokensSoFar(goal: GoalState): number {
  return (
    goal.tokensUsed +
    (isGoalTurnActive(goal) ? currentCompletedSubTurnTokens() + runtime.currentSubagentTokens : 0)
  );
}

function isGoalTurnActive(goal: GoalState): boolean {
  return goal.status === "active" && runtime.activeTurnStartedAt !== null;
}

function currentCompletedSubTurnTokens(): number {
  return runtime.currentSubTurns.reduce((sum, item) => sum + item.tokens, 0);
}

function activityGlyph(): string {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return frames[Math.floor(Date.now() / 150) % frames.length] ?? "…";
}

export function statusLine(ctx: ExtensionContext, goal: GoalState): string {
  const theme = ctx.ui.theme;
  const liveSeconds = liveGoalSeconds(goal);
  const usage =
    goal.tokenBudget === null
      ? `${formatElapsed(liveSeconds)} · ${tokenUsageLabel(goal)}`
      : `${formatElapsed(liveSeconds)} · ${tokenUsageLabel(goal)}`;
  const checklist = goal.subtasks?.length ? ` · ${checklistSummaryText(goal)}` : "";
  const moreObjectives = Math.max(0, (goal.objectives?.length ?? 1) - 1);
  const objBadge = moreObjectives > 0 ? ` +${moreObjectives}obj` : "";
  if (!isApprovedGoal(goal)) return theme.fg("warning", `Goal setup: ${truncate(goal.intent, 32)}`);
  if (goal.blockedReason === "budget_limited")
    return theme.fg(
      "warning",
      `Goal budget-limited (${tokenUsageLabel(goal)}${objBadge}${checklist})`,
    );
  if (goal.status === "active" && goal.blockedReason === "waiting_on_user")
    return theme.fg("warning", `Goal waiting on user (/goal resume)${checklist}`);
  if (goal.status === "active")
    return theme.fg("accent", `Pursuing goal (${usage}${objBadge}${checklist})`);
  if (goal.status === "paused") return theme.fg("accent", `Goal paused (/goal resume)${checklist}`);
  return theme.fg(
    "success",
    `Goal achieved (${goal.tokenBudget === null ? formatElapsed(goal.timeUsedSeconds) : `${formatTokens(goal.tokensUsed)} tokens`}${objBadge}${checklist})`,
  );
}

export function statusLabel(status: GoalStatus): string {
  return status;
}
