import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { emitRunnerEvent } from "./effects.ts";
import { isCurrent, type RunnerToken } from "./runtime.ts";
import { appendCoreEvent, readRun } from "./store.ts";
import { clearRunnerTool } from "./tool-scope.ts";
import { finishIfComplete, pauseRun, rollUpUnit } from "./transitions.ts";
import type { RunnerDefinition, RunState, RunWorkUnit, WorkUnit } from "./types.ts";

// Roll up exactly one completed unit. navigateTree() changes the active branch, so
// the completed pre-navigation run remains the source of truth. We re-read only to
// verify that the same run still exists before appending the compact rollup entry.
export async function rollUpReadyUnit(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: RunState,
  unit: RunWorkUnit,
  token: RunnerToken,
): Promise<void> {
  if (definition.rollup === false) return appendRolledUp(pi, ctx, definition, run, unit.id);
  const startEntryId = unit.runner?.startEntryId;
  if (!startEntryId)
    return pauseAndAppend(
      pi,
      ctx,
      run,
      "missing_rollup_anchor",
      `No branch anchor for unit ${unit.id}.`,
      definition,
    );

  const result = await ctx.navigateTree(startEntryId, {
    summarize: true,
    customInstructions:
      definition.rollupPrompt?.({ run: publicRun(run), unit: publicUnit(unit) }) ??
      defaultRollupPrompt(unit),
    label: `✓ ${unit.id} ${unit.name}`,
  });
  if (!isCurrent(token) || readRun(ctx, definition.id)?.id !== token.runId) return;
  if (result.cancelled)
    return pauseAndAppend(
      pi,
      ctx,
      run,
      "rollup_cancelled",
      `Rollup cancelled for unit ${unit.id}.`,
      definition,
    );
  if (alreadyRolledUp(readRun(ctx, definition.id), unit.id)) return;

  await appendRolledUp(pi, ctx, definition, run, unit.id, extractSummary(result));
}

export async function completeIfReady(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: RunState,
): Promise<void> {
  const completed = finishIfComplete(run);
  if (!completed.ok) return;
  const event = { type: "run.completed" } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: definition.id,
    runId: completed.value.id,
    event,
  });
  await emitRunnerEvent(pi, ctx, definition, event, completed.value, entryId);
  clearRunnerTool(pi, ctx, definition);
  ctx.ui.notify(`${definition.label} complete.`, "info");
}

export async function pauseAndAppend(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  run: RunState,
  reason: string,
  detail: string,
  definition?: RunnerDefinition,
): Promise<void> {
  const paused = pauseRun(run, reason, detail);
  const event = {
    type: "run.paused",
    reason: paused.blockedReason ?? reason,
    detail: paused.blockedDetail,
  } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: paused.runnerId,
    runId: paused.id,
    event,
  });
  if (definition) {
    await emitRunnerEvent(pi, ctx, definition, event, paused, entryId);
    clearRunnerTool(pi, ctx, definition);
  }
  ctx.ui.notify(`${reason}: ${detail}`, "warning");
}

async function appendRolledUp(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  definition: RunnerDefinition,
  run: RunState,
  unitId: string,
  summary?: { summaryEntryId?: string; summary?: string },
): Promise<void> {
  const rolled = rollUpUnit(run, unitId, summary);
  if (!rolled.ok) return pauseAndAppend(pi, ctx, run, "rollup_failed", rolled.message, definition);
  const unit = rolled.value.plan?.units.find((item) => item.id === unitId);
  const event = {
    type: "unit.rolled_up",
    unitId,
    tasks: unit?.tasks.map((task) => ({ id: task.id, evidence: task.evidence })),
    ...summary,
  } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: rolled.value.runnerId,
    runId: rolled.value.id,
    event,
  });
  await emitRunnerEvent(pi, ctx, definition, event, rolled.value, entryId);
}

function publicRun(run: RunState) {
  const {
    plan,
    currentTaskPacketEntryId: _packet,
    currentTaskId: _task,
    currentUnitId: _unit,
    metadata: _metadata,
    ...rest
  } = run;
  return {
    ...rest,
    ...(plan ? { plan: { contract: plan.contract, units: plan.units.map(publicUnit) } } : {}),
  };
}

function publicUnit(unit: RunWorkUnit): WorkUnit {
  const { runner: _runner, ...publicFields } = unit;
  return publicFields;
}

function alreadyRolledUp(run: RunState | null, unitId: string): boolean {
  return Boolean(run?.summaries.some((summary) => summary.unitId === unitId));
}

function extractSummary(result: { summaryEntry?: unknown; cancelled?: boolean }): {
  summaryEntryId?: string;
  summary?: string;
} {
  const summaryEntry = result.summaryEntry as { id?: unknown; summary?: unknown } | undefined;
  return {
    ...(typeof summaryEntry?.id === "string" ? { summaryEntryId: summaryEntry.id } : {}),
    ...(typeof summaryEntry?.summary === "string" ? { summary: summaryEntry.summary } : {}),
  };
}

function defaultRollupPrompt(unit: RunWorkUnit): string {
  return `Summarize completed work for ${unit.name}.
Keep durable facts: changes, evidence, validation, decisions, blockers, and next context.
Summarize only. Do not perform additional work.`;
}
