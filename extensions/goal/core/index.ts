import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readGoalState } from "../domain/state.ts";
import { registerGoalMessageRenderers } from "../ui/messages.ts";
import { goalOwnerLabel, goalResumeCommand } from "../ui/names.ts";
import { registerGoalDashboardEvents, updateGoalUi } from "../ui/status.ts";
import { createGoalActions, toolResponse } from "./actions.ts";
import { registerGoalCommands } from "./commands.ts";
import {
  hasGoalCommandContext,
  markGoalSessionActive,
  resetGoalRuntime,
  scheduleGoalController,
} from "./controller.ts";
import { summarizeGoalTreeRollup } from "./summary.ts";
import { registerGoalTool } from "./tool.ts";

export default function goalExpansion(pi: ExtensionAPI) {
  registerGoalDashboardEvents(pi);
  const actions = createGoalActions(pi);

  registerGoalTool(pi, {
    presentGoalContract: actions.presentGoalContract,
    updateGoalTasks: actions.updateGoalTasks,
    completeGoal: actions.completeGoal,
    pauseGoalFromAgent: actions.pauseGoalFromAgent,
    toolResponse,
  });

  registerGoalMessageRenderers(pi);
  registerGoalCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    markGoalSessionActive(ctx);
    const goal = readGoalState(ctx);
    updateGoalUi(ctx, goal);
    if (goal?.status === "active" && !goal.currentSlice && !hasGoalCommandContext(ctx)) {
      ctx.ui.notify(
        `${goalOwnerLabel(goal)} is active but needs ${goalResumeCommand(goal)} to start the visible slice.`,
        "warning",
      );
    }
  });

  pi.on("session_before_tree", summarizeGoalTreeRollup);

  const refreshGoalUi = (_event: unknown, ctx: Parameters<typeof updateGoalUi>[0]) => {
    updateGoalUi(ctx, readGoalState(ctx));
  };

  pi.on("turn_start", refreshGoalUi);
  pi.on("tool_execution_start", refreshGoalUi);
  pi.on("tool_execution_end", refreshGoalUi);
  pi.on("tool_result", refreshGoalUi);
  pi.on("turn_end", refreshGoalUi);

  pi.on("agent_end", async (_event, ctx) => {
    updateGoalUi(ctx, readGoalState(ctx));
    scheduleGoalController(pi, ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    const goal = readGoalState(ctx);
    if (goal?.status === "active" && !goal.currentSlice && event.toolName !== "goal") {
      return {
        block: true,
        reason: hasGoalCommandContext(ctx)
          ? `${goalOwnerLabel(goal)} setup is complete; wait for the visible slice work order.`
          : `${goalOwnerLabel(goal)} setup is complete; run ${goalResumeCommand(goal)} to start the visible slice work order.`,
      };
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateGoalUi(ctx, readGoalState(ctx));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resetGoalRuntime(ctx);
    updateGoalUi(ctx, null);
  });
}
