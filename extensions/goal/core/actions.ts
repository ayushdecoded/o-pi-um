import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_STATUS_KEY,
  HEADLESS_AUTO_APPROVE_ENV,
  MAX_SLICE_TASKS,
} from "../domain/constants.ts";
import { validateObjective } from "../domain/intent.ts";
import {
  appendGoalState,
  applyTaskUpdates,
  currentTasks,
  incompleteTasks,
  isApprovedActiveGoal,
  isApprovedGoal,
  nowSeconds,
  readGoalState,
  setGoalLabel,
  touchGoal,
} from "../domain/state.ts";
import type { GoalTaskUpdate } from "../domain/types.ts";
import { approveGoalContract, goalContractPreviewLines } from "../ui/approval.ts";
import { updateGoalUi } from "../ui/status.ts";
import { formatGoalForTool, formatTaskUpdate, taskSummaryText } from "../ui/text.ts";

export type GoalToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError: boolean;
};

export function createGoalActions(pi: ExtensionAPI) {
  async function presentGoalContract(ctx: ExtensionContext, objectiveRaw: string) {
    const objective = objectiveRaw.trim();
    const validation = validateObjective(objective);
    if (validation) return toolResponse(validation, true);

    const goal = readGoalState(ctx);
    if (!goal || goal.status !== "setup")
      return toolResponse("No Goal setup is active. Start with /goal <intent>.", true);

    let approved = headlessAutoApproveEnabled();
    if (ctx.hasUI) {
      ctx.ui.setWidget(GOAL_STATUS_KEY, goalContractPreviewLines(ctx, goal, objective), {
        placement: "aboveEditor",
      });
      approved = await approveGoalContract(ctx, goal, objective);
    } else if (!approved) {
      return toolResponse(
        `Goal contract approval requires UI, or set ${HEADLESS_AUTO_APPROVE_ENV}=1 for headless tests.`,
        true,
      );
    }

    if (!approved) {
      updateGoalUi(ctx, goal);
      return toolResponse("Goal contract was not approved. Continue setup with the user.", true);
    }

    goal.contract = objective;
    goal.status = "active";
    goal.activatedAt = nowSeconds();
    goal.blockedReason = null;
    goal.blockedDetail = undefined;
    touchGoal(goal);
    appendGoalState(pi, ctx, "contract-approved", goal);
    updateGoalUi(ctx, goal);
    ctx.ui.notify("Goal contract approved", "info");
    return toolResponse(formatGoalForTool(goal), false);
  }

  async function updateGoalTasks(
    ctx: ExtensionContext,
    sliceRaw: { name?: string; objective?: string } | undefined,
    updatesRaw: GoalTaskUpdate[],
  ) {
    const goal = readGoalState(ctx);
    if (!goal || !isApprovedActiveGoal(goal))
      return toolResponse("No active Goal to update tasks for.", true);
    if (!goal.currentSlice) return toolResponse("No current goal slice is active.", true);

    let sliceChanged = false;
    const name = sliceRaw?.name?.trim();
    const objective = sliceRaw?.objective?.trim();
    if (name && name !== goal.currentSlice.name) {
      goal.currentSlice.name = name;
      sliceChanged = true;
    }
    if (objective && objective !== goal.currentSlice.objective) {
      goal.currentSlice.objective = objective;
      sliceChanged = true;
    }

    const updates = updatesRaw.flatMap((item): GoalTaskUpdate[] => {
      const name = item.name?.trim();
      if (!name) return [];
      return [
        {
          name,
          objective: item.objective?.trim(),
          verification: item.verification?.trim(),
          completed: item.completed,
          evidence: item.evidence?.trim(),
        },
      ];
    });

    if (updates.length === 0 && !sliceChanged)
      return toolResponse("Provide slice.name/objective or at least one task update.", true);

    const existingNames = new Set(currentTasks(goal).map((item) => item.name.toLowerCase()));
    const newNames = new Set(
      updates.map((item) => item.name!.toLowerCase()).filter((item) => !existingNames.has(item)),
    );
    if (existingNames.size + newNames.size > MAX_SLICE_TASKS) {
      return toolResponse(`Each goal slice can track at most ${MAX_SLICE_TASKS} tasks.`, true);
    }
    for (const update of updates) {
      if (
        !existingNames.has(update.name!.toLowerCase()) &&
        (!update.objective || !update.verification)
      ) {
        return toolResponse(
          `New task "${update.name}" needs objective and verification fields.`,
          true,
        );
      }
    }

    const changed = applyTaskUpdates(goal, updates);
    if (sliceChanged)
      setGoalLabel(
        pi,
        goal.currentSlice.startEntryId,
        startLabel(goal.currentSlice.id, goal.currentSlice.name),
      );
    touchGoal(goal);
    appendGoalState(pi, ctx, "tasks-updated", goal);
    updateGoalUi(ctx, goal);
    return toolResponse(formatTaskUpdate(goal, changed, sliceChanged), false);
  }

  async function completeGoal(ctx: ExtensionContext) {
    const goal = readGoalState(ctx);
    if (!goal || !isApprovedActiveGoal(goal))
      return toolResponse("No active Goal to complete.", true);

    const tasks = currentTasks(goal);
    if (goal.currentSlice && tasks.length === 0)
      return toolResponse(
        "Track and complete at least one task for the current slice before completing the goal.",
        true,
      );

    const incomplete = incompleteTasks(goal);
    if (incomplete.length > 0)
      return toolResponse(
        `Cannot complete goal while current-slice tasks remain incomplete:\n${incomplete.map((item) => `- ${item.name}`).join("\n")}`,
        true,
      );

    goal.status = "complete";
    goal.completedAt = nowSeconds();
    goal.blockedReason = null;
    goal.blockedDetail = undefined;
    touchGoal(goal);
    appendGoalState(pi, ctx, "completed", goal);
    updateGoalUi(ctx, goal);
    return toolResponse(formatGoalForTool(goal), false);
  }

  async function pauseGoalFromAgent(ctx: ExtensionContext) {
    const goal = readGoalState(ctx);
    if (!goal || !isApprovedGoal(goal) || goal.status !== "active")
      return toolResponse("No active Goal to pause.", true);

    goal.status = "paused";
    goal.blockedReason = "waiting_on_user";
    goal.blockedDetail =
      "Paused by the agent because user input or a decision is needed before safe progress can continue.";
    touchGoal(goal);
    appendGoalState(pi, ctx, "paused", goal);
    updateGoalUi(ctx, goal);
    return toolResponse(`Goal paused. Resume with /goal resume.\n${taskSummaryText(goal)}`, false);
  }

  return {
    presentGoalContract,
    updateGoalTasks,
    completeGoal,
    pauseGoalFromAgent,
  };
}

export function toolResponse(text: string, isError: boolean): GoalToolResult {
  return { content: [{ type: "text", text }], details: {}, isError };
}

function startLabel(id: number, name: string): string {
  return `● s${String(id).padStart(2, "0")} · ${slug(name)}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function headlessAutoApproveEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[HEADLESS_AUTO_APPROVE_ENV] ?? "");
}
