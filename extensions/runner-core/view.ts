import type { RunnerRunView, RunState, WorkTask, WorkUnit } from "./types.ts";

export function toRunView(run: RunState | null): RunnerRunView | null {
  if (!run) return null;
  const {
    plan,
    metadata: _metadata,
    currentTaskPacketId: _packet,
    currentTaskId: _task,
    currentUnitId: _unit,
    ...rest
  } = run;
  return {
    ...clone(rest),
    ...(plan
      ? {
          plan: {
            contract: plan.contract,
            ...(plan.metadata ? { metadata: clone(plan.metadata) } : {}),
            units: plan.units.map(toPublicUnit),
          },
        }
      : {}),
  };
}

export function toPublicUnit(unit: WorkUnit): WorkUnit {
  const { runner: _runner, tasks, ...publicFields } = unit as WorkUnit & { runner?: unknown };
  return { ...clone(publicFields), tasks: tasks.map(toPublicTask) };
}

function toPublicTask(task: WorkTask): WorkTask {
  // Attempt ids are hidden packet ids. Keep task evidence visible, but do not
  // expose retry/attempt internals to prompts or extension-facing APIs.
  const { reports: _reports, ...publicFields } = task;
  return clone(publicFields);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
