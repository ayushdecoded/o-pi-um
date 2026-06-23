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
      "Durable Goal state: approve contract, update tasks/future slices, pause, complete.",
    promptSnippet: "Goal: durable state only; never continuation.",
    promptGuidelines: [
      "Setup: after user approval, call goal({ contract }) only.",
      'Work: goal({ action:"tasks", slice?, tasks?, slices? }); tasks≤7; new tasks need objective+verification; completed tasks need evidence.',
      "Use pause for blockers; complete only after full-contract verification. Never use goal to schedule/continue.",
    ],
    parameters: GoalToolParamsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params: GoalToolParams, _signal, _onUpdate, ctx) {
      try {
        const action = params.action;
        if (params.contract !== undefined) {
          if (action !== undefined)
            return deps.toolResponse(
              "Setup contract call must be goal({ contract }) with no action.",
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
          "Use goal({ contract }) during setup, or goal({ action: tasks|pause|complete }) during work.",
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
