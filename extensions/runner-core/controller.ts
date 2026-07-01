import { randomUUID } from "node:crypto";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { RUNNER_SETUP_MESSAGE_TYPE, RUNNER_WORK_MESSAGE_TYPE } from "./constants.ts";
import { emitRunnerEvent } from "./effects.ts";
import { isPlanComplete, nextReadyTask } from "./graph.ts";
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
import type { ReadyWork, RunnerDefinition, RunState, WorkUnit } from "./types.ts";

export { rememberRunnerContext, resetRunnerContext, turnInProgressReason } from "./runtime.ts";

// agent_end scheduler. It only wakes the controller when a previous model/tool
// turn has settled; the controller itself emits at most one new packet per wake.
export function scheduleRunnerController(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  eventCtx: ExtensionContext,
): void {
  const branchRun = readRun(eventCtx, definition.id);
  if (!branchRun || branchRun.status === "complete" || branchRun.status === "paused") {
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
  if (!run || run.status !== "active" || run.blockedReason || turnInProgressReason(ctx)) return;

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
  if (!initial) {
    clearRunnerTool(pi, ctx, definition);
    return void ctx.ui.notify(`No ${definition.label} run is active.`, "warning");
  }
  if (initial.status === "complete" || initial.status === "paused")
    clearRunnerTool(pi, ctx, definition);
  else activateRunnerTool(pi, ctx, definition);

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

  if (run.currentTaskId) {
    const assigned = nextReadyTask(run);
    if (assigned && !hasVisibleWorkPacket(ctx, definition, run))
      return sendAssignedWorkTurn(
        pi,
        definition,
        run,
        assigned,
        run.currentTaskPacketId ?? randomUUID(),
      );
  }
  if (hasAssignedIncompleteTask(run)) return;

  const unit = unitReadyToRollUp(run);
  if (unit) {
    await rollUpReadyUnit(pi, definition, ctx, run, unit, token);
    const afterRollup = readCurrentRun(definition, ctx, token);
    if (afterRollup && afterRollup.status === "active")
      await controllerStep(pi, definition, ctx, token);
    return;
  }

  if (isPlanComplete(run)) return completeIfReady(pi, definition, ctx, run);

  const started = startNextWork(run);
  if (!started.ok) return pauseAndAppend(pi, ctx, run, "blocked", started.message, definition);
  await sendWorkTurn(pi, definition, ctx, started.value.run, started.value.work);
}

function sendSetupTurn(pi: ExtensionAPI, definition: RunnerDefinition, run: RunState): void {
  sendTurn(pi, RUNNER_SETUP_MESSAGE_TYPE, definition.setupPrompt({ run: publicRun(run) }), {
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
  const packetId = randomUUID();
  const event = {
    type: "task.assigned",
    unitId: work.unit.id,
    taskId: work.task.id,
    packetId,
  } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: definition.id,
    runId: run.id,
    event,
  });
  const afterAppend = readRun(ctx, definition.id) ?? run;
  await emitRunnerEvent(pi, ctx, definition, event, afterAppend, entryId);
  sendAssignedWorkTurn(pi, definition, afterAppend, work, packetId);
}

function sendAssignedWorkTurn(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  run: RunState,
  work: ReadyWork,
  packetId: string,
): void {
  sendTurn(
    pi,
    RUNNER_WORK_MESSAGE_TYPE,
    definition.workPrompt({
      run: publicRun(run),
      unit: publicUnit(work.unit),
      task: work.task,
      summaries: run.summaries,
    }),
    {
      runnerId: definition.id,
      runId: run.id,
      phase: "work",
      unitId: work.unit.id,
      taskId: work.task.id,
      packetId,
    },
  );
}

function hasVisibleWorkPacket(
  ctx: ExtensionCommandContext,
  definition: RunnerDefinition,
  run: RunState,
): boolean {
  if (!run.currentTaskPacketId) return false;
  return ctx.sessionManager.getBranch().some((entry) => {
    const packet = entry as {
      type?: unknown;
      customType?: unknown;
      details?: Record<string, unknown>;
    };
    return (
      packet.type === "custom_message" &&
      packet.customType === RUNNER_WORK_MESSAGE_TYPE &&
      packet.details?.runnerId === definition.id &&
      packet.details.runId === run.id &&
      packet.details.taskId === run.currentTaskId &&
      packet.details.packetId === run.currentTaskPacketId
    );
  });
}

function publicRun(run: RunState) {
  const {
    plan,
    currentTaskPacketId: _packet,
    currentTaskId: _task,
    currentUnitId: _unit,
    metadata: _metadata,
    ...rest
  } = run;
  return {
    ...rest,
    ...(plan
      ? {
          plan: {
            contract: plan.contract,
            units: plan.units.map(publicUnit),
          },
        }
      : {}),
  };
}

function publicUnit(unit: ReadyWork["unit"]): WorkUnit {
  const { runner: _runner, ...publicFields } = unit;
  return publicFields;
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
