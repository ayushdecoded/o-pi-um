import type {
  CoreResult,
  ReadyWork,
  RunState,
  RunnerPolicy,
  WorkPlan,
  WorkTask,
  WorkUnit,
} from "./types.ts";

export type PlanValidationOptions = { policy?: RunnerPolicy };

// Validate the model-created plan before activation. The model chooses the order;
// core enforces a rollup-friendly shape: earlier units only, local earlier task deps only.
export function validatePlan(
  plan: WorkPlan,
  options: PlanValidationOptions = {},
): CoreResult<WorkPlan> {
  const issues: string[] = [];
  if (!plan.contract.trim()) issues.push("Plan contract must not be empty.");
  if (plan.units.length === 0) issues.push("Plan must contain at least one unit.");

  const allIds = new Set<string>();
  const unitOrder = new Map<string, number>();
  for (const [index, unit] of plan.units.entries())
    collectUnit(unit, index, allIds, unitOrder, issues, options.policy);
  for (const [index, unit] of plan.units.entries())
    validateUnitDeps(unit, index, unitOrder, issues);

  return issues.length ? { ok: false, message: issues[0], issues } : { ok: true, value: plan };
}

// Units are executed one at a time so each unit has a clean branch rollup.
// The model creates the dependency graph; core follows it deterministically.
export function nextReadyTask(run: RunState): ReadyWork | null {
  if (!run.plan) return null;
  if (run.currentTaskId) {
    const assigned = findTask(run.plan, run.currentTaskId);
    if (assigned) return assigned;
  }

  const activeUnit = run.currentUnitId
    ? run.plan.units.find((unit) => unit.id === run.currentUnitId)
    : undefined;
  if (activeUnit && !isUnitRolledUp(activeUnit)) return nextTaskInUnit(activeUnit);

  const nextUnit = run.plan.units.find(
    (unit) =>
      !isUnitRolledUp(unit) && unit.dependsOn.every((dep) => isUnitRolledUpById(run.plan!, dep)),
  );
  return nextUnit ? nextTaskInUnit(nextUnit) : null;
}

export function isTaskComplete(task: WorkTask): boolean {
  return Boolean(task.evidence?.trim());
}

export function isUnitWorkComplete(unit: WorkUnit): boolean {
  return unit.tasks.length > 0 && unit.tasks.every(isTaskComplete);
}

export function isUnitRolledUp(unit: WorkUnit): boolean {
  return Boolean(unit.summaryEntryId);
}

export function isPlanComplete(run: RunState): boolean {
  return Boolean(run.plan?.units.length && run.plan.units.every(isUnitRolledUp));
}

function collectUnit(
  unit: WorkUnit,
  unitIndex: number,
  allIds: Set<string>,
  unitOrder: Map<string, number>,
  issues: string[],
  policy: RunnerPolicy | undefined,
): void {
  collectId(unit.id, "unit", allIds, issues);
  unitOrder.set(unit.id, unitIndex);
  if (!unit.name.trim()) issues.push(`Unit ${unit.id || "<missing>"} needs a name.`);
  if (!unit.objective.trim()) issues.push(`Unit ${unit.id || "<missing>"} needs an objective.`);
  if (unit.tasks.length === 0)
    issues.push(`Unit ${unit.id || "<missing>"} needs at least one task.`);
  if (policy?.maxTasksPerUnit && unit.tasks.length > policy.maxTasksPerUnit) {
    issues.push(
      `Unit ${unit.id} has ${unit.tasks.length} tasks; max is ${policy.maxTasksPerUnit}.`,
    );
  }

  const localTaskOrder = new Map<string, number>();
  for (const [taskIndex, task] of unit.tasks.entries())
    collectTask(task, taskIndex, allIds, localTaskOrder, issues);
  for (const [taskIndex, task] of unit.tasks.entries())
    validateTaskDeps(task, taskIndex, localTaskOrder, issues);
}

function collectTask(
  task: WorkTask,
  taskIndex: number,
  allIds: Set<string>,
  localTaskOrder: Map<string, number>,
  issues: string[],
): void {
  collectId(task.id, "task", allIds, issues);
  localTaskOrder.set(task.id, taskIndex);
  if (!task.name.trim()) issues.push(`Task ${task.id || "<missing>"} needs a name.`);
  if (!task.objective.trim()) issues.push(`Task ${task.id || "<missing>"} needs an objective.`);
  if (!task.verification.trim()) issues.push(`Task ${task.id || "<missing>"} needs verification.`);
}

function validateUnitDeps(
  unit: WorkUnit,
  unitIndex: number,
  unitOrder: Map<string, number>,
  issues: string[],
): void {
  for (const dep of unit.dependsOn) {
    const depIndex = unitOrder.get(dep);
    if (depIndex === undefined) issues.push(`Unit ${unit.id} depends on unknown unit ${dep}.`);
    else if (depIndex >= unitIndex)
      issues.push(`Unit ${unit.id} can only depend on earlier units.`);
  }
}

function validateTaskDeps(
  task: WorkTask,
  taskIndex: number,
  localTaskOrder: Map<string, number>,
  issues: string[],
): void {
  for (const dep of task.dependsOn) {
    const depIndex = localTaskOrder.get(dep);
    if (depIndex === undefined) issues.push(`Task ${task.id} depends on non-local task ${dep}.`);
    else if (depIndex >= taskIndex)
      issues.push(`Task ${task.id} can only depend on earlier tasks.`);
  }
}

function nextTaskInUnit(unit: WorkUnit): ReadyWork | null {
  const done = new Set(unit.tasks.filter(isTaskComplete).map((task) => task.id));
  const task = unit.tasks.find(
    (item) => !isTaskComplete(item) && item.dependsOn.every((dep) => done.has(dep)),
  );
  return task ? { unit, task } : null;
}

function isUnitRolledUpById(plan: WorkPlan, unitId: string): boolean {
  const unit = plan.units.find((item) => item.id === unitId);
  return Boolean(unit && isUnitRolledUp(unit));
}

function findTask(plan: WorkPlan, taskId: string): ReadyWork | null {
  for (const unit of plan.units) {
    const task = unit.tasks.find((item) => item.id === taskId);
    if (task) return { unit, task };
  }
  return null;
}

function collectId(id: string, kind: string, ids: Set<string>, issues: string[]): void {
  if (!id.trim()) {
    issues.push(`${kind} id must not be empty.`);
    return;
  }
  if (ids.has(id)) issues.push(`Duplicate node id ${id}.`);
  ids.add(id);
}
