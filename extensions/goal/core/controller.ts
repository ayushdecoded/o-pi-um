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

type GoalRuntime = {
  commandCtx?: ExtensionCommandContext;
  generation: number;
  runningGoalId?: string;
  scheduled: boolean;
  shutdown: boolean;
};

type GoalRuntimeToken = {
  key: string;
  generation: number;
  goalId: string;
};

const goalRuntimes = new Map<string, GoalRuntime>();

export function rememberGoalCommandContext(ctx: ExtensionCommandContext): void {
  const runtime = runtimeFor(ctx);
  runtime.commandCtx = ctx;
  runtime.shutdown = false;
}

export function markGoalSessionActive(ctx: ExtensionContext): void {
  runtimeFor(ctx).shutdown = false;
}

export function resetGoalRuntime(ctx: ExtensionContext): void {
  const runtime = runtimeFor(ctx);
  runtime.generation += 1;
  runtime.commandCtx = undefined;
  runtime.runningGoalId = undefined;
  runtime.scheduled = false;
  runtime.shutdown = true;
}

export function hasGoalCommandContext(ctx: ExtensionContext): boolean {
  const key = sessionKey(ctx);
  const runtime = goalRuntimes.get(key);
  return Boolean(
    runtime?.commandCtx &&
    !runtime.shutdown &&
    runtime.commandCtx.sessionManager.getSessionId() === ctx.sessionManager.getSessionId(),
  );
}

export function scheduleGoalController(pi: ExtensionAPI, eventCtx: ExtensionContext): void {
  const key = sessionKey(eventCtx);
  const runtime = goalRuntimes.get(key);
  const ctx = runtime?.commandCtx;
  if (!runtime || runtime.shutdown || runtime.runningGoalId || runtime.scheduled || !ctx) return;
  if (sessionKey(ctx) !== key) {
    runtime.commandCtx = undefined;
    return;
  }
  const goal = readGoalState(ctx);
  if (!goal || goal.status !== "active" || goal.blockedReason) return;
  if (goalTurnInProgressReason(ctx)) return;

  const generation = runtime.generation;
  runtime.scheduled = true;
  void waitForAgentToStop(ctx)
    .then(async () => {
      if (!isRuntimeGenerationCurrent(key, generation)) return;
      await runGoalController(pi, ctx);
    })
    .catch((error: unknown) => {
      if (isRuntimeGenerationCurrent(key, generation))
        ctx.ui.notify(`Goal auto-run failed: ${errorMessage(error)}`, "warning");
    })
    .finally(() => {
      const current = goalRuntimes.get(key);
      if (current?.generation === generation) current.scheduled = false;
    });
}

