import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  GOAL_ROLLUP_MESSAGE_TYPE,
  GOAL_SETUP_MESSAGE_TYPE,
  GOAL_WORK_ORDER_MESSAGE_TYPE,
} from "../domain/constants.ts";
import {
  activeObjective,
  appendGoalState,
  createSliceTasks,
  currentTasks,
  isApprovedActiveGoal,
  nowSeconds,
  readGoalState,
  setGoalLabel,
  takeNextSlicePlan,
  touchGoal,
} from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import {
  setupPrompt,
  sliceLabel,
  sliceSummaryInstructions,
  sliceWorkOrderPrompt,
} from "../prompt/prompts.ts";
import { setGoalUiPhase, updateGoalUi } from "../ui/status.ts";

let runningGoalId: string | null = null;
let savedCommandCtx: ExtensionCommandContext | null = null;
let scheduledController = false;

export function rememberGoalCommandContext(ctx: ExtensionCommandContext): void {
  savedCommandCtx = ctx;
}

export function scheduleGoalController(pi: ExtensionAPI): void {
  if (runningGoalId || scheduledController || !savedCommandCtx) return;
  const goal = readGoalState(savedCommandCtx);
  if (!goal || goal.status !== "active" || goal.blockedReason) return;
  if (goalTurnInProgressReason(savedCommandCtx)) return;
  scheduledController = true;
  void waitForAgentToStop(savedCommandCtx)
    .then(() => runGoalController(pi, savedCommandCtx!))
    .catch((error: unknown) =>
      savedCommandCtx?.ui.notify(`Goal auto-run failed: ${errorMessage(error)}`, "warning"),
    )
    .finally(() => {
      scheduledController = false;
    });
}

export async function runGoalController(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  rememberGoalCommandContext(ctx);
  const initial = readGoalState(ctx);
  if (!initial) {
    ctx.ui.notify("No active Goal. Start one with /goal <intent>.", "warning");
    return;
  }
  if (runningGoalId) {
    ctx.ui.notify("Goal controller is already running.", "warning");
    return;
  }
  const inProgress = goalTurnInProgressReason(ctx);
  if (inProgress) {
    ctx.ui.notify(
      `Goal resume skipped: ${inProgress}. Continue/wait for that turn first.`,
      "warning",
    );
    return;
  }
  runningGoalId = initial.id;
  try {
    await runControllerUnlocked(pi, ctx);
  } finally {
    setGoalUiPhase(initial.id);
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
        ctx.ui.notify("Goal setup is waiting for your answer.", "info");
        return;
      }
    }

    if (goal.status === "complete") {
      setGoalUiPhase(goal.id);
      ctx.ui.notify("Goal complete", "info");
      return;
    }
    if (goal.status === "paused" || goal.blockedReason) {
      setGoalUiPhase(goal.id);
      ctx.ui.notify("Goal paused. Resume with /goal resume.", "warning");
      return;
    }
    if (!isApprovedActiveGoal(goal)) return;

    goal = ensureSliceStarted(pi, ctx, goal);
    if (shouldRollUpSlice(goal)) {
      await rollUpSlice(pi, ctx, goal);
      continue;
    }

    const beforeFingerprint = sliceFingerprint(goal);
    await runSliceTurn(pi, ctx, goal);

    const afterTurn = readGoalState(ctx);
    if (!afterTurn) return;
    if (shouldRollUpSlice(afterTurn)) {
      await rollUpSlice(pi, ctx, afterTurn);
      continue;
    }
    if (afterTurn.status === "active" && !afterTurn.blockedReason) {
      if (currentTasks(afterTurn).length === 0) {
        pauseGoal(pi, ctx, afterTurn, "Slice produced no tracked tasks.");
        return;
      }
      if (sliceFingerprint(afterTurn) === beforeFingerprint) {
        pauseGoal(pi, ctx, afterTurn, "Slice made no durable task progress.");
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
  await sendVisibleTurn(pi, ctx, GOAL_SETUP_MESSAGE_TYPE, setupPrompt(goal), {
    goalId: goal.id,
    phase: "setup",
    title: "◇ Setup",
    detail: goal.intent,
  });
}

function ensureSliceStarted(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
): GoalState {
  if (goal.currentSlice?.startEntryId) return goal;

  goal.sliceCounter += 1;
  const plan = takeNextSlicePlan(goal);
  const objective =
    plan?.objective ??
    plan?.tasks?.map((task) => task.objective).join("; ") ??
    goal.contract ??
    goal.intent;
  goal.currentSlice = {
    id: goal.sliceCounter,
    name: plan?.name ?? `Slice ${goal.sliceCounter}`,
    objective,
    startedAt: nowSeconds(),
    tasks: createSliceTasks(plan, objective),
  };
  const entryId = appendGoalState(pi, ctx, "slice-start", goal);
  goal.currentSlice.startEntryId = entryId;
  setGoalUiPhase(goal.id);
  setGoalLabel(pi, entryId, sliceTreeLabel(goal, "start"));
  updateGoalUi(ctx, goal);
  return goal;
}

async function runSliceTurn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
): Promise<void> {
  const slice = goal.currentSlice;
  await sendVisibleTurn(pi, ctx, GOAL_WORK_ORDER_MESSAGE_TYPE, sliceWorkOrderPrompt(goal), {
    goalId: goal.id,
    phase: "slice",
    sliceId: slice?.id,
    title: `● ${sliceLabel(goal)}`,
    detail: slice?.objective ?? activeObjective(goal),
  });
}

