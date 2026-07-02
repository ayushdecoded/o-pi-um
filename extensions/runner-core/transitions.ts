import { randomUUID } from "node:crypto";

import {
  isPlanComplete,
  isTaskComplete,
  isUnitRolledUp,
  isUnitWorkComplete,
  nextReadyTask,
  validatePlan,
} from "./graph.ts";
import type {
  CoreResult,
  ReadyWork,
  RunState,
  RunnerDefinition,
  RunPlan,
  RunWorkUnit,
  UnitSummary,
  WorkPlan,
  WorkTask,
} from "./types.ts";

type TaskEvidenceUpdate = Pick<WorkTask, "id" | "evidence"> & { attemptId?: string };

export function createRun(
  definition: RunnerDefinition,
  intent: string,
  metadata?: Record<string, unknown>,
): RunState {
  const now = nowSeconds();
  return {
    id: randomUUID(),
    runnerId: definition.id,
    status: "setup",
    intent: intent.trim(),
    summaries: [],
    ...(metadata ? { metadata } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function approvePlan(
  run: RunState,
  definition: RunnerDefinition,
  plan: WorkPlan,
): CoreResult<RunState> {
  if (run.status !== "setup") return fail("Plan can only be approved during setup.");
  const cleanPlan = resetPlanProgress(plan);
  const validation = validatePlan(cleanPlan, { policy: definition.policy });
  if (!validation.ok) return validation;
  return ok(
    touch({
      ...run,
      status: "active",
      plan: cleanPlan,
      blockedReason: undefined,
      blockedDetail: undefined,
    }),
  );
}

// Select and assign the next executable task. The assignment is tracked on RunState;
// plan nodes remain mostly immutable except for evidence/rollup anchors.
export function startNextWork(run: RunState): CoreResult<{ run: RunState; work: ReadyWork }> {
  if (run.status !== "active" || !run.plan) return fail("No active run plan.");
  const work = nextReadyTask(run);
  if (!work) return fail("No ready work is available.");
  return ok({
    run: touch({ ...run, currentUnitId: work.unit.id, currentTaskId: work.task.id }),
    work,
  });
}

export function updateTask(run: RunState, update: TaskEvidenceUpdate | null): CoreResult<RunState> {
  if (run.status !== "active" || !run.plan) return fail("No active run plan to update.");
  if (!update) return fail("Provide task evidence for the assigned task.");

  const plan = clone(run.plan);
  const issue = applyTaskEvidence(plan, run, update);
  if (issue) return fail(issue);
  return ok(touch({ ...run, plan, currentTaskId: undefined, currentTaskPacketId: undefined }));
}

export function failTask(run: RunState, update: TaskEvidenceUpdate): CoreResult<RunState> {
  if (run.status !== "active" || !run.plan) return fail("No active run plan to update.");
  if (!run.currentTaskId) return fail("No task is currently assigned.");
  if (update.id !== run.currentTaskId)
    return fail(`Task ${update.id} is not the current assigned task.`);
  const evidence = update.evidence?.trim();
  if (!evidence) return fail("Task failure needs evidence.");
  const plan = clone(run.plan);
  const task = findTask(plan, update.id);
  if (!task) return fail(`Unknown task ${update.id}.`);
  task.reports = [
    ...(task.reports ?? []),
    {
      attemptId: update.attemptId ?? randomUUID(),
      result: "failed",
      evidence,
      createdAt: nowSeconds(),
    },
  ];
  return ok(
    pauseRun(
      { ...run, plan, currentTaskId: undefined, currentTaskPacketId: undefined },
      "task_failed",
      evidence,
    ),
  );
}

export function rollUpUnit(
  run: RunState,
  unitId: string,
  summary?: Omit<UnitSummary, "createdAt" | "unitId">,
): CoreResult<RunState> {
  if (run.status !== "active" || !run.plan) return fail("No active plan to roll up.");
  if (run.currentUnitId !== unitId) return fail(`Unit ${unitId} is not the current unit.`);

  const plan = clone(run.plan);
  const unit = findUnit(plan, unitId);
  if (!unit) return fail(`Unknown unit ${unitId}.`);
  if (isUnitRolledUp(unit)) return fail(`Unit ${unitId} is already rolled up.`);
  if (!isUnitWorkComplete(unit)) return fail(`Unit ${unitId} is not complete yet.`);

  unit.runner = {
    ...(unit.runner ?? {}),
    summaryEntryId: summary?.summaryEntryId ?? `rolled-up:${unitId}`,
  };
  const summaries = [...run.summaries, { unitId, createdAt: nowSeconds(), ...summary }];
  return ok(
    touch({
      ...run,
      plan,
      currentUnitId: undefined,
      currentTaskId: undefined,
      currentTaskPacketId: undefined,
      summaries,
    }),
  );
}

export function finishIfComplete(run: RunState): CoreResult<RunState> {
  if (!isPlanComplete(run)) return fail("Plan is not complete yet.");
  return ok(
    touch({
      ...run,
      status: "complete",
      completedAt: nowSeconds(),
      blockedReason: undefined,
      blockedDetail: undefined,
    }),
  );
}

export function pauseRun(run: RunState, reason: string, detail?: string): RunState {
  return touch({ ...run, status: "paused", blockedReason: reason, blockedDetail: detail });
}

export function resumeRun(run: RunState): CoreResult<RunState> {
  if (run.status !== "paused") return fail("Only paused runs can be resumed.");
  if (!run.plan) return fail("Run has no approved plan to resume.");
  return ok(
    touch({ ...run, status: "active", blockedReason: undefined, blockedDetail: undefined }),
  );
}

export function currentUnit(run: RunState): RunWorkUnit | undefined {
  return run.plan?.units.find((unit) => unit.id === run.currentUnitId);
}

export function unitReadyToRollUp(run: RunState): RunWorkUnit | null {
  const unit = currentUnit(run);
  return unit && !isUnitRolledUp(unit) && isUnitWorkComplete(unit) ? unit : null;
}

export function hasAssignedIncompleteTask(run: RunState): boolean {
  if (!run.currentTaskId || !run.plan) return false;
  const task = findTask(run.plan, run.currentTaskId);
  return Boolean(task && !isTaskComplete(task) && run.currentTaskPacketId);
}

function applyTaskEvidence(
  plan: RunPlan,
  run: RunState,
  update: TaskEvidenceUpdate,
): string | null {
  const task = findTask(plan, update.id);
  if (!task) return `Unknown task ${update.id}.`;
  if (!run.currentTaskId) return "No task is currently assigned.";
  if (update.id !== run.currentTaskId) return `Task ${update.id} is not the current assigned task.`;
  if (isTaskComplete(task)) return `Completed task ${update.id} cannot be updated.`;

  const unit = unitForTask(plan, update.id);
  const doneLocal = new Set(unit?.tasks.filter(isTaskComplete).map((item) => item.id));
  if (!task.dependsOn.every((dep) => doneLocal.has(dep)))
    return `Task ${update.id} has incomplete dependencies.`;

  task.evidence = update.evidence?.trim();
  if (!task.evidence) return `Completed task ${task.id} needs evidence.`;
  task.reports = [
    ...(task.reports ?? []),
    {
      attemptId: update.attemptId ?? randomUUID(),
      result: "complete",
      evidence: task.evidence,
      createdAt: nowSeconds(),
    },
  ];
  return null;
}

function resetPlanProgress(plan: WorkPlan): WorkPlan {
  return {
    contract: plan.contract,
    ...(plan.metadata ? { metadata: clone(plan.metadata) } : {}),
    units: plan.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      objective: unit.objective,
      dependsOn: [...unit.dependsOn],
      ...(unit.metadata ? { metadata: clone(unit.metadata) } : {}),
      tasks: unit.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        objective: task.objective,
        verification: task.verification,
        dependsOn: [...task.dependsOn],
        ...(task.metadata ? { metadata: clone(task.metadata) } : {}),
      })),
    })),
  };
}

function unitForTask(plan: RunPlan, taskId: string): RunWorkUnit | undefined {
  return plan.units.find((unit) => unit.tasks.some((task) => task.id === taskId));
}

function findUnit(plan: RunPlan, id: string): RunWorkUnit | undefined {
  return plan.units.find((unit) => unit.id === id);
}

function findTask(plan: RunPlan, id: string): WorkTask | undefined {
  return plan.units.flatMap((unit) => unit.tasks).find((task) => task.id === id);
}

function ok<T>(value: T): CoreResult<T> {
  return { ok: true, value };
}

function fail<T>(message: string): CoreResult<T> {
  return { ok: false, message };
}

function touch(run: RunState): RunState {
  return { ...run, updatedAt: nowSeconds() };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
