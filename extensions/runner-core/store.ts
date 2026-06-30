import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import type { RunEntry, RunEntryKind, RunState, UnitSummary, WorkPlan } from "./types.ts";

export const RUNNER_ENTRY_TYPE = "runner-core-entry";

// Materialize the active branch-local run from compact custom entries. Pi stores
// the entries in the session file; this layer only records runner-specific facts.
export function readRun(ctx: ExtensionContext, runnerId: string): RunState | null {
  let run: RunState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    const event = parseRunEntry(entry);
    if (!event || event.runnerId !== runnerId) continue;
    if (event.kind === "created") run = runFromCreated(event);
    else if (event.kind === "cleared") {
      if (run?.id === event.runId) run = null;
    } else if (run?.id === event.runId) {
      applyEntry(run, event, entry.id);
    }
  }
  return run;
}

export function appendRunEntry(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  entry: RunEntryInput,
): string {
  const data: RunEntry = { version: 1, timestamp: nowSeconds(), ...entry };
  const maybeId = pi.appendEntry(RUNNER_ENTRY_TYPE, data) as unknown;
  const id = typeof maybeId === "string" ? maybeId : ctx.sessionManager.getLeafId();
  if (!id) throw new Error("Runner entry was appended, but no session leaf id is available.");
  return id;
}

export type RunEntryInput = Omit<RunEntry, "version" | "timestamp">;

function runFromCreated(event: RunEntry): RunState {
  return {
    id: event.runId,
    runnerId: event.runnerId,
    status: "setup",
    intent: event.intent ?? "",
    summaries: [],
    ...(event.metadata ? { metadata: event.metadata } : {}),
    createdAt: event.timestamp,
    updatedAt: event.timestamp,
  };
}

function applyEntry(run: RunState, event: RunEntry, entryId: string): void {
  run.updatedAt = event.timestamp;
  if (event.kind === "plan-approved" && event.plan) {
    run.status = "active";
    run.plan = clonePlan(event.plan);
    return;
  }
  if (event.kind === "task-assigned" && event.unitId && event.taskId) {
    run.currentUnitId = event.unitId;
    run.currentTaskId = event.taskId;
    const unit = run.plan?.units.find((item) => item.id === event.unitId);
    if (unit && !unit.startEntryId) unit.startEntryId = entryId;
    return;
  }
  if (event.kind === "task-evidence" && event.taskId && event.evidence) {
    const task = run.plan?.units
      .flatMap((unit) => unit.tasks)
      .find((item) => item.id === event.taskId);
    if (task) task.evidence = event.evidence;
    if (run.currentTaskId === event.taskId) run.currentTaskId = undefined;
    return;
  }
  if (event.kind === "unit-rolled-up" && event.unitId) {
    const summary = summaryFromEntry(event);
    run.summaries.push(summary);
    const unit = run.plan?.units.find((item) => item.id === event.unitId);
    if (unit) unit.summaryEntryId = event.summaryEntryId ?? `rolled-up:${event.unitId}`;
    if (run.currentUnitId === event.unitId) run.currentUnitId = undefined;
    run.currentTaskId = undefined;
    return;
  }
  if (event.kind === "paused") {
    run.status = "paused";
    run.blockedReason = event.reason ?? "blocked";
    run.blockedDetail = event.detail;
    return;
  }
  if (event.kind === "resumed") {
    run.status = "active";
    run.blockedReason = undefined;
    run.blockedDetail = undefined;
    return;
  }
  if (event.kind === "completed") {
    run.status = "complete";
    run.completedAt = event.timestamp;
    run.blockedReason = undefined;
    run.blockedDetail = undefined;
  }
}

function summaryFromEntry(event: RunEntry): UnitSummary {
  return {
    unitId: event.unitId!,
    createdAt: event.timestamp,
    ...(event.summaryEntryId ? { summaryEntryId: event.summaryEntryId } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
  };
}

function parseRunEntry(entry: SessionEntry): RunEntry | null {
  if (entry.type !== "custom" || entry.customType !== RUNNER_ENTRY_TYPE) return null;
  const data = entry.data;
  if (!isRecord(data) || data.version !== 1 || typeof data.runnerId !== "string") return null;
  if (!isRunEntryKind(data.kind)) return null;
  return {
    version: 1,
    runnerId: data.runnerId,
    runId: typeof data.runId === "string" ? data.runId : "",
    kind: data.kind,
    timestamp:
      typeof data.timestamp === "number"
        ? data.timestamp
        : (timestampSeconds(entry) ?? nowSeconds()),
    ...(typeof data.intent === "string" ? { intent: data.intent } : {}),
    ...(isRecord(data.metadata) ? { metadata: data.metadata } : {}),
    ...(isPlan(data.plan) ? { plan: clonePlan(data.plan) } : {}),
    ...(typeof data.unitId === "string" ? { unitId: data.unitId } : {}),
    ...(typeof data.taskId === "string" ? { taskId: data.taskId } : {}),
    ...(typeof data.evidence === "string" ? { evidence: data.evidence } : {}),
    ...(typeof data.summaryEntryId === "string" ? { summaryEntryId: data.summaryEntryId } : {}),
    ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
    ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
    ...(typeof data.detail === "string" ? { detail: data.detail } : {}),
  };
}

function isRunEntryKind(value: unknown): value is RunEntryKind {
  return (
    typeof value === "string" &&
    [
      "created",
      "plan-approved",
      "task-assigned",
      "task-evidence",
      "unit-rolled-up",
      "paused",
      "resumed",
      "completed",
      "cleared",
    ].includes(value)
  );
}

function isPlan(value: unknown): value is WorkPlan {
  return isRecord(value) && typeof value.contract === "string" && Array.isArray(value.units);
}

function clonePlan(plan: WorkPlan): WorkPlan {
  return JSON.parse(JSON.stringify(plan)) as WorkPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function timestampSeconds(entry: SessionEntry): number | null {
  const value = (entry as { timestamp?: unknown }).timestamp;
  if (typeof value === "number" && Number.isFinite(value))
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
