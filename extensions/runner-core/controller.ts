import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { RUNNER_SETUP_MESSAGE_TYPE, RUNNER_WORK_MESSAGE_TYPE } from "./constants.ts";
import { emitRunnerEvent } from "./effects.ts";
import { isPlanComplete } from "./graph.ts";
import { sendTurn } from "./messages.ts";
import { completeIfReady, pauseAndAppend, rollUpReadyUnit } from "./rollup.ts";
import {
  isCurrent,
  rememberRunnerContext,
  runtimeFor,
  runtimeKey,
  turnInProgressReason,
  type RunnerToken,
} from "./runtime.ts";
import { appendCoreEvent, readRun } from "./store.ts";
import { activateRunnerTool, clearRunnerTool } from "./tool-scope.ts";
import { hasAssignedIncompleteTask, startNextWork, unitReadyToRollUp } from "./transitions.ts";
import type { ReadyWork, RunnerDefinition, RunState } from "./types.ts";

export { rememberRunnerContext, resetRunnerContext, turnInProgressReason } from "./runtime.ts";

// agent_end scheduler. It only wakes the controller when a previous model/tool
// turn has settled; the controller itself emits at most one new packet per wake.
export function scheduleRunnerController(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  eventCtx: ExtensionContext,
): void {
  const eventRun = readRun(eventCtx, definition.id);
  if (!eventRun || eventRun.status === "complete" || eventRun.status === "paused") {
    clearRunnerTool(pi, eventCtx, definition);
    return;
  }
  activateRunnerTool(pi, eventCtx, definition);

  const runtime = runtimeFor(definition, eventCtx);
  const ctx = runtime.ctx;
  if (!ctx || runtime.shutdown || runtime.runningRunId || runtime.scheduled) return;
  if (runtimeKey(definition, ctx) !== runtimeKey(definition, eventCtx))
    return void (runtime.ctx = undefined);

  const run = readRun(ctx, definition.id);
  if (!run || run.status === "complete" || run.status === "paused") {
    clearRunnerTool(pi, ctx, definition);
    return;
  }
  activateRunnerTool(pi, ctx, definition);
  if (run.status !== "active" || run.blockedReason || turnInProgressReason(ctx)) return;

  const token = { key: runtimeKey(definition, ctx), generation: runtime.generation, runId: run.id };
  runtime.scheduled = true;
  queueMicrotask(() => {
    void runRunnerController(pi, definition, ctx).finally(() => {
      const current = runtimeFor(definition, ctx);
      if (current.generation === token.generation) current.scheduled = false;
    });
  });
}

export async function runRunnerController(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
): Promise<void> {
  rememberRunnerContext(definition, ctx);
  const initial = readRun(ctx, definition.id);
  if (!initial) return void ctx.ui.notify(`No ${definition.label} run is active.`, "warning");

  if (initial.status === "setup" || initial.status === "active")
    activateRunnerTool(pi, ctx, definition);

  const runtime = runtimeFor(definition, ctx);
  if (runtime.runningRunId) return;
  const inProgress = turnInProgressReason(ctx);
  if (inProgress)
    return void ctx.ui.notify(`${definition.label} is waiting: ${inProgress}.`, "warning");

  const token = {
    key: runtimeKey(definition, ctx),
    generation: runtime.generation,
    runId: initial.id,
  };
  runtime.runningRunId = initial.id;
  try {
    await controllerStep(pi, definition, ctx, token);
  } finally {
    const current = runtimeFor(definition, ctx);
    if (current.generation === token.generation && current.runningRunId === initial.id)
      current.runningRunId = undefined;
  }
}

// One event wake -> one concrete action: setup packet, task packet, rollup,
// or completion. If a task is already assigned, core waits for the model to
// report complete/failed via the tool instead of injecting another work packet.
async function controllerStep(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  token: RunnerToken,
): Promise<void> {
  const run = readCurrentRun(definition, ctx, token);
  if (!run || run.status === "complete") return;
  if (run.status === "paused" || run.blockedReason) return notifyPaused(ctx, definition, run);
  if (run.status === "setup") return sendSetupTurn(pi, definition, run);

  const workflow = definition.workflow ?? {};
  if (hasAssignedIncompleteTask(run)) {
    if (!run.currentTaskPacketEntryId) sendAssignedWorkTurn(pi, definition, ctx, run);
    return;
  }

  const unit = (workflow.unitReadyToRollUp ?? unitReadyToRollUp)(run);
  if (unit) {
    await rollUpReadyUnit(pi, definition, ctx, run, unit, token);
    return;
  }

  if ((workflow.isPlanComplete ?? isPlanComplete)(run))
    return completeIfReady(pi, definition, ctx, run);

  const started = (workflow.startNextWork ?? startNextWork)(run);
  if (!started.ok) return pauseAndAppend(pi, ctx, run, "blocked", started.message, definition);
  await sendWorkTurn(pi, definition, ctx, started.value.run, started.value.work);
}

function sendSetupTurn(pi: ExtensionAPI, definition: RunnerDefinition, run: RunState): void {
  sendTurn(pi, RUNNER_SETUP_MESSAGE_TYPE, definition.setupPrompt({ run }), {
    runnerId: definition.id,
    runId: run.id,
    phase: "setup",
  });
}

async function sendWorkTurn(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: RunState,
  work: ReadyWork,
): Promise<void> {
  const event = { type: "task.assigned", unitId: work.unit.id, taskId: work.task.id } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: definition.id,
    runId: run.id,
    event,
  });
  const afterAppend = readRun(ctx, definition.id) ?? run;
  await emitRunnerEvent(pi, ctx, definition, event, afterAppend, entryId);
  sendAssignedWorkTurn(pi, definition, ctx, afterAppend);
}

function sendAssignedWorkTurn(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: RunState,
): void {
  const work = assignedWork(run);
  if (!work) return;
  sendTurn(
    pi,
    RUNNER_WORK_MESSAGE_TYPE,
    definition.workPrompt({ run, ...work, summaries: run.summaries }),
    {
      runnerId: definition.id,
      runId: run.id,
      phase: "work",
      unitId: work.unit.id,
      taskId: work.task.id,
    },
  );
  appendCoreEvent(pi, ctx, {
    runnerId: definition.id,
    runId: run.id,
    event: { type: "task.packet_sent", unitId: work.unit.id, taskId: work.task.id },
  });
}

function assignedWork(run: RunState): ReadyWork | null {
  const unit = run.plan?.units.find((item) => item.id === run.currentUnitId);
  const task = unit?.tasks.find((item) => item.id === run.currentTaskId);
  return unit && task ? { unit, task } : null;
}

function readCurrentRun(
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  token: RunnerToken,
): RunState | null {
  if (!isCurrent(token)) return null;
  const run = readRun(ctx, definition.id);
  return run?.id === token.runId ? run : null;
}

function notifyPaused(ctx: ExtensionContext, definition: RunnerDefinition, run: RunState): void {
  ctx.ui.notify(
    `${definition.label} paused${run.blockedDetail ? `: ${run.blockedDetail}` : ""}.`,
    "warning",
  );
}
