import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readGoalState } from "../domain/state.ts";
import { registerGoalMessageRenderers } from "../ui/messages.ts";
import { updateGoalUi } from "../ui/status.ts";
import { createGoalActions, toolResponse } from "./actions.ts";
import { registerGoalCommands } from "./commands.ts";
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

  pi.on("session_tree", async (_event, ctx) => {
    updateGoalUi(ctx, readGoalState(ctx));
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    updateGoalUi(ctx, null);
  });
}
