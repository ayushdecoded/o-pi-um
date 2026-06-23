import { randomUUID } from "node:crypto";

import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import { GOAL_STATE_ENTRY_TYPE } from "./constants.ts";
import type {
  GoalEntryData,
  GoalEventName,
  GoalSlicePlan,
  GoalState,
  GoalTask,
  GoalTaskPlan,
  GoalTaskUpdate,
} from "./types.ts";

const DEFAULT_SLICE_TASK = "Complete and verify slice";

export function createGoal(intent: string): GoalState {
  const now = nowSeconds();
  return {
    id: randomUUID(),
    intent,
    status: "setup",
    createdAt: now,
    updatedAt: now,
    blockedReason: null,
    sliceCounter: 0,
    completedSlices: 0,
    plannedSlices: [],
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
    if (data.event === "slice-start" && goal.currentSlice)
      goal.currentSlice.startEntryId = entry.id;
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
  return goal.status !== "setup" && Boolean(goal.contract?.trim());
}

export function isApprovedActiveGoal(goal: GoalState): boolean {
  return goal.status === "active" && isApprovedGoal(goal) && !goal.blockedReason;
}

export function activeObjective(goal: GoalState): string {
  return (
    goal.currentSlice?.objective || goal.plannedSlices[0]?.objective || goal.contract || goal.intent
  );
}

export function currentWorkItem(goal: GoalState): string {
  const task = currentTasks(goal).find(
    (item) => !item.completed && item.name.toLowerCase() !== DEFAULT_SLICE_TASK.toLowerCase(),
  );
  return task?.objective || task?.name || goal.currentSlice?.objective || activeObjective(goal);
}

export function currentTasks(goal: GoalState): GoalTask[] {
  return goal.currentSlice?.tasks ?? [];
}

export function incompleteTasks(goal: GoalState): GoalTask[] {
  return currentTasks(goal).filter((item) => !item.completed);
}

export function normalizeSlicePlans(plans: GoalSlicePlan[]): GoalSlicePlan[] {
  return plans.map(normalizeSlicePlan).filter(Boolean) as GoalSlicePlan[];
}

export function applySlicePlans(goal: GoalState, plans: GoalSlicePlan[]): string[] {
  const changed: string[] = [];
  for (const plan of normalizeSlicePlans(plans)) {
    const existing = goal.plannedSlices.find(
      (item) => item.name.toLowerCase() === plan.name.toLowerCase(),
    );
    if (existing) Object.assign(existing, plan);
    else goal.plannedSlices.push(plan);
    changed.push(`→ ${plan.name}`);
  }
  touchGoal(goal);
  return changed;
}

export function takeNextSlicePlan(goal: GoalState): GoalSlicePlan | undefined {
  return goal.plannedSlices.shift();
}

export function createSliceTasks(plan: GoalSlicePlan | undefined, objective: string): GoalTask[] {
  const tasks = plan?.tasks?.map(createTaskFromPlan).filter(Boolean) as GoalTask[] | undefined;
  return tasks?.length ? tasks : [createDefaultSliceTask(objective)];
}

export function createDefaultSliceTask(objective: string): GoalTask {
  return createTask({
    name: DEFAULT_SLICE_TASK,
    objective,
    verification: "Implementation is reviewed and focused validation passes.",
    completed: false,
  });
}

export function applyTaskUpdates(goal: GoalState, updates: GoalTaskUpdate[]): string[] {
  const slice = goal.currentSlice;
  if (!slice) throw new Error("No current goal slice is active.");

  const changed: string[] = [];
  for (const update of updates) {
    const name = update.name?.trim();
    if (!name) continue;
    const existing = slice.tasks.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (update.objective?.trim()) existing.objective = update.objective.trim();
      if (update.verification?.trim()) existing.verification = update.verification.trim();
      if (update.completed !== undefined) existing.completed = update.completed;
      if (update.evidence?.trim()) existing.evidence = update.evidence.trim();
      existing.updatedAt = nowSeconds();
      changed.push(`${existing.completed ? "✓" : "○"} ${existing.name}`);
      continue;
    }

    const objective = update.objective?.trim();
    const verification = update.verification?.trim();
    if (!objective || !verification) {
      throw new Error(`New task "${name}" needs objective and verification.`);
    }
    const task = createTask({
      name,
      objective,
      verification,
      completed: update.completed ?? false,
      evidence: update.evidence?.trim() || undefined,
    });
    slice.tasks.push(task);
    changed.push(`${task.completed ? "✓" : "○"} ${task.name}`);
  }
  touchGoal(goal);
  return changed;
}

