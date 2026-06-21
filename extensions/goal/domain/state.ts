import { randomUUID } from "node:crypto";

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { GOAL_STATE_ENTRY_TYPE } from "./constants.ts";
import type { GoalEntryData, GoalEventName, GoalState, GoalSubtask } from "./types.ts";

export function createGoal(intent: string): GoalState {
  const now = nowSeconds();
  return {
    id: randomUUID(),
    intent,
    objectives: [],
    status: "setup",
    createdAt: now,
    updatedAt: now,
    blockedReason: null,
    subtasks: [],
    sliceCounter: 0,
  };
}

export function readGoalState(ctx: ExtensionContext): GoalState | null {
  let goal: GoalState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    const data = goalEntryData(entry);
    if (!data) continue;
    if (data.event === "cleared") {
      goal = null;
      continue;
    }
    if (!data.goal) continue;
    goal = cloneGoal(data.goal);
    if (data.event === "slice-start" && goal.currentSlice) {
      goal.currentSlice.startEntryId = entry.id;
    }
  }
  return goal;
}

export function appendGoalState(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  event: GoalEventName,
  goal: GoalState,
): string {
  const data: GoalEntryData = { version: 1, event, goal: cloneGoal(goal) };
  const maybeId = pi.appendEntry(GOAL_STATE_ENTRY_TYPE, data) as unknown;
  const id = typeof maybeId === "string" ? maybeId : ctx.sessionManager.getLeafId();
  if (!id) throw new Error("Goal state entry was appended, but no session leaf id is available.");
  return id;
}

export function appendGoalCleared(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const data: GoalEntryData = { version: 1, event: "cleared" };
  const maybeId = pi.appendEntry(GOAL_STATE_ENTRY_TYPE, data) as unknown;
  const id = typeof maybeId === "string" ? maybeId : ctx.sessionManager.getLeafId();
  if (!id) throw new Error("Goal clear entry was appended, but no session leaf id is available.");
  return id;
}

export function setGoalLabel(pi: ExtensionAPI, entryId: string | undefined, label: string): void {
  if (!entryId) return;
  try {
    pi.setLabel(entryId, label);
  } catch {
    // Labels are UI sugar; goal state never depends on them.
  }
}

export function isApprovedGoal(goal: GoalState): boolean {
  return goal.status !== "setup" && Boolean(goal.contract) && normalizedObjectives(goal).length > 0;
}

export function isApprovedActiveGoal(goal: GoalState): boolean {
  return goal.status === "active" && isApprovedGoal(goal) && !goal.blockedReason;
}

export function normalizedObjectives(goal: GoalState): string[] {
  return goal.objectives.filter((item) => item.trim().length > 0);
}

export function activeObjective(goal: GoalState): string {
  const objectives = normalizedObjectives(goal);
  return objectives.at(-1) ?? goal.contract ?? goal.intent;
}

export function currentWorkItem(goal: GoalState): string {
  const tasks = sliceSubtasks(goal, goal.currentSlice?.id).filter((item) => !item.completed);
  const specific = tasks.find(
    (item) => item.title.toLowerCase() !== "complete and verify this slice",
  );
  return specific?.title ?? goal.currentSlice?.objective ?? activeObjective(goal);
}

export function touchGoal(goal: GoalState): void {
  goal.updatedAt = nowSeconds();
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function cloneGoal(goal: GoalState): GoalState {
  return JSON.parse(JSON.stringify(goal)) as GoalState;
}

export function applySubtaskUpdates(
  goal: GoalState,
  sliceId: number | undefined,
  updates: Array<{ title: string; completed: boolean }>,
): string[] {
  const changed: string[] = [];
  for (const update of updates) {
    const existing = goal.subtasks.find(
      (item) =>
        item.title.toLowerCase() === update.title.toLowerCase() &&
        (item.sliceId === sliceId || !item.completed),
    );
    if (existing) {
      existing.sliceId = sliceId;
      existing.completed = update.completed;
      existing.updatedAt = nowSeconds();
    } else {
      goal.subtasks.push(createSubtask(update.title, update.completed, sliceId));
    }
    changed.push(`${update.completed ? "✓" : "○"} ${update.title}`);
  }
  touchGoal(goal);
  return changed;
}

export function sliceSubtasks(goal: GoalState, sliceId: number | undefined): GoalSubtask[] {
  return goal.subtasks.filter((item) => item.sliceId === sliceId);
}

export function incompleteSubtasks(goal: GoalState): GoalSubtask[] {
  return goal.subtasks.filter((item) => !item.completed);
}

function createSubtask(
  title: string,
  completed: boolean,
  sliceId: number | undefined,
): GoalSubtask {
  const now = nowSeconds();
  return {
    id: randomUUID(),
    title,
    completed,
    ...(sliceId ? { sliceId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function goalEntryData(entry: SessionEntry): GoalEntryData | null {
  if (entry.type !== "custom" || entry.customType !== GOAL_STATE_ENTRY_TYPE) return null;
  const data = entry.data;
  if (!isRecord(data) || data.version !== 1 || !isGoalEventName(data.event)) return null;
  if (data.event === "cleared") return { version: 1, event: "cleared" };
  if (!isGoalState(data.goal)) return null;
  return { version: 1, event: data.event, goal: data.goal };
}

function isGoalEventName(value: unknown): value is GoalEventName {
  return (
    typeof value === "string" &&
    [
      "created",
      "contract-approved",
      "subtasks-updated",
      "expanded",
      "paused",
      "resumed",
      "completed",
      "slice-start",
      "slice-rolled-up",
      "cleared",
    ].includes(value)
  );
}

function isGoalState(value: unknown): value is GoalState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.intent === "string" &&
    Array.isArray(value.objectives) &&
    ["setup", "active", "paused", "complete"].includes(String(value.status)) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    Array.isArray(value.subtasks) &&
    typeof value.sliceCounter === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
