import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { parseGoalIntent } from "../domain/intent.ts";
import {
  appendGoalCleared,
  appendGoalState,
  createGoal,
  isApprovedGoal,
  readGoalState,
  setGoalLabel,
  touchGoal,
} from "../domain/state.ts";
import { goalHelpText, showSubagentDetails } from "../ui/overlays.ts";
import { showGoalStatus, updateGoalUi } from "../ui/status.ts";
import { runGoalController } from "./controller.ts";

export function registerGoalCommands(pi: ExtensionAPI): void {
  pi.registerCommand("agents", {
    description: "Show active subagent details",
    handler: async (_args, ctx) => withCommandErrors(ctx, async () => showSubagentDetails(ctx)),
  });

  pi.registerCommand("goal", {
    description: "Start, inspect, pause, resume, or clear a long-running goal",
    handler: async (args, ctx) =>
      withCommandErrors(ctx, async () => handleGoalCommand(pi, ctx, args.trim())),
  });
}

async function handleGoalCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  text: string,
): Promise<void> {
  const lower = text.toLowerCase();
  const goal = readGoalState(ctx);

  if (!text || lower === "status") {
    await showGoalStatus(ctx, goal);
    updateGoalUi(ctx, goal);
    return;
  }

  if (lower === "help") {
    ctx.ui.notify(goalHelpText(), "info");
    return;
  }

  if (lower === "pause") {
    if (!goal || goal.status !== "active") {
      ctx.ui.notify("No active goal to pause.", "warning");
      return;
    }
    goal.status = "paused";
    goal.blockedReason = "waiting_on_user";
    goal.blockedDetail = "Paused by user command.";
    touchGoal(goal);
    appendGoalState(pi, ctx, "paused", goal);
    updateGoalUi(ctx, goal);
    ctx.ui.notify("Goal paused", "info");
    return;
  }

  if (lower === "resume") {
    if (!goal) {
      ctx.ui.notify("No goal to resume.", "warning");
      return;
    }
    if (goal.status === "complete") {
      ctx.ui.notify("Goal is already complete.", "info");
      return;
    }
    if (isApprovedGoal(goal) && goal.status !== "active") {
      goal.status = "active";
      goal.blockedReason = null;
      goal.blockedDetail = undefined;
      touchGoal(goal);
      appendGoalState(pi, ctx, "resumed", goal);
      updateGoalUi(ctx, goal);
    }
    await runGoalController(pi, ctx);
    return;
  }

  if (lower === "clear" || lower === "cancel") {
    appendGoalCleared(pi, ctx);
    updateGoalUi(ctx, null);
    ctx.ui.notify(goal ? "Goal cleared" : "No goal to clear", goal ? "info" : "warning");
    return;
  }

  const parsed = parseGoalIntent(text);
  if (parsed.error) {
    ctx.ui.notify(parsed.error, "error");
    return;
  }

  if (goal && goal.status !== "complete") {
    const ok =
      !ctx.hasUI ||
      (await ctx.ui.confirm(
        "Replace current goal?",
        `Current: ${goal.intent}\n\nNew: ${parsed.intent}`,
      ));
    if (!ok) return;
  }

  const next = createGoal(parsed.intent);
  const createdId = appendGoalState(pi, ctx, "created", next);
  setGoalLabel(pi, createdId, `goal:${next.id.slice(0, 8)}:created`);
  pi.setSessionName(`Goal: ${parsed.intent.slice(0, 72)}`);
  updateGoalUi(ctx, next);
  ctx.ui.notify("Goal setup started", "info");
  await runGoalController(pi, ctx);
}

async function withCommandErrors(ctx: ExtensionContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    ctx.ui.notify(`Goal command failed: ${errorMessage(error)}`, "error");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
