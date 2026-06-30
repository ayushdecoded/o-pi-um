import { nextReadyTask } from "./graph.ts";
import type { RunPlan, RunState } from "./types.ts";

export function runStatusText(run: RunState | null, label: string): string {
  if (!run) return `No active ${label} run.`;
  const ready = nextReadyTask(run);
  return [
    `${label}: ${run.status}`,
    `Intent: ${run.intent}`,
    run.plan ? `Contract: ${short(run.plan.contract, 240)}` : undefined,
    run.blockedDetail ? `Blocked: ${run.blockedDetail}` : undefined,
    ready ? `Current: ${ready.task.id} ${ready.task.name}` : undefined,
    run.plan ? taskCounts(run.plan) : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function planApprovedText(run: RunState): string {
  return ["Plan approved.", run.plan ? taskCounts(run.plan) : undefined].filter(Boolean).join("\n");
}

export function taskUpdateText(run: RunState): string {
  return ["Task evidence recorded.", run.plan ? taskCounts(run.plan) : undefined]
    .filter(Boolean)
    .join("\n");
}

function taskCounts(plan: RunPlan): string {
  const total = plan.units.reduce((sum, unit) => sum + unit.tasks.length, 0);
  const done = plan.units.reduce(
    (sum, unit) =>
      sum +
      (unit.runner?.summaryEntryId
        ? unit.tasks.length
        : unit.tasks.filter((task) => task.evidence?.trim()).length),
    0,
  );
  return `Tasks: ${done}/${total} complete`;
}

function short(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
