import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readGoalState } from "../domain/state.ts";
import { registerGoalMessageRenderers } from "../ui/messages.ts";
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
      ctx.ui.notify("Goal is active but needs /goal resume to start the visible slice.", "warning");
    }
  });

  pi.on("session_before_tree", summarizeGoalTreeRollup);

  pi.on("agent_end", async (_event, ctx) => {
    scheduleGoalController(pi, ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    const goal = readGoalState(ctx);
    if (goal?.status === "active" && !goal.currentSlice && event.toolName !== "goal") {
      return {
        block: true,
        reason: hasGoalCommandContext(ctx)
          ? "Goal setup is complete; wait for the visible slice work order."
          : "Goal setup is complete; run /goal resume to start the visible slice work order.",
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
