import type { GoalMetrics, GoalState } from "./types.ts";

// Approval is derived: no objectives means contract setup is still pending.
export function isApprovedGoal(goal: GoalState): boolean {
  return normalizedObjectives(goal).length > 0;
}

export function isApprovedActiveGoal(goal: GoalState): boolean {
  return goal.status === "active" && isApprovedGoal(goal) && !goal.blockedReason;
}

// Objectives are the source of truth. Empty list = still negotiating setup contract.
export function normalizedObjectives(goal: GoalState): string[] {
  return Array.isArray(goal.objectives) && goal.objectives.length > 0 ? goal.objectives : [];
}

// Clamp the cursor so stale UI/actions cannot point past the end after objective drops.
export function activeObjectiveIndex(goal: GoalState): number {
  const objectives = normalizedObjectives(goal);
  if (objectives.length === 0) return 0;
  return Math.max(0, Math.min(goal.currentObjectiveIndex ?? 0, objectives.length - 1));
}

// The model should see/work on one objective at a time, not the whole lifecycle loop.
export function activeObjective(goal: GoalState): string {
  const objectives = normalizedObjectives(goal);
  return objectives[activeObjectiveIndex(goal)] ?? goal.intent;
}

// After objective list mutations, normalize cursor once in one place.
export function advanceObjectiveCursor(goal: GoalState): void {
  goal.currentObjectiveIndex = activeObjectiveIndex(goal);
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function touchGoal(goal: GoalState): void {
  goal.updatedAt = nowSeconds();
}

export function goalMetrics(goal: GoalState): GoalMetrics {
  goal.metrics ??= { toolCalls: 0, continuationsStarted: 0, budgetLimits: 0 };
  return goal.metrics;
}
