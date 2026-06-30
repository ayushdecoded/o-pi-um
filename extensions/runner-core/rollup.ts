import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

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
  if (definition.rollup?.enabled === false) return appendRolledUp(pi, ctx, run, unit.id);
  if (!unit.startEntryId)
    return pauseAndAppend(
      pi,
      ctx,
      run,
      "missing_rollup_anchor",
      `No branch anchor for unit ${unit.id}.`,
    );

  const result = await ctx.navigateTree(unit.startEntryId, {
    summarize: true,
    customInstructions: definition.rollup?.prompt({ run, unit }) ?? defaultRollupPrompt(unit),
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
    );
  if (alreadyRolledUp(readRun(ctx, definition.id), unit.id)) return;

  appendRolledUp(pi, ctx, run, unit.id, extractSummary(result));
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
  ctx.ui.notify(`${definition.label} complete.`, "info");
}

export function pauseAndAppend(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  run: RunState,
  reason: string,
  detail: string,
): void {
  const paused = pauseRun(run, reason, detail);
  appendRunEntry(pi, ctx, {
    runnerId: paused.runnerId,
    runId: paused.id,
    kind: "paused",
    reason: paused.blockedReason,
    detail: paused.blockedDetail,
  });
  ctx.ui.notify(`${reason}: ${detail}`, "warning");
}

function appendRolledUp(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  run: RunState,
  unitId: string,
  summary?: { summaryEntryId?: string; summary?: string },
): void {
  const rolled = rollUpUnit(run, unitId, summary);
  if (!rolled.ok) return pauseAndAppend(pi, ctx, run, "rollup_failed", rolled.message);
  appendRunEntry(pi, ctx, {
    runnerId: rolled.value.runnerId,
    runId: rolled.value.id,
    kind: "unit-rolled-up",
    unitId,
    ...summary,
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
  return [
    `Summarize completed work for ${unit.name}.`,
    "Keep durable facts: changes, evidence, validation, decisions, blockers, and next context.",
    "Do not continue the work.",
  ].join("\n");
}
