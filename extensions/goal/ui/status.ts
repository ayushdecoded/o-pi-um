import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { GOAL_STATUS_KEY } from "../domain/constants.ts";
import { activeObjective } from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { truncate } from "./format.ts";
import { checklistSummaryText } from "./text.ts";

export function updateGoalUi(ctx: ExtensionContext, goal: GoalState | null): void {
  try {
    if (!ctx.hasUI) return;
    if (!goal) {
      ctx.ui.setStatus(GOAL_STATUS_KEY, undefined);
      ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(GOAL_STATUS_KEY, statusLine(ctx, goal));
    ctx.ui.setWidget(GOAL_STATUS_KEY, goalWidgetLines(ctx, goal), { placement: "aboveEditor" });
  } catch {
    // UI is best-effort.
  }
}

export async function showGoalStatus(ctx: ExtensionContext, goal: GoalState | null): Promise<void> {
  ctx.ui.notify(goalPanelPlaintext(goal), goal ? "info" : "warning");
}

export function goalPanelPlaintext(goal: GoalState | null): string {
  if (!goal) return "No active goal. Start one with /goal <intent>.";
  return [
    `Goal: ${goal.status}`,
    `Intent: ${goal.intent}`,
    goal.contract ? `Contract: ${goal.contract}` : undefined,
    `Objective: ${activeObjective(goal)}`,
    goal.currentSlice ? `Current slice: ${goal.currentSlice.id}` : undefined,
    goal.lastSummaryEntryId ? `Last summary: ${goal.lastSummaryEntryId}` : undefined,
    goal.blockedDetail ? `Blocked: ${goal.blockedDetail}` : undefined,
    goal.subtasks.length ? `Checklist: ${checklistSummaryText(goal)}` : "Checklist: none yet",
    ...goal.subtasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${item.title}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function statusLine(ctx: ExtensionContext, goal: GoalState): string {
  const theme = ctx.ui.theme;
  const checklist = goal.subtasks.length ? ` · ${checklistSummaryText(goal)}` : "";
  if (goal.status === "setup")
    return theme.fg("warning", `Goal setup: ${truncate(goal.intent, 36)}`);
  if (goal.status === "paused") return theme.fg("warning", `Goal paused${checklist}`);
  if (goal.status === "complete") return theme.fg("success", `Goal complete${checklist}`);
  const slice = goal.currentSlice ? `slice ${goal.currentSlice.id}` : "ready";
  return theme.fg("accent", `Goal active · ${slice}${checklist}`);
}

function goalWidgetLines(ctx: ExtensionContext, goal: GoalState): string[] {
  const theme = ctx.ui.theme;
  const marker =
    goal.status === "complete"
      ? "✓"
      : goal.status === "paused"
        ? "Ⅱ"
        : goal.status === "setup"
          ? "◇"
          : "●";
  const head = theme.fg(
    goal.status === "complete"
      ? "success"
      : goal.status === "paused" || goal.status === "setup"
        ? "warning"
        : "accent",
    `${marker} Goal ${goal.status}${goal.currentSlice ? ` · slice ${goal.currentSlice.id}` : ""}`,
  );
  const objective = truncate(activeObjective(goal), 120);
  const checklist = goal.subtasks.length ? `Checklist: ${checklistSummaryText(goal)}` : undefined;
  return [head, `  ${objective}`, checklist ? `  ${checklist}` : undefined].filter(
    (line): line is string => Boolean(line),
  );
}
