import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import type {
  ReadFeatureEventsOptions,
  RunnerCoreEvent,
  RunnerCoreEventEntry,
  RunnerFeatureEventEntry,
  RunnerFeatureEventRecord,
  RunnerStoredEntry,
  RunState,
  UnitSummary,
  WorkPlan,
} from "./types.ts";

export const RUNNER_ENTRY_TYPE = "runner-core-entry";

// Materialize the active branch-local run from compact custom entries. Pi stores
// the entries in the session file; this layer only records runner-specific facts.
export function readRun(ctx: ExtensionContext, runnerId: string): RunState | null {
  let run: RunState | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    const stored = parseRunnerEntry(entry);
    if (!stored || stored.scope !== "core" || stored.runnerId !== runnerId) continue;
    if (stored.event.type === "run.created") run = runFromCreated(stored, stored.event);
    else if (stored.event.type === "run.cleared") {
      if (run?.id === stored.runId) run = null;
    } else if (run?.id === stored.runId) {
      applyCoreEvent(run, stored, entry.id);
    }
  }
  return run;
}

export function appendCoreEvent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  entry: CoreEventInput,
): string {
  return appendRunnerEntry(pi, ctx, {
    version: 1,
    scope: "core",
    timestamp: nowSeconds(),
    ...entry,
  });
}

export function appendFeatureEvent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  entry: FeatureEventInput,
): string {
  return appendRunnerEntry(pi, ctx, {
    version: 1,
    scope: "feature",
    timestamp: nowSeconds(),
    ...entry,
  });
}

export function readFeatureEvents(
  ctx: ExtensionContext,
  runnerId: string,
  options: ReadFeatureEventsOptions = {},
): RunnerFeatureEventRecord[] {
  const events: RunnerFeatureEventRecord[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    const stored = parseRunnerEntry(entry);
    if (!stored || stored.scope !== "feature" || stored.runnerId !== runnerId) continue;
    if (options.runId && stored.runId !== options.runId) continue;
    if (options.namespace && stored.namespace !== options.namespace) continue;
    if (options.type && stored.event !== options.type) continue;
    events.push({
      id: entry.id,
      runnerId: stored.runnerId,
      runId: stored.runId,
      namespace: stored.namespace,
      type: stored.event,
      ...("payload" in stored ? { payload: stored.payload } : {}),
      timestamp: stored.timestamp,
    });
  }
  return events;
}

export type CoreEventInput = Omit<RunnerCoreEventEntry, "version" | "timestamp" | "scope">;
export type FeatureEventInput = Omit<RunnerFeatureEventEntry, "version" | "timestamp" | "scope">;

function appendRunnerEntry(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  data: RunnerStoredEntry,
): string {
  const maybeId = pi.appendEntry(RUNNER_ENTRY_TYPE, data) as unknown;
  const id = typeof maybeId === "string" ? maybeId : ctx.sessionManager.getLeafId();
  if (!id) throw new Error("Runner entry was appended, but no session leaf id is available.");
  return id;
}

function runFromCreated(
  entry: RunnerCoreEventEntry,
  event: Extract<RunnerCoreEvent, { type: "run.created" }>,
): RunState {
  return {
    id: entry.runId,
    runnerId: entry.runnerId,
    status: "setup",
    intent: event.intent,
    summaries: [],
    ...(event.metadata ? { metadata: event.metadata } : {}),
    createdAt: entry.timestamp,
    updatedAt: entry.timestamp,
  };
}

function applyCoreEvent(run: RunState, entry: RunnerCoreEventEntry, entryId: string): void {
  run.updatedAt = entry.timestamp;
  const event = entry.event;
  if (event.type === "plan.approved") {
    run.status = "active";
    run.plan = clonePlan(event.plan);
    return;
  }
  if (event.type === "task.assigned") {
    run.currentUnitId = event.unitId;
    run.currentTaskId = event.taskId;
    const unit = run.plan?.units.find((item) => item.id === event.unitId);
    if (unit && !unit.startEntryId) unit.startEntryId = entryId;
    return;
  }
  if (event.type === "task.reported") {
    if (event.result === "complete") {
      const task = run.plan?.units
        .flatMap((unit) => unit.tasks)
        .find((item) => item.id === event.taskId);
      if (task) task.evidence = event.evidence;
    } else {
      run.status = "paused";
      run.blockedReason = "task_failed";
      run.blockedDetail = event.evidence;
    }
    if (run.currentTaskId === event.taskId) run.currentTaskId = undefined;
    return;
  }
  if (event.type === "unit.rolled_up") {
    const summary = summaryFromEntry(entry);
    run.summaries.push(summary);
    const unit = run.plan?.units.find((item) => item.id === event.unitId);
    if (unit) unit.summaryEntryId = event.summaryEntryId ?? `rolled-up:${event.unitId}`;
    if (run.currentUnitId === event.unitId) run.currentUnitId = undefined;
    run.currentTaskId = undefined;
    return;
  }
  if (event.type === "run.paused") {
    run.status = "paused";
    run.blockedReason = event.reason;
    run.blockedDetail = event.detail;
    return;
  }
  if (event.type === "run.resumed") {
    run.status = "active";
    run.blockedReason = undefined;
    run.blockedDetail = undefined;
    return;
  }
  if (event.type === "run.completed") {
    run.status = "complete";
    run.completedAt = entry.timestamp;
    run.blockedReason = undefined;
    run.blockedDetail = undefined;
  }
}

