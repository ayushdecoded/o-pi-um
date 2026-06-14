import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compactGoalStateForAgent } from "../ui/text.ts";
import { goalHelpText, pickWithSearch, showSubagentDetails } from "../ui/overlays.ts";
import { showGoalStatus } from "../ui/status.ts";
import {
  clearCompletionBannerTimer,
  scheduleCompletionBannerClear,
  stopStatusRefresh,
  updateGoalUi,
} from "../ui/dashboard.ts";
import {
  goalMetrics,
  isApprovedActiveGoal,
  isApprovedGoal,
  nowSeconds,
  touchGoal,
} from "../domain/state.ts";
import {
  assistantCostUsage,
  assistantQuestionText,
  assistantTokenUsage,
  estimateMessageTokens,
  goalBudgetExceeded,
  looksAborted,
  tokenUsageFromUsage,
} from "../runtime/analysis.ts";

import { registerGoalTool } from "./tool.ts";
import { compactionRecoveryInstruction, volatileGoalStatePrompt } from "../prompt/prompts.ts";
import { goalRef, readGoal, writeGoal } from "../runtime/store.ts";
import { registerGoalCommands } from "./commands.ts";
import { createGoalActions } from "./actions.ts";
import {
  accountLiveElapsed,
  canAutoContinue,
  clearRuntimeFlags,
  keepGoalMessageForState,
  queueContinuation,
  queueSetup,
  runtime,
  toolResponse,
} from "./runtime.ts";
import type { GoalState } from "../domain/types.ts";

