import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readGoalState } from "../domain/state.ts";
import { registerGoalMessageRenderers } from "../ui/messages.ts";
import { updateGoalUi } from "../ui/status.ts";
import { createGoalActions, toolResponse } from "./actions.ts";
import { registerGoalCommands } from "./commands.ts";
import { scheduleGoalController } from "./controller.ts";
import { summarizeGoalTreeRollup } from "./summary.ts";
import { registerGoalTool } from "./tool.ts";

export default function goalExpansion(pi: ExtensionAPI) {
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
    updateGoalUi(ctx, readGoalState(ctx));
  });

  pi.on("session_before_tree", summarizeGoalTreeRollup);

  pi.on("agent_end", async () => {
    scheduleGoalController(pi);
  });

  pi.on("tool_call", async (event, ctx) => {
    const goal = readGoalState(ctx);
    if (goal?.status === "active" && !goal.currentSlice && event.toolName !== "goal") {
      return {
        block: true,
        reason: "Goal setup is complete; wait for the visible slice work order.",
      };
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateGoalUi(ctx, readGoalState(ctx));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    updateGoalUi(ctx, null);
  });
}