function summaryFromEntry(entry: RunnerCoreEventEntry): UnitSummary {
  const event = entry.event;
  if (event.type !== "unit.rolled_up")
    throw new Error("Cannot build summary from non-rollup event.");
  return {
    unitId: event.unitId,
    createdAt: entry.timestamp,
    ...(event.summaryEntryId ? { summaryEntryId: event.summaryEntryId } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
  };
}

function parseRunnerEntry(entry: SessionEntry): RunnerStoredEntry | null {
  if (entry.type !== "custom" || entry.customType !== RUNNER_ENTRY_TYPE) return null;
  const data = entry.data;
  if (!isRecord(data) || data.version !== 1 || typeof data.runnerId !== "string") return null;
  if (typeof data.runId !== "string") return null;
  const timestamp =
    typeof data.timestamp === "number" ? data.timestamp : (timestampSeconds(entry) ?? nowSeconds());

  if (data.scope === "core" && isCoreEvent(data.event)) {
    return {
      version: 1,
      scope: "core",
      runnerId: data.runnerId,
      runId: data.runId,
      timestamp,
      event: clone(data.event),
    };
  }
  if (
    data.scope === "feature" &&
    typeof data.namespace === "string" &&
    typeof data.event === "string"
  ) {
    return {
      version: 1,
      scope: "feature",
      runnerId: data.runnerId,
      runId: data.runId,
      timestamp,
      namespace: data.namespace,
      event: data.event,
      ...("payload" in data ? { payload: data.payload } : {}),
    };
  }
  return parseLegacyCoreEntry(data, timestamp);
}

function parseLegacyCoreEntry(
  data: Record<string, unknown>,
  timestamp: number,
): RunnerCoreEventEntry | null {
  if (typeof data.kind !== "string") return null;
  const event = legacyCoreEvent(data.kind, data);
  return event
    ? {
        version: 1,
        scope: "core",
        runnerId: data.runnerId as string,
        runId: data.runId as string,
        timestamp,
        event,
      }
    : null;
}

function legacyCoreEvent(kind: string, data: Record<string, unknown>): RunnerCoreEvent | null {
  if (kind === "created") {
    return {
      type: "run.created",
      intent: typeof data.intent === "string" ? data.intent : "",
      ...(isRecord(data.metadata) ? { metadata: data.metadata } : {}),
    };
  }
  if (kind === "plan-approved" && isPlan(data.plan)) {
    return { type: "plan.approved", plan: clonePlan(data.plan) };
  }
  if (
    kind === "task-assigned" &&
    typeof data.unitId === "string" &&
    typeof data.taskId === "string"
  ) {
    return { type: "task.assigned", unitId: data.unitId, taskId: data.taskId };
  }
  if (
    kind === "task-evidence" &&
    typeof data.taskId === "string" &&
    typeof data.evidence === "string"
  ) {
    return {
      type: "task.reported",
      taskId: data.taskId,
      result: "complete",
      evidence: data.evidence,
    };
  }
  if (kind === "unit-rolled-up" && typeof data.unitId === "string") {
    return {
      type: "unit.rolled_up",
      unitId: data.unitId,
      ...(typeof data.summaryEntryId === "string" ? { summaryEntryId: data.summaryEntryId } : {}),
      ...(typeof data.summary === "string" ? { summary: data.summary } : {}),
    };
  }
  if (kind === "paused") {
    return {
      type: "run.paused",
      reason: typeof data.reason === "string" ? data.reason : "blocked",
      ...(typeof data.detail === "string" ? { detail: data.detail } : {}),
    };
  }
  if (kind === "resumed") return { type: "run.resumed" };
  if (kind === "completed") return { type: "run.completed" };
  if (kind === "cleared") return { type: "run.cleared" };
  return null;
}

function isCoreEvent(value: unknown): value is RunnerCoreEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "run.created") return typeof value.intent === "string";
  if (value.type === "plan.approved") return isPlan(value.plan);
  if (value.type === "task.assigned")
    return typeof value.unitId === "string" && typeof value.taskId === "string";
  if (value.type === "task.reported") {
    return (
      typeof value.taskId === "string" &&
      (value.result === "complete" || value.result === "failed") &&
      typeof value.evidence === "string"
    );
  }
  if (value.type === "unit.rolled_up") return typeof value.unitId === "string";
  if (value.type === "run.paused") return typeof value.reason === "string";
  return ["run.resumed", "run.completed", "run.cleared"].includes(value.type);
}

function isPlan(value: unknown): value is WorkPlan {
  return isRecord(value) && typeof value.contract === "string" && Array.isArray(value.units);
}

function clonePlan(plan: WorkPlan): WorkPlan {
  return clone(plan);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