export default function goalExpansion(pi: ExtensionAPI) {
  const actions = createGoalActions(pi);

  // Model-facing tool surface. The actual lifecycle handlers live below so they can share runtime state.
  registerGoalTool(pi, {
    presentGoalContract: actions.presentGoalContract,
    updateGoalSubtasks: actions.updateGoalSubtasks,
    expandGoal: actions.expandGoal,
    completeGoal: actions.completeGoal,
    pauseGoalFromAgent: actions.pauseGoalFromAgent,
    continueGoalFromAgent: actions.continueGoalFromAgent,
    toolResponse,
  });

  // Human-facing slash commands (/goal, /goal_model). These are separate from model tool calls.
  registerGoalCommands(pi, {
    showGoalStatus,
    updateGoalUi,
    showSubagentDetails,
    goalHelpText,
    pickWithSearch,
    queueSetup,
    queueContinuation,
    clearRuntimeFlags,
    accountLiveElapsed,
  });

  // After compaction, queue one normal continuation with the compacted summary as orientation.
  pi.on("session_compact", async (event, ctx) => {
    try {
      if (runtime.lastCompactionContinuationId === event.compactionEntry.id) return;
      const goal = await readGoal(goalRef(ctx));
      updateGoalUi(ctx, goal);
      if (!goal) return;
      if (
        isApprovedActiveGoal(goal) &&
        !goal.blockedReason &&
        ctx.isIdle() &&
        !ctx.hasPendingMessages() &&
        canAutoContinue(ctx)
      ) {
        runtime.lastCompactionContinuationId = event.compactionEntry.id;
        queueContinuation(
          pi,
          ctx,
          goal,
          "compact",
          compactionRecoveryInstruction(event.compactionEntry.summary),
        );
      }
    } catch {
      // Compaction recovery is best-effort; normal session_start bootstrap still applies after reload/resume.
    }
  });

  // Session bootstrap: restore UI and optionally resume idle active goals.
  pi.on("session_start", async (event, ctx) => {
    try {
      const goal = await readGoal(goalRef(ctx));
      updateGoalUi(ctx, goal);
      if (!goal) return;
      if (
        event.reason === "resume" &&
        goal.status === "paused" &&
        isApprovedGoal(goal) &&
        ctx.hasUI &&
        ctx.isIdle() &&
        !ctx.hasPendingMessages()
      ) {
        const choice = await ctx.ui.select(`Resume paused goal?\nGoal: ${goal.intent}`, [
          "Resume goal",
          "Leave paused",
        ]);
        if (choice === "Resume goal") {
          if (!isApprovedGoal(goal)) return;
          goal.status = "active";
          goal.budgetLimitPrompted = false;
          touchGoal(goal);
          await writeGoal(goalRef(ctx), goal);
          updateGoalUi(ctx, goal);
          queueContinuation(pi, ctx, goal, "resume");
        }
        return;
      }
      if (isApprovedActiveGoal(goal) && ctx.hasUI && ctx.isIdle() && !ctx.hasPendingMessages()) {
        queueContinuation(pi, ctx, goal, "resume");
      }
    } catch {
      // Session-resume UI hooks are best-effort; ignore stale ctx during CLI session resolution.
    }
  });

  // Keep stale internal follow-up messages out of model context after state changes.
  pi.on("context", async (event, ctx) => {
    try {
      const goal = await readGoal(goalRef(ctx));
      return {
        messages: event.messages.filter((message) => keepGoalMessageForState(message, goal)),
      };
    } catch {
      return;
    }
  });

  // Pending setup: inject contract-clarification guidance until objectives are approved.
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const goal = await readGoal(goalRef(ctx));
      if (!goal || isApprovedGoal(goal)) return;
      return {
        systemPrompt: `${event.systemPrompt}\n\nA goal setup is in progress. Intent: ${goal.intent}\nDiscuss with the user until success criteria, boundaries, validation, and ask-before constraints are clear. Make no assumptions. When enough context exists, call goal with contract=<full approved contract> and no action; the extension infers setup presentation.`,
      };
    } catch {
      return;
    }
  });

  // Runtime counters reset at each turn. Final accounting happens in agent_end.
  pi.on("agent_start", async (_event, ctx) => {
    try {
      runtime.currentTurnToolCalls = 0;
      runtime.currentSubTurns = [];
      runtime.completedThisTurnGoalId = null;
      runtime.liveTurnTokenEstimate = 0;
      runtime.currentSubagentTokens = 0;
      runtime.currentSubagentCostUsd = 0;
      const goal = await readGoal(goalRef(ctx));
      if (goal?.status === "active" || (goal && !isApprovedGoal(goal)))
        runtime.activeTurnStartedAt = nowSeconds();
      else runtime.activeTurnStartedAt = null;
      runtime.activeContinuationGoalId = runtime.pendingContinuationGoalId;
      runtime.activeContinuationVersion = runtime.pendingContinuationVersion;
      runtime.pendingContinuationGoalId = null;
    } catch {
      runtime.activeTurnStartedAt = null;
    }
  });

  // Lightweight per-turn tool accounting for goal budget/status display.
  pi.on("tool_execution_end", async (event) => {
    runtime.currentTurnToolCalls += 1;
    if (event.toolName !== "subagent") return;
    const usage = subagentUsageFromToolResult(event.result);
    runtime.currentSubagentTokens += usage.tokens;
    runtime.currentSubagentCostUsd += usage.costUsd;
  });

  pi.on("message_update", async (event) => {
    const role = (event.message as { role?: string }).role;
    // Accept assistant or model roles. If role is not set (partial streaming message), still process.
    if (role !== undefined && role !== "assistant" && role !== "model") return;
    runtime.liveTurnTokenEstimate = estimateMessageTokens(event.message);
  });

  // Track per-sub-turn usage inside the current agent interaction.
  // Keep continuation identity in memory until agent_end.
  pi.on("turn_end", async (event) => {
    try {
      const usage = (event.message as { usage?: Record<string, unknown> }).usage;
      const tokens = usage ? tokenUsageFromUsage(usage) : 0;
      if (tokens === 0) return;
      runtime.currentSubTurns.push({
        index: event.turnIndex,
        tokens,
        tools: event.toolResults.length,
        durationSeconds: 0,
      });
    } catch {
      // Best-effort sub-turn tracking
    }
  });

  // Turn settlement: charge usage, enforce budgets, auto-pause on questions/interrupts, queue next step.
  pi.on("agent_end", async (event, ctx) => {
    try {
      const ref = goalRef(ctx);
      let goal = await readGoal(ref);
      if (!goal) return;

      // Capture turn duration before accounting resets runtime.activeTurnStartedAt
      const turnStartedSeconds = runtime.activeTurnStartedAt;
      const nowSec = nowSeconds();
      if (goal.status === "active") {
        accountLiveElapsed(goal);
      } else if (!isApprovedGoal(goal) && runtime.activeTurnStartedAt !== null) {
        goal.timeUsedSeconds += Math.max(0, nowSec - turnStartedSeconds!);
        runtime.activeTurnStartedAt = null;
      }

      if (goal.status === "active" || runtime.completedThisTurnGoalId === goal.id) {
        const turnTokens = assistantTokenUsage(event.messages) + runtime.currentSubagentTokens;
        const turnDurationSec =
          turnStartedSeconds !== null ? Math.max(0, nowSec - turnStartedSeconds) : 0;
        const turnCalls = runtime.currentTurnToolCalls;
        goal.tokensUsed += turnTokens;
        goal.costUsedUsd =
          (goal.costUsedUsd ?? 0) +
          assistantCostUsage(event.messages) +
          runtime.currentSubagentCostUsd;
        goal.turnsUsed = (goal.turnsUsed ?? 0) + 1;
        goal.subTurns = runtime.currentSubTurns;
        if (turnCalls > 0) goalMetrics(goal).toolCalls += turnCalls;
        if (goal.status === "active" && goalBudgetExceeded(goal)) {
          goal.status = "paused";
          goal.blockedReason = "budget_limited";
          goal.blockedDetail =
            "Budget limit reached. Increase the budget and resume, or complete with a budget-exhausted note.";
          goalMetrics(goal).budgetLimits += 1;
          goal.budgetLimitPrompted = true;
          runtime.budgetWrapUpPending = false;
        }
      }

      if (looksAborted(event.messages) && goal.status === "active") {
        goal.status = "paused";
        touchGoal(goal);
        await writeGoal(ref, goal);
        updateGoalUi(ctx, goal);
        ctx.ui.notify("Goal paused after interrupt", "warning");
        clearRuntimeFlags();
        return;
      }

      if (runtime.activeContinuationGoalId === goal.id) {
        goalMetrics(goal).continuationsStarted += 1;
        runtime.activeContinuationGoalId = null;
        runtime.activeContinuationVersion = 0;
      }

      const question = assistantQuestionText(event.messages);
      if (goal.status === "active" && question) {
        goal.blockedReason = "waiting_on_user";
        goal.blockedDetail = question;
      }

      touchGoal(goal);
      await writeGoal(ref, goal);
      updateGoalUi(ctx, goal);
      if (runtime.completedThisTurnGoalId === goal.id) {
        runtime.liveTurnTokenEstimate = 0;
        updateGoalUi(ctx, goal);
        scheduleCompletionBannerClear(ctx, goal.id);
      }
    } catch {
      // Best-effort lifecycle accounting; ignore stale ctx during CLI session replacement.
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopStatusRefresh();
    clearCompletionBannerTimer();
    updateGoalUi(ctx, null);
  });
}

function subagentUsageFromToolResult(result: unknown): { tokens: number; costUsd: number } {
  const details = isRecord(result) ? result.details : undefined;
  const runs = isRecord(details) && Array.isArray(details.runs) ? details.runs : [];
  let tokens = 0;
  let costUsd = 0;
  for (const run of runs) {
    if (!isRecord(run) || !isRecord(run.usage)) continue;
    tokens += numberField(run.usage, "tokens");
    costUsd += numberField(run.usage, "costUsd");
  }
  return { tokens, costUsd };
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
