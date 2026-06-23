import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { readGoalState } from "../domain/state.ts";
import type { GoalSlicePlan, GoalTaskUpdate, GoalToolParams } from "../domain/types.ts";
import { GoalToolParamsSchema } from "../params.ts";
import type { GoalToolResult } from "./actions.ts";

export type GoalToolDeps = {
  presentGoalContract: (ctx: ExtensionContext, objective: string) => Promise<GoalToolResult>;
  updateGoalTasks: (
    ctx: ExtensionContext,
    slice: { name?: string; objective?: string } | undefined,
    slices: GoalSlicePlan[],
    tasks: GoalTaskUpdate[],
  ) => Promise<GoalToolResult>;
  completeGoal: (ctx: ExtensionContext) => Promise<GoalToolResult>;
  pauseGoalFromAgent: (ctx: ExtensionContext) => Promise<GoalToolResult>;
  toolResponse: (text: string, isError: boolean) => GoalToolResult;
};

export function registerGoalTool(pi: ExtensionAPI, deps: GoalToolDeps): void {
  pi.registerTool({
    name: "goal",
    label: "Goal",
    description:
      "Update durable state for the active long-running goal: contract, current-slice tasks, pause, or completion.",
    promptSnippet: "Use goal only for durable long-running goal state changes.",
    promptGuidelines: [
      "During setup, call goal(contract=<approved contract>) with no action after the user approves the contract.",
      'During execution, use goal(action="tasks") for current-slice task changes and queued future slice plans, goal(action="pause") for user blockers, and goal(action="complete") only after verification.',
      "Do not use goal to keep work going; the extension schedules visible slices.",
    ],
    parameters: GoalToolParamsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params: GoalToolParams, _signal, _onUpdate, ctx) {
      try {
        const action = params.action;
        if (params.contract !== undefined) {
          if (action !== undefined)
            return deps.toolResponse(
              "During setup, call goal(contract=<approved contract>) with no action.",
              true,
            );
          const goal = readGoalState(ctx);
          if (!goal || goal.status !== "setup")
            return deps.toolResponse(
              "Goal contract can only be presented while setup is pending.",
              true,
            );
          return deps.presentGoalContract(ctx, params.contract);
        }
        if (action === "tasks")
          return deps.updateGoalTasks(ctx, params.slice, params.slices ?? [], params.tasks ?? []);
        if (action === "pause") return deps.pauseGoalFromAgent(ctx);
        if (action === "complete") return deps.completeGoal(ctx);
        return deps.toolResponse(
          "Goal tool needs contract=<approved setup contract> while setup is pending, or action=tasks|pause|complete during execution.",
          true,
        );
      } catch (error) {
        return deps.toolResponse(`Goal tool failed: ${errorMessage(error)}`, true);
      }
    },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
