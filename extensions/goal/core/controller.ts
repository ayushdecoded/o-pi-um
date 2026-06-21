import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { GOAL_SETUP_MESSAGE_TYPE, GOAL_WORK_ORDER_MESSAGE_TYPE } from "../domain/constants.ts";
import {
  activeObjective,
  appendGoalState,
  applySubtaskUpdates,
  isApprovedActiveGoal,
  nowSeconds,
  readGoalState,
  setGoalLabel,
  sliceSubtasks,
  touchGoal,
} from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { setupPrompt, sliceSummaryInstructions, sliceWorkOrderPrompt } from "../prompt/prompts.ts";
import { updateGoalUi } from "../ui/status.ts";

let runningGoalId: string | null = null;

export async function runGoalController(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const initial = readGoalState(ctx);
  if (!initial) {
    ctx.ui.notify("No goal to run. Start one with /goal <intent>.", "warning");
    return;
  }
  if (runningGoalId) {
    ctx.ui.notify("A goal controller is already running.", "warning");
    return;
  }
  runningGoalId = initial.id;
  try {
    await runControllerUnlocked(pi, ctx);
  } finally {
    runningGoalId = null;
  }
}

async function runControllerUnlocked(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  for (;;) {
    let goal = readGoalState(ctx);
    updateGoalUi(ctx, goal);
    if (!goal) return;

    if (goal.status === "setup") {
      await runSetupTurn(pi, ctx, goal);
      goal = readGoalState(ctx);
      updateGoalUi(ctx, goal);
      if (!goal || goal.status === "setup") {
        ctx.ui.notify(
          "Goal setup is waiting. Answer any question, then run /goal resume when ready.",
          "info",
        );
        return;
      }
    }

    if (goal.status === "complete") {
      ctx.ui.notify("Goal complete", "info");
      return;
    }
    if (goal.status === "paused" || goal.blockedReason) {
      ctx.ui.notify("Goal paused. Resume with /goal resume.", "warning");
      return;
    }
    if (!isApprovedActiveGoal(goal)) return;

    goal = ensureSliceStarted(pi, ctx, goal);
    const beforeFingerprint = sliceFingerprint(goal);
    await runSliceTurn(pi, ctx, goal);

    const afterTurn = readGoalState(ctx);
    if (!afterTurn) return;
    if (shouldRollUpSlice(afterTurn)) {
      await rollUpSlice(pi, ctx, afterTurn);
      continue;
    }
    if (afterTurn.status === "active" && !afterTurn.blockedReason) {
      const currentTasks = sliceSubtasks(afterTurn, afterTurn.currentSlice?.id);
      if (currentTasks.length === 0) {
        pauseGoal(pi, ctx, afterTurn, "Slice produced no tracked subtasks.");
        return;
      }
      if (sliceFingerprint(afterTurn) === beforeFingerprint) {
        pauseGoal(pi, ctx, afterTurn, "Slice made no durable checklist progress.");
        return;
      }
    }
  }
}

async function runSetupTurn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
): Promise<void> {
  await sendHiddenTurn(pi, ctx, GOAL_SETUP_MESSAGE_TYPE, setupPrompt(goal), {
    goalId: goal.id,
    phase: "setup",
  });
}

function ensureSliceStarted(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
): GoalState {
  if (goal.currentSlice?.startEntryId) return goal;

  goal.sliceCounter += 1;
  goal.currentSlice = {
    id: goal.sliceCounter,
    objective: activeObjective(goal),
    startedAt: nowSeconds(),
  };
  applySubtaskUpdates(goal, goal.currentSlice.id, [
    { title: "Complete and verify this slice", completed: false },
  ]);
  const entryId = appendGoalState(pi, ctx, "slice-start", goal);
  goal.currentSlice.startEntryId = entryId;
  setGoalLabel(pi, entryId, `goal:${shortId(goal.id)}:slice:${goal.currentSlice.id}:start`);
  updateGoalUi(ctx, goal);
  return goal;
}

async function runSliceTurn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
): Promise<void> {
  await sendHiddenTurn(pi, ctx, GOAL_WORK_ORDER_MESSAGE_TYPE, sliceWorkOrderPrompt(goal), {
    goalId: goal.id,
    sliceId: goal.currentSlice?.id,
    phase: "work",
  });
}

function shouldRollUpSlice(goal: GoalState): boolean {
  if (!goal.currentSlice?.startEntryId) return false;
  if (goal.status === "paused" || goal.status === "complete" || goal.blockedReason) return true;
  const tasks = sliceSubtasks(goal, goal.currentSlice.id);
  return tasks.length > 0 && tasks.every((task) => task.completed);
}

function pauseGoal(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
  detail: string,
): void {
  goal.status = "paused";
  goal.blockedReason = "waiting_on_user";
  goal.blockedDetail = detail;
  touchGoal(goal);
  appendGoalState(pi, ctx, "paused", goal);
  updateGoalUi(ctx, goal);
  ctx.ui.notify(`Goal paused: ${detail}`, "warning");
}

function sliceFingerprint(goal: GoalState): string {
  return sliceSubtasks(goal, goal.currentSlice?.id)
    .map((task) => `${task.completed ? "1" : "0"}:${task.title.toLowerCase()}`)
    .sort()
    .join("\n");
}

async function rollUpSlice(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
): Promise<GoalState> {
  const slice = goal.currentSlice;
  if (!slice?.startEntryId) return goal;

  const label = `goal:${shortId(goal.id)}:slice:${slice.id}:summary`;
  const result = await ctx.navigateTree(slice.startEntryId, {
    summarize: true,
    customInstructions: sliceSummaryInstructions(goal),
    label,
  });
  if (result.cancelled) {
    goal.status = "paused";
    goal.blockedReason = "waiting_on_user";
    goal.blockedDetail = "Slice rollup was cancelled.";
    touchGoal(goal);
    appendGoalState(pi, ctx, "paused", goal);
    updateGoalUi(ctx, goal);
    return goal;
  }

  const summaryEntryId =
    summaryEntryIdFromNavigateResult(result) ?? ctx.sessionManager.getLeafId() ?? undefined;
  goal.lastSummaryEntryId = summaryEntryId;
  goal.currentSlice = undefined;
  touchGoal(goal);
  appendGoalState(pi, ctx, "slice-rolled-up", goal);
  updateGoalUi(ctx, goal);
  return goal;
}

async function sendHiddenTurn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  customType: string,
  content: string,
  details: Record<string, unknown>,
): Promise<void> {
  pi.sendMessage({ customType, content, display: false, details }, { triggerTurn: true });
  if (await waitForAgentToStart(ctx)) await waitForAgentToStop(ctx);
}

function summaryEntryIdFromNavigateResult(result: { cancelled: boolean }): string | undefined {
  const summaryEntry = (result as { summaryEntry?: { id?: unknown } }).summaryEntry;
  return typeof summaryEntry?.id === "string" ? summaryEntry.id : undefined;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function waitForAgentToStart(ctx: ExtensionCommandContext): Promise<boolean> {
  for (let i = 0; i < 200; i += 1) {
    if (!ctx.isIdle()) return true;
    await delay(25);
  }
  return false;
}

async function waitForAgentToStop(ctx: ExtensionCommandContext): Promise<void> {
  for (let i = 0; i < 24_000; i += 1) {
    if (ctx.isIdle() && !ctx.hasPendingMessages()) return;
    await delay(25);
  }
  throw new Error("Timed out waiting for goal turn to finish.");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
