import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { isApprovedGoal } from "../domain/state.ts";
import type { GoalToolParams } from "../domain/types.ts";
import { GoalToolParamsSchema } from "../params.ts";
import { goalRef, readGoal, readGoalEnabled } from "../runtime/store.ts";

export type GoalToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError: boolean;
};

export type GoalToolDeps = {
  presentGoalContract: (ctx: ExtensionContext, objective: string) => Promise<GoalToolResult>;
  updateGoalSubtasks: (
    ctx: ExtensionContext,
    subtasks: Array<{ subtask: string; completed?: boolean }>,
  ) => Promise<GoalToolResult>;
  expandGoal: (
    ctx: ExtensionContext,
    objectives: string[],
    drop?: number,
  ) => Promise<GoalToolResult>;
  completeGoal: (ctx: ExtensionContext) => Promise<GoalToolResult>;
  pauseGoalFromAgent: (ctx: ExtensionContext) => Promise<GoalToolResult>;
  continueGoalFromAgent: (ctx: ExtensionContext) => Promise<GoalToolResult>;
  toolResponse: (text: string, isError: boolean) => GoalToolResult;
};

export function registerGoalTool(pi: ExtensionAPI, deps: GoalToolDeps): void {
  const {
    presentGoalContract,
    updateGoalSubtasks,
    expandGoal,
    completeGoal,
    pauseGoalFromAgent,
    continueGoalFromAgent,
    toolResponse,
  } = deps;
  pi.registerTool({
    name: "goal",
    label: "Goal",
    description:
      "Control a persistent long-running goal: subtask, expand, continue, pause, or complete.",
    promptSnippet: "Use goal for long-running objective lifecycle only.",
    promptGuidelines: [
      "Use goal for long-running objective lifecycle: subtask, expand, pause, complete. Every active goal turn ends with continue, pause, or complete.",
    ],
    parameters: GoalToolParamsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        if (!(await readGoalEnabled(goalRef(ctx))))
          return toolResponse("Goal mode is disabled. Use /goal_mode on to enable it.", true);
        const action = params.action as string | undefined;
        if (params.contract !== undefined) {
          const ref = goalRef(ctx);
          const goal = await readGoal(ref);
          if (action !== undefined)
            return toolResponse(
              "During setup, call goal(contract=<approved contract>) with no action.",
              true,
            );
          if (goal && !isApprovedGoal(goal)) return presentGoalContract(ctx, params.contract);
          return toolResponse("Goal contract can only be presented while setup is pending.", true);
        }
        if (action === "subtask") return updateGoalSubtasks(ctx, params.subtasks ?? []);
        if (action === "expand")
          return expandGoal(ctx, params.expansions?.add ?? [], params.expansions?.drop);
        if (action === "complete") return completeGoal(ctx);
        if (action === "pause") return pauseGoalFromAgent(ctx);
        if (action === "continue") return continueGoalFromAgent(ctx);
        return toolResponse(
          "Goal tool needs action=subtask, action=expand, action=pause, action=continue, action=complete, or contract=<approved setup contract> while setup is pending.",
          true,
        );
      } catch (error) {
        return toolResponse(`Goal tool failed: ${errorMessage(error)}`, true);
      }
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
