import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { readGoalState } from "../domain/state.ts";
import { goalFramePrompt } from "../prompt/prompts.ts";
import { updateGoalUi } from "../ui/status.ts";
import { createGoalActions, toolResponse } from "./actions.ts";
import { registerGoalCommands } from "./commands.ts";
import { registerGoalTool } from "./tool.ts";

export default function goalExpansion(pi: ExtensionAPI) {
  const actions = createGoalActions(pi);

  registerGoalTool(pi, {
    presentGoalContract: actions.presentGoalContract,
    updateGoalSubtasks: actions.updateGoalSubtasks,
    expandGoal: actions.expandGoal,
    completeGoal: actions.completeGoal,
    pauseGoalFromAgent: actions.pauseGoalFromAgent,
    toolResponse,
  });

  registerGoalCommands(pi);

  pi.on("session_start", async (_event, ctx) => {
    updateGoalUi(ctx, readGoalState(ctx));
  });

  pi.on("session_tree", async (_event, ctx) => {
    updateGoalUi(ctx, readGoalState(ctx));
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const goal = readGoalState(ctx);
    if (!goal || goal.status === "complete") return;
    return { systemPrompt: `${event.systemPrompt}\n\n${goalFramePrompt(goal)}` };
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    updateGoalUi(ctx, null);
  });
}
