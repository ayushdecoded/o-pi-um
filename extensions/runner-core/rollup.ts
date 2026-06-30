import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { hookInput } from "./hooks.ts";
import { isCurrent, type RunnerToken } from "./runtime.ts";
import { appendRunEntry, readRun } from "./store.ts";
import { finishIfComplete, pauseRun, rollUpUnit } from "./transitions.ts";
import type { RunnerDefinition, RunState, WorkUnit } from "./types.ts";

// Roll up exactly one completed unit. navigateTree() changes the active branch, so
// the completed pre-navigation run remains the source of truth. We re-read only to
// verify that the same run still exists before appending the compact rollup entry.
export async function rollUpReadyUnit(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: RunState,
  unit: WorkUnit,
  token: RunnerToken,
): Promise<void> {
  if (definition.rollup === false) return appendRolledUp(pi, ctx, definition, run, unit.id);
  if (!unit.startEntryId)
    return pauseAndAppend(
      pi,
      ctx,
      run,
      "missing_rollup_anchor",
      `No branch anchor for unit ${unit.id}.`,
      definition,
    );

  const result = await ctx.navigateTree(unit.startEntryId, {
    summarize: true,
    customInstructions: definition.rollupPrompt?.({ run, unit }) ?? defaultRollupPrompt(unit),
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
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: completed.value.id,
    kind: "completed",
  });
  await definition.hooks?.onCompleted?.(hookInput(pi, ctx, definition, completed.value));
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
  appendRunEntry(pi, ctx, {
    runnerId: paused.runnerId,
    runId: paused.id,
    kind: "paused",
    reason: paused.blockedReason,
    detail: paused.blockedDetail,
  });
  if (definition) await definition.hooks?.onPaused?.(hookInput(pi, ctx, definition, paused));
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
  appendRunEntry(pi, ctx, {
    runnerId: rolled.value.runnerId,
    runId: rolled.value.id,
    kind: "unit-rolled-up",
    unitId,
    ...summary,
  });
  await definition.hooks?.onUnitRolledUp?.({
    ...hookInput(pi, ctx, definition, rolled.value),
    unitId,
  });
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

function defaultRollupPrompt(unit: WorkUnit): string {
  return `Summarize completed work for ${unit.name}.
Keep durable facts: changes, evidence, validation, decisions, blockers, and next context.
Summarize only. Do not perform additional work.`;
}
