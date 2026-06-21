import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_STATUS_KEY,
  HEADLESS_AUTO_APPROVE_ENV,
  MAX_SLICE_SUBTASKS,
} from "../domain/constants.ts";
import { validateObjective } from "../domain/intent.ts";
import {
  activeObjective,
  appendGoalState,
  applySubtaskUpdates,
  incompleteSubtasks,
  sliceSubtasks,
  isApprovedActiveGoal,
  isApprovedGoal,
  normalizedObjectives,
  nowSeconds,
  readGoalState,
  touchGoal,
} from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { approveGoalContract, goalContractPreviewLines } from "../ui/approval.ts";
import { updateGoalUi } from "../ui/status.ts";
import { checklistSummaryText, formatGoalForTool, formatSubtaskUpdate } from "../ui/text.ts";

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
      return toolResponse("No goal setup is active. Start with /goal <intent>.", true);

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
    goal.objectives = [objective];
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

  async function updateGoalSubtasks(
    ctx: ExtensionContext,
    updatesRaw: Array<{ subtask?: string; title?: string; completed?: boolean }>,
  ) {
    const goal = readGoalState(ctx);
    if (!goal || !isApprovedActiveGoal(goal))
      return toolResponse("No active goal to update subtasks for.", true);

    const updates = updatesRaw
      .map((item) => ({
        title: (item.subtask ?? item.title ?? "").trim(),
        completed: item.completed ?? false,
      }))
      .filter((item) => item.title.length > 0);
    if (updates.length === 0)
      return toolResponse("At least one subtask title must be non-empty.", true);

    const sliceId = goal.currentSlice?.id;
    const currentTitles = new Set(
      sliceSubtasks(goal, sliceId).map((item) => item.title.toLowerCase()),
    );
    const addedToSlice = new Set(
      updates.map((item) => item.title.toLowerCase()).filter((title) => !currentTitles.has(title)),
    );
    if (currentTitles.size + addedToSlice.size > MAX_SLICE_SUBTASKS) {
      return toolResponse(
        `Each goal slice can track at most ${MAX_SLICE_SUBTASKS} subtasks. Update existing slice subtasks or wait for the next slice.`,
        true,
      );
    }

    const changed = applySubtaskUpdates(goal, sliceId, updates);
    appendGoalState(pi, ctx, "subtasks-updated", goal);
    updateGoalUi(ctx, goal);
    return toolResponse(
      updates.length === 1
        ? formatSubtaskUpdate(goal, updates[0]!.title, updates[0]!.completed)
        : `Updated ${updates.length} goal subtasks:\n${changed.join("\n")}\n\nChecklist: ${checklistSummaryText(goal)}`,
      false,
    );
  }

  async function expandGoal(ctx: ExtensionContext, objectives: string[], drop?: number) {
    const goal = readGoalState(ctx);
    if (!goal || !isApprovedActiveGoal(goal))
      return toolResponse("No approved active goal to expand.", true);

    goal.objectives = normalizedObjectives(goal);
    const lines: string[] = [];
    if (drop !== undefined) {
      if (drop <= 0 || drop >= goal.objectives.length)
        return toolResponse(
          `Invalid objective index ${drop}. Index 0 is the base contract and cannot be dropped.`,
          true,
        );
      const removed = goal.objectives.splice(drop, 1)[0]!;
      lines.push(`Dropped objective: ${removed}`);
    }
    for (const objective of objectives.map((item) => item.trim()).filter(Boolean)) {
      goal.objectives.push(objective);
      lines.push(`○ Objective added: ${objective}`);
    }
    if (lines.length === 0)
      return toolResponse("No changes: provide expansions.add or expansions.drop.", true);

    touchGoal(goal);
    appendGoalState(pi, ctx, "expanded", goal);
    updateGoalUi(ctx, goal);
    return toolResponse(`${lines.join("\n")}\n\nActive objective: ${activeObjective(goal)}`, false);
  }

  async function completeGoal(ctx: ExtensionContext) {
    const goal = readGoalState(ctx);
    if (!goal || !isApprovedActiveGoal(goal))
      return toolResponse("No active goal to complete.", true);

    const currentSliceTasks = goal.currentSlice ? sliceSubtasks(goal, goal.currentSlice.id) : [];
    if (goal.currentSlice && currentSliceTasks.length === 0)
      return toolResponse(
        "Track and complete at least one subtask for the current slice before completing the goal.",
        true,
      );

    const incomplete = incompleteSubtasks(goal);
    if (incomplete.length > 0)
      return toolResponse(
        `Cannot complete goal while subtasks remain incomplete:\n${incomplete.map((item) => `- ${item.title}`).join("\n")}`,
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
      return toolResponse("No active goal to pause.", true);

    goal.status = "paused";
    goal.blockedReason = "waiting_on_user";
    goal.blockedDetail =
      "Paused by the agent because user input or a decision is needed before safe progress can continue.";
    touchGoal(goal);
    appendGoalState(pi, ctx, "paused", goal);
    updateGoalUi(ctx, goal);
    return toolResponse(
      `Goal paused. Resume with /goal resume.\n${formatGoalForTool(goal)}`,
      false,
    );
  }

  return {
    presentGoalContract,
    updateGoalSubtasks,
    expandGoal,
    completeGoal,
    pauseGoalFromAgent,
  };
}

export function toolResponse(text: string, isError: boolean): GoalToolResult {
  return { content: [{ type: "text", text }], details: {}, isError };
}

function headlessAutoApproveEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env[HEADLESS_AUTO_APPROVE_ENV] ?? "");
}