function shouldRollUpSlice(goal: GoalState): boolean {
  if (!goal.currentSlice?.startEntryId) return false;
  if (goal.status === "paused" || goal.status === "complete" || goal.blockedReason) return true;
  const tasks = currentTasks(goal);
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
  return currentTasks(goal)
    .map(
      (task) =>
        `${task.completed ? "1" : "0"}:${task.name.toLowerCase()}:${task.objective}:${task.verification}:${task.evidence ?? ""}`,
    )
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

  setGoalUiPhase(
    goal.id,
    `↻ s${slice.id}${goal.status === "active" ? `→${slice.id + 1}` : ""}`,
    "summarizing",
  );
  updateGoalUi(ctx, goal);
  pi.sendMessage({
    customType: GOAL_ROLLUP_MESSAGE_TYPE,
    content: `Rolling up ${sliceLabel(goal)} into a branch summary before moving to the next slice.`,
    display: true,
    details: {
      goalId: goal.id,
      phase: "rollup",
      sliceId: slice.id,
      title: `↻ s${slice.id}${goal.status === "active" ? `→${slice.id + 1}` : ""}`,
      detail: "summarizing",
    },
  });
  const result = await ctx.navigateTree(slice.startEntryId, {
    summarize: true,
    customInstructions: sliceSummaryInstructions(goal),
    label: sliceTreeLabel(goal, "done"),
  });
  await waitForAgentToStop(ctx);
  if (result.cancelled) {
    setGoalUiPhase(goal.id);
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
  goal.completedSlices += 1;
  goal.currentSlice = undefined;
  const completeAfterRollup = goal.completeAfterCurrentSlice === true;
  goal.completeAfterCurrentSlice = undefined;
  touchGoal(goal);
  appendGoalState(pi, ctx, "slice-rolled-up", goal);
  if (completeAfterRollup) {
    goal.status = "complete";
    goal.completedAt = nowSeconds();
    goal.blockedReason = null;
    goal.blockedDetail = undefined;
    touchGoal(goal);
    appendGoalState(pi, ctx, "completed", goal);
  }
  if (goal.status === "active") setGoalUiPhase(goal.id, `→ s${slice.id + 1}`, "starting");
  else setGoalUiPhase(goal.id);
  updateGoalUi(ctx, goal);
  return goal;
}

async function sendVisibleTurn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  customType: string,
  content: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!ctx.isIdle() || ctx.hasPendingMessages()) await waitForAgentToStop(ctx);
  pi.sendMessage(
    { customType, content, display: true, details },
    { triggerTurn: true, deliverAs: "followUp" },
  );
  if (await waitForAgentToStart(ctx)) await waitForAgentToStop(ctx);
}

function summaryEntryIdFromNavigateResult(result: { cancelled: boolean }): string | undefined {
  const summaryEntry = (result as { summaryEntry?: { id?: unknown } }).summaryEntry;
  return typeof summaryEntry?.id === "string" ? summaryEntry.id : undefined;
}

export function goalTurnInProgressReason(ctx: ExtensionContext): string | null {
  const leaf = ctx.sessionManager.getLeafEntry() as
    | {
        type?: unknown;
        customType?: unknown;
        message?: { role?: unknown; stopReason?: unknown };
      }
    | undefined;
  if (!leaf) return null;
  if (
    leaf.type === "custom_message" &&
    (leaf.customType === GOAL_SETUP_MESSAGE_TYPE ||
      leaf.customType === GOAL_WORK_ORDER_MESSAGE_TYPE ||
      leaf.customType === GOAL_ROLLUP_MESSAGE_TYPE)
  ) {
    return "a Goal turn is already queued at the session leaf";
  }
  if (leaf.type !== "message") return null;
  if (leaf.message?.role === "toolResult") return "the last tool result has not been processed";
  if (leaf.message?.role === "assistant" && leaf.message.stopReason === "toolUse") {
    return "the last assistant message is still waiting on tool results";
  }
  return null;
}

function sliceTreeLabel(goal: GoalState, suffix: "start" | "done"): string {
  const slice = goal.currentSlice;
  const status = suffix === "done" ? "✓" : "●";
  const id = slice ? `s${String(slice.id).padStart(2, "0")}` : "s??";
  const name = slug(slice?.name ?? "slice");
  return `${status} ${id} · ${name}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
