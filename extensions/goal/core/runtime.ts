import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_CONTINUATION_MESSAGE_TYPE,
  GOAL_SETUP_MESSAGE_TYPE,
  HEADLESS_AUTO_APPROVE_ENV,
} from "../domain/constants.ts";
import { nowSeconds } from "../domain/state.ts";
import type { GoalState, GoalSubTurn } from "../domain/types.ts";
import { continuationPrompt, setupPrompt } from "../prompt/prompts.ts";

// Mutable process-local state for the goal loop.
// Keep this small: anything needed after restart belongs in runtime/store.ts.
export const runtime = {
  activeTurnStartedAt: null as number | null,
  currentTurnToolCalls: 0,
  pendingContinuationGoalId: null as string | null,
  pendingContinuationVersion: 0,
  activeContinuationGoalId: null as string | null,
  activeContinuationVersion: 0,
  budgetWrapUpPending: false,
  completedThisTurnGoalId: null as string | null,
  lastCompactionContinuationId: null as string | null,
  liveTurnTokenEstimate: 0,
  currentSubTurns: [] as GoalSubTurn[],
  currentSubagentTokens: 0,
  currentSubagentCostUsd: 0,
};

export function headlessAutoApproveEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[HEADLESS_AUTO_APPROVE_ENV] ?? "");
}

export function canAutoContinue(ctx: ExtensionContext): boolean {
  // Headless one-shot runs cannot process autonomous follow-up turns after exit.
  return ctx.hasUI;
}

export function keepGoalMessageForState(
  message: AgentMessage,
  goal: GoalState | null,
): boolean {
  if (!isRecord(message)) return true;
  // Only messages tagged by queueSetup/queueContinuation are loop machinery.
  // Everything else is real conversation context and must pass through untouched.
  const type = message.type;
  if (type !== GOAL_CONTINUATION_MESSAGE_TYPE && type !== GOAL_SETUP_MESSAGE_TYPE)
    return true;
  const goalId = typeof message.goalId === "string" ? message.goalId : undefined;
  if (!goal || goal.id !== goalId) return false;
  // Setup prompt is only valid before the contract has become objectives[0].
  if (type === GOAL_SETUP_MESSAGE_TYPE) return goal.objectives.length === 0;
  // Continuation prompts are only valid while the goal can actually continue.
  return goal.status === "active" && !goal.blockedReason;
}

export function queueSetup(pi: ExtensionAPI, goal: GoalState): void {
  pi.sendUserMessage(setupPrompt(goal.intent), {
    deliverAs: "followUp",
    metadata: {
      type: GOAL_SETUP_MESSAGE_TYPE,
      goalId: goal.id,
      reason: "setup",
    },
  });
}

// Queue the next loop tick. This does not plan or expand work; it only wakes the model.
export function queueContinuation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  goal: GoalState,
  reason: string,
  extraInstruction?: string,
): void {
  if (!canAutoContinue(ctx)) return;
  // Never stack internal follow-ups behind pending user/model work.
  if (ctx.hasPendingMessages()) return;
  runtime.pendingContinuationGoalId = goal.id;
  runtime.pendingContinuationVersion += 1;
  continuationSafeSend(pi, goal, reason, runtime.pendingContinuationVersion, extraInstruction);
}

// Metadata is the cache-busting key used by keepGoalMessageForState.
function continuationSafeSend(
  pi: ExtensionAPI,
  goal: GoalState,
  reason: string,
  version: number,
  extraInstruction?: string,
): void {
  pi.sendUserMessage(continuationPrompt(goal, reason, extraInstruction), {
    deliverAs: "followUp",
    metadata: {
      type: GOAL_CONTINUATION_MESSAGE_TYPE,
      goalId: goal.id,
      reason,
      version,
    },
  });
}

export function clearRuntimeFlags(): void {
  runtime.pendingContinuationGoalId = null;
  runtime.activeContinuationGoalId = null;
  runtime.budgetWrapUpPending = false;
  runtime.completedThisTurnGoalId = null;
}

// Fold live turn time into durable budget usage before mutating state mid-turn.
export function accountLiveElapsed(goal: GoalState): void {
  goal.timeUsedSeconds += Math.max(0, nowSeconds() - liveElapsedBaseline(goal));
  runtime.activeTurnStartedAt = null;
}

export function liveElapsedBaseline(goal: GoalState): number {
  return runtime.activeTurnStartedAt ?? goal.updatedAt ?? nowSeconds();
}

export function toolResponse(text: string, isError: boolean) {
  return { content: [{ type: "text" as const, text }], details: {}, isError };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
