import { randomUUID } from "node:crypto";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { GOAL_STATUS_KEY, HEADLESS_AUTO_APPROVE_ENV } from "../domain/constants.ts";
import { validateObjective } from "../domain/intent.ts";
import {
  activeObjective,
  activeObjectiveIndex,
  advanceObjectiveCursor,
  isApprovedActiveGoal,
  isApprovedGoal,
  normalizedObjectives,
  nowSeconds,
  touchGoal,
} from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { goalRef, readGoal, writeGoal } from "../runtime/store.ts";
import { approveGoalContract, goalContractPreviewLines } from "../ui/approval.ts";
import { scheduleCompletionBannerClear, updateGoalUi } from "../ui/dashboard.ts";
import {
  checklistSummaryText,
  completionBudgetReport,
  formatGoalForTool,
  formatSubtaskUpdate,
} from "../ui/text.ts";
import {
  accountLiveElapsed,
  canAutoContinue,
  headlessAutoApproveEnabled,
  queueContinuation,
  runtime,
  toolResponse,
} from "./runtime.ts";

// Model tool actions. Each handler mutates durable state once, updates UI, then returns a text result.
export function createGoalActions(pi: ExtensionAPI) {
  // Setup approval boundary: converts clarified contract into the first approved objective.
  async function presentGoalContract(ctx: ExtensionContext, objectiveRaw: string) {
    const objective = objectiveRaw.trim();
    const validation = validateObjective(objective);
    if (validation) return toolResponse(validation, true);
    const ref = goalRef(ctx);
    const goal = await readGoal(ref);
    if (!goal || isApprovedGoal(goal))
      return toolResponse("No goal setup is active. Start with /goal <intent>.", true);

    let approved = headlessAutoApproveEnabled();
    // Interactive sessions require explicit contract approval before any goal work starts.
    if (ctx.hasUI) {
      ctx.ui.setWidget(GOAL_STATUS_KEY, goalContractPreviewLines(ctx, goal, objective), {
        placement: "aboveEditor",
      });
      approved = await approveGoalContract(ctx, goal, objective);
    } else if (!approved) {
      return toolResponse(
        `Goal contract presentation requires interactive approval. For autonomous tests, set ${HEADLESS_AUTO_APPROVE_ENV}=1.`,
        true,
      );
    }
    if (!approved) {
      updateGoalUi(ctx, goal);
      return toolResponse("Goal contract was not approved. Continue setup with the user.", true);
    }

    // Approved objectives are the source of truth; objectives.length === 0 means setup pending.
    goal.objectives = [objective];
    goal.currentObjectiveIndex = 0;
    goal.status = "active";
    goal.activatedAt = nowSeconds();
    goal.blockedReason = null;
    goal.blockedDetail = undefined;
    goal.budgetLimitPrompted = false;
    touchGoal(goal);
    await writeGoal(ref, goal);
    updateGoalUi(ctx, goal);
    ctx.ui.notify("Goal active", "info");
    queueContinuation(pi, ctx, goal, "present");
    return toolResponse(formatGoalForTool(goal), false);
  }

  // Subtasks are durable checklist items scoped to the currently active objective.
  async function updateGoalSubtasks(
    ctx: ExtensionContext,
    updatesRaw: Array<{ subtask: string; completed?: boolean }>,
  ) {
    // Normalize the model-friendly schema into the stored checklist shape.
    const updates = updatesRaw
      .map((item) => ({
        title: (item.subtask ?? "").trim(),
        completed: item.completed ?? false,
      }))
      .filter((item) => item.title.length > 0);
    if (updates.length === 0)
      return toolResponse("At least one subtask title must be non-empty.", true);
    const ref = goalRef(ctx);
    const goal = await readGoal(ref);
    if (!goal || !isApprovedGoal(goal) || goal.status !== "active")
      return toolResponse("No active goal to update subtasks for.", true);
    accountLiveElapsed(goal);
    const subtasks = goal.subtasks ?? [];
    const changed: string[] = [];
    // Names only de-dupe inside the active objective; different objectives can reuse task names.
    const objectiveIndex = activeObjectiveIndex(goal);
    for (const update of updates) {
      const existing = subtasks.find(
        (item) =>
          item.objectiveIndex === objectiveIndex &&
          item.title.toLowerCase() === update.title.toLowerCase(),
      );
      if (existing) {
        existing.completed = update.completed;
        existing.updatedAt = nowSeconds();
      } else {
        subtasks.push({
          id: randomUUID(),
          title: update.title,
          completed: update.completed,
          objectiveIndex: activeObjectiveIndex(goal),
          createdAt: nowSeconds(),
          updatedAt: nowSeconds(),
        });
      }
      changed.push(`${update.completed ? "✓" : "○"} ${update.title}`);
    }
    goal.subtasks = subtasks;
    touchGoal(goal);
    await writeGoal(ref, goal);
    updateGoalUi(ctx, goal);
    return toolResponse(
      updates.length === 1
        ? formatSubtaskUpdate(goal, updates[0]!.title, updates[0]!.completed)
        : `Updated ${updates.length} goal subtasks:\n${changed.join("\n")}\n\n${checklistSummaryText(goal)}`,
      false,
    );
  }

  // Expansion is intentionally just objective-list mutation; completion is derived from subtasks/work.
  async function expandGoal(
    ctx: ExtensionContext,
    objectives: string[],
    drop?: number,
  ): Promise<ReturnType<typeof toolResponse>> {
    const ref = goalRef(ctx);
    const goal = await readGoal(ref);
    if (!goal || !isApprovedGoal(goal) || goal.status !== "active")
      return toolResponse("No approved active goal to expand.", true);
    accountLiveElapsed(goal);
    goal.objectives = normalizedObjectives(goal);
    const lines: string[] = [];
    if (drop !== undefined) {
      // Dropping an objective also removes/reindexes its scoped subtasks.
      if (drop <= 0 || drop >= goal.objectives.length)
        return toolResponse(
          `Invalid objective index ${drop}: have ${goal.objectives.length} objectives. Index 0 is the base objective and cannot be dropped.`,
          true,
        );
      const removed = goal.objectives.splice(drop, 1)[0]!;
      goal.subtasks = (goal.subtasks ?? [])
        .filter((item) => item.objectiveIndex !== drop)
        .map((item) =>
          item.objectiveIndex > drop ? { ...item, objectiveIndex: item.objectiveIndex - 1 } : item,
        );
      goal.currentObjectiveIndex = Math.min(
        goal.currentObjectiveIndex,
        Math.max(0, goal.objectives.length - 1),
      );
      lines.push(`Dropped objective: ${removed}`);
    }
    if (objectives.length > 0) {
      for (const text of objectives) {
        if (!text.trim()) continue;
        goal.objectives.push(text.trim());
        lines.push(`○ Objective added: ${text.trim()}`);
      }
    }
    // Move to the first objective that still has open work, if any.
    advanceObjectiveCursor(goal);
    if (lines.length === 0)
      return toolResponse("No changes: provide expansions.add/objective or expansions.drop.", true);
    touchGoal(goal);
    await writeGoal(ref, goal);
    updateGoalUi(ctx, goal);
    return toolResponse(`${lines.join("\n")}\n\nActive objective: ${activeObjective(goal)}`, false);
  }

  // Completion is allowed only after all tracked subtasks are complete.
  async function completeGoal(ctx: ExtensionContext) {
    const ref = goalRef(ctx);
    const goal = await readGoal(ref);
    if (!goal || !isApprovedGoal(goal) || goal.status !== "active")
      return toolResponse("No active goal to complete.", true);
    // The checklist is the deterministic completion guardrail; the model still supplies evidence in text.
    const incomplete = (goal.subtasks ?? []).filter((item) => !item.completed);
    if (incomplete.length > 0)
      return toolResponse(
        `Cannot complete goal while subtasks remain incomplete:\n${incomplete.map((item) => `- ${item.title}`).join("\n")}`,
        true,
      );
    accountLiveElapsed(goal);
    goal.status = "complete";
    goal.blockedReason = null;
    goal.blockedDetail = undefined;
    // Keep the completion banner visible through the end of this turn.
    runtime.completedThisTurnGoalId = goal.id;
    goal.completedAt = nowSeconds();
    touchGoal(goal);
    await writeGoal(ref, goal);
    updateGoalUi(ctx, goal);
    runtime.activeContinuationGoalId = null;
    runtime.pendingContinuationGoalId = null;
    runtime.budgetWrapUpPending = false;
    return toolResponse(`${formatGoalForTool(goal)}\n\n${completionBudgetReport(goal)}`, false);
  }

  // Pause stops the loop. User can continue via /goal resume or goal(action="continue") after blocker clears.
  async function pauseGoalFromAgent(ctx: ExtensionContext) {
    const ref = goalRef(ctx);
    const goal = await readGoal(ref);
    if (!goal || !isApprovedGoal(goal) || goal.status !== "active")
      return toolResponse("No active goal to pause.", true);
    accountLiveElapsed(goal);
    goal.status = "paused";
    goal.blockedDetail = undefined;
    touchGoal(goal);
    await writeGoal(ref, goal);
    // Clear queued/active loop ticks so pause is immediate.
    runtime.pendingContinuationGoalId = null;
    runtime.activeContinuationGoalId = null;
    updateGoalUi(ctx, goal);
    return toolResponse(
      `Goal paused. The goal will not auto-continue until the user resumes it.
${formatGoalForTool(goal)}`,
      false,
    );
  }

  // Continue queues the next loop iteration; the model only sees objective/task context, not loop machinery.
  async function continueGoalFromAgent(ctx: ExtensionContext) {
    const ref = goalRef(ctx);
    const goal = await readGoal(ref);
    if (!goal || !isApprovedActiveGoal(goal))
      return toolResponse("No active goal to continue.", true);
    if (goal.blockedReason)
      return toolResponse(
        "Goal is blocked — inspect /goal status or continue after resolving the blocker.",
        true,
      );
    if (!canAutoContinue(ctx) || ctx.hasPendingMessages())
      return toolResponse("Cannot continue at this moment — inspect /goal status.", true);
    queueContinuation(pi, ctx, goal, "continue");
    return toolResponse(`Continue queued.\n${formatGoalForTool(goal)}`, false);
  }

  return {
    presentGoalContract,
    updateGoalSubtasks,
    expandGoal,
    completeGoal,
    pauseGoalFromAgent,
    continueGoalFromAgent,
  };
}