export async function runGoalController(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  rememberGoalCommandContext(ctx);
  const key = sessionKey(ctx);
  const runtime = runtimeFor(ctx);
  const initial = readGoalState(ctx);
  if (!initial) {
    ctx.ui.notify("No active Goal. Start one with /goal <intent>.", "warning");
    return;
  }
  if (runtime.runningGoalId) {
    ctx.ui.notify("Goal controller is already running for this session.", "warning");
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

  const token = { key, generation: runtime.generation, goalId: initial.id };
  runtime.runningGoalId = initial.id;
  try {
    await runControllerUnlocked(pi, ctx, token);
  } finally {
    if (isRuntimeCurrent(token, ctx)) setGoalUiPhase(initial.id);
    const current = goalRuntimes.get(key);
    if (current?.generation === token.generation && current.runningGoalId === initial.id) {
      current.runningGoalId = undefined;
    }
  }
}

async function runControllerUnlocked(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  token: GoalRuntimeToken,
): Promise<void> {
  for (;;) {
    let goal = readCurrentGoal(ctx, token);
    if (!goal) return;
    updateGoalUi(ctx, goal);

    if (goal.status === "setup") {
      if (!(await runSetupTurn(pi, ctx, goal, token))) return;
      goal = readCurrentGoal(ctx, token);
      if (!goal) return;
      updateGoalUi(ctx, goal);
      if (goal.status === "setup") {
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

    goal = ensureSliceStarted(pi, ctx, goal, token);
    if (!goal) return;
    if (shouldRollUpSlice(goal)) {
      await rollUpSlice(pi, ctx, goal, token);
      continue;
    }

    const beforeFingerprint = sliceFingerprint(goal);
    if (!(await runSliceTurn(pi, ctx, goal, token))) return;

    const afterTurn = readCurrentGoal(ctx, token);
    if (!afterTurn) return;
    if (shouldRollUpSlice(afterTurn)) {
      await rollUpSlice(pi, ctx, afterTurn, token);
      continue;
    }
    if (afterTurn.status === "active" && !afterTurn.blockedReason) {
      if (currentTasks(afterTurn).length === 0) {
        pauseGoal(pi, ctx, afterTurn, "Slice produced no tracked tasks.", token);
        return;
      }
      if (sliceFingerprint(afterTurn) === beforeFingerprint) {
        pauseGoal(pi, ctx, afterTurn, "Slice made no durable task progress.", token);
        return;
      }
    }
  }
}

async function runSetupTurn(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  goal: GoalState,
  token: GoalRuntimeToken,
): Promise<boolean> {
  return sendVisibleTurn(pi, ctx, GOAL_SETUP_MESSAGE_TYPE, setupPrompt(goal), token, {
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
  token: GoalRuntimeToken,
): GoalState | null {
  if (goal.currentSlice?.startEntryId) return goal;
  if (!isRuntimeCurrent(token, ctx)) return null;

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
  if (!isRuntimeCurrent(token, ctx)) return null;
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
  token: GoalRuntimeToken,
): Promise<boolean> {
  const slice = goal.currentSlice;
  return sendVisibleTurn(pi, ctx, GOAL_WORK_ORDER_MESSAGE_TYPE, sliceWorkOrderPrompt(goal), token, {
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
  token: GoalRuntimeToken,
): void {
  if (!isRuntimeCurrent(token, ctx)) return;
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
  token: GoalRuntimeToken,
): Promise<GoalState> {
  const slice = goal.currentSlice;
  if (!slice?.startEntryId || !isRuntimeCurrent(token, ctx)) return goal;

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
  await waitForAgentToStop(ctx, token);
  if (!isRuntimeCurrent(token, ctx)) return goal;
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
  if (!isRuntimeCurrent(token, ctx)) return goal;
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
  token: GoalRuntimeToken,
  details: Record<string, unknown>,
): Promise<boolean> {
  if (!isRuntimeCurrent(token, ctx)) return false;
  if (!ctx.isIdle() || ctx.hasPendingMessages()) await waitForAgentToStop(ctx, token);
  if (!isRuntimeCurrent(token, ctx)) return false;
  pi.sendMessage(
    { customType, content, display: true, details },
    { triggerTurn: true, deliverAs: "followUp" },
  );
  if (await waitForAgentToStart(ctx, token)) await waitForAgentToStop(ctx, token);
  return isRuntimeCurrent(token, ctx);
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

function readCurrentGoal(ctx: ExtensionCommandContext, token: GoalRuntimeToken): GoalState | null {
  if (!isRuntimeCurrent(token, ctx)) return null;
  const goal = readGoalState(ctx);
  if (goal && goal.id !== token.goalId) return null;
  return goal;
}

function isRuntimeCurrent(token: GoalRuntimeToken, ctx?: ExtensionContext): boolean {
  if (ctx && sessionKey(ctx) !== token.key) return false;
  return isRuntimeGenerationCurrent(token.key, token.generation);
}

function isRuntimeGenerationCurrent(key: string, generation: number): boolean {
  const runtime = goalRuntimes.get(key);
  return Boolean(runtime && !runtime.shutdown && runtime.generation === generation);
}

function runtimeFor(ctx: ExtensionContext): GoalRuntime {
  const key = sessionKey(ctx);
  let runtime = goalRuntimes.get(key);
  if (!runtime) {
    runtime = { generation: 0, scheduled: false, shutdown: false };
    goalRuntimes.set(key, runtime);
  }
  return runtime;
}

function sessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
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

async function waitForAgentToStart(
  ctx: ExtensionContext,
  token?: GoalRuntimeToken,
): Promise<boolean> {
  for (let i = 0; i < 200; i += 1) {
    if (token && !isRuntimeCurrent(token, ctx)) return false;
    if (!ctx.isIdle()) return true;
    await delay(25);
  }
  return false;
}

async function waitForAgentToStop(ctx: ExtensionContext, token?: GoalRuntimeToken): Promise<void> {
  for (let i = 0; i < 24_000; i += 1) {
    if (token && !isRuntimeCurrent(token, ctx)) return;
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