export function touchGoal(goal: GoalState): void {
  goal.updatedAt = nowSeconds();
}

function normalizeSlicePlan(plan: GoalSlicePlan): GoalSlicePlan | undefined {
  const name = plan.name?.trim();
  if (!name) return undefined;
  const tasks = plan.tasks?.map(normalizeTaskPlan).filter(Boolean) as GoalTaskPlan[] | undefined;
  return {
    name,
    ...(plan.objective?.trim() ? { objective: plan.objective.trim() } : {}),
    ...(tasks?.length ? { tasks } : {}),
  };
}

function normalizeTaskPlan(task: GoalTaskPlan): GoalTaskPlan | undefined {
  const name = task.name?.trim();
  const objective = task.objective?.trim();
  const verification = task.verification?.trim();
  return name && objective && verification ? { name, objective, verification } : undefined;
}

function createTaskFromPlan(task: GoalTaskPlan): GoalTask | undefined {
  const normalized = normalizeTaskPlan(task);
  return normalized ? createTask({ ...normalized, completed: false }) : undefined;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function cloneGoal(goal: GoalState): GoalState {
  return normalizeGoal(JSON.parse(JSON.stringify(goal)) as Partial<GoalState>);
}

function createTask(input: {
  name: string;
  objective: string;
  verification: string;
  completed: boolean;
  evidence?: string;
}): GoalTask {
  const now = nowSeconds();
  return {
    id: randomUUID(),
    name: input.name,
    objective: input.objective,
    verification: input.verification,
    completed: input.completed,
    ...(input.evidence ? { evidence: input.evidence } : {}),
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
  return { version: 1, event: data.event, goal: normalizeGoal(data.goal) };
}

function isGoalEventName(value: unknown): value is GoalEventName {
  return (
    typeof value === "string" &&
    [
      "created",
      "contract-approved",
      "tasks-updated",
      "completion-requested",
      "paused",
      "resumed",
      "completed",
      "slice-start",
      "slice-rolled-up",
      "cleared",
    ].includes(value)
  );
}

function normalizeGoal(value: Partial<GoalState>): GoalState {
  return {
    ...value,
    id: value.id!,
    intent: value.intent!,
    status: value.status!,
    createdAt: value.createdAt!,
    updatedAt: value.updatedAt!,
    sliceCounter: value.sliceCounter ?? 0,
    completedSlices: value.completedSlices ?? 0,
    plannedSlices: Array.isArray(value.plannedSlices) ? value.plannedSlices : [],
    ...(value.currentSlice
      ? {
          currentSlice: {
            ...value.currentSlice,
            tasks: Array.isArray(value.currentSlice.tasks) ? value.currentSlice.tasks : [],
          },
        }
      : {}),
  } as GoalState;
}

function isGoalState(value: unknown): value is GoalState {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.intent === "string" &&
    ["setup", "active", "paused", "complete"].includes(String(value.status)) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    (value.sliceCounter === undefined || typeof value.sliceCounter === "number") &&
    (value.completedSlices === undefined || typeof value.completedSlices === "number") &&
    (value.plannedSlices === undefined || Array.isArray(value.plannedSlices)) &&
    (value.currentSlice === undefined || isGoalSlice(value.currentSlice))
  );
}

function isGoalSlice(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    typeof value.objective === "string" &&
    typeof value.startedAt === "number" &&
    (value.tasks === undefined || Array.isArray(value.tasks))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
