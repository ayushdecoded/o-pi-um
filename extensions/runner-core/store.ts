import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  isPlanComplete,
  isTaskComplete,
  isUnitWorkComplete,
  nextReadyTask,
  validatePlan,
} from "./graph.ts";
import type {
  ReadFeatureEventsOptions,
  RunnerCoreEvent,
  RunnerCoreEventEntry,
  RunnerFeatureEventEntry,
  RunnerFeatureEventRecord,
  RunnerStoredEntry,
  RunState,
  TaskReport,
  UnitRollupTask,
  UnitSummary,
  WorkPlan,
  WorkTask,
  WorkUnit,
} from "./types.ts";

export const RUNNER_ENTRY_TYPE = "runner-core-entry";

// Materialize the active branch-local run from compact custom entries. Pi stores
// the entries in the session file; this layer only records runner-specific facts.
export function readRun(ctx: ExtensionContext, runnerId: string): RunState | null {
  let run: RunState | null = null;
  let pendingMalformedEntry: string | null = null;
  for (const entry of ctx.sessionManager.getBranch()) {
    const stored = parseRunnerEntry(entry);
    if (!stored && isMalformedRunnerEntry(entry, runnerId)) {
      if (run) markMalformedEntry(run, entry.id);
      else pendingMalformedEntry = entry.id;
      continue;
    }
    if (stored?.scope === "core" && stored.runnerId === runnerId) {
      if (stored.event.type === "run.created") {
        if (run?.blockedReason === "invalid_event") continue;
        run = runFromCreated(stored, stored.event);
        if (pendingMalformedEntry) markMalformedEntry(run, pendingMalformedEntry);
      } else if (stored.event.type === "run.cleared") {
        if (run?.id === stored.runId) run = null;
      } else if (!run) {
        pendingMalformedEntry = entry.id;
      } else if (run.id === stored.runId) applyCoreEvent(run, stored, entry.id);
      continue;
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
  const event = entry.event;
  const issue = validateCoreEvent(run, event);
  if (issue) return markInvalidEvent(run, entry, issue);
  run.updatedAt = entry.timestamp;

  if (event.type === "plan.approved") {
    run.status = "active";
    run.plan = cleanPlan(event.plan);
    return;
  }
  if (event.type === "task.assigned") {
    run.currentUnitId = event.unitId;
    run.currentTaskId = event.taskId;
    run.currentTaskPacketEntryId = undefined;
    const unit = findUnit(run, event.unitId);
    if (unit && !unit.startEntryId) unit.startEntryId = entryId;
    return;
  }
  if (event.type === "task.packet_sent") {
    run.currentTaskPacketEntryId = entryId;
    return;
  }
  if (event.type === "task.reported") {
    const task = findTask(run, event.taskId);
    appendTaskReport(task, event.result, event.evidence, entry.timestamp);
    if (event.result === "complete" && task) task.evidence = event.evidence;
    else if (event.result === "failed") {
      run.status = "paused";
      run.blockedReason = "task_failed";
      run.blockedDetail = event.evidence;
    }
    if (run.currentTaskId === event.taskId) run.currentTaskId = undefined;
    run.currentTaskPacketEntryId = undefined;
    return;
  }
  if (event.type === "unit.rolled_up") {
    applyRolledUpTaskFacts(run, event.unitId, event.tasks, entry.timestamp);
    const summary = summaryFromEntry(entry);
    run.summaries.push(summary);
    const unit = findUnit(run, event.unitId);
    if (unit) unit.summaryEntryId = event.summaryEntryId ?? `rolled-up:${event.unitId}`;
    if (run.currentUnitId === event.unitId) run.currentUnitId = undefined;
    run.currentTaskId = undefined;
    run.currentTaskPacketEntryId = undefined;
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

function validateCoreEvent(run: RunState, event: RunnerCoreEvent): string | null {
  if (run.blockedReason === "invalid_event" && event.type !== "run.cleared")
    return "run has invalid event history";
  if (run.status === "complete" && event.type !== "run.cleared") return "completed run is terminal";
  if (event.type === "plan.approved") {
    if (run.status !== "setup") return "plan approval is only valid during setup";
    const validation = validatePlan(event.plan, { enforceSafeIds: false });
    return validation.ok ? null : validation.message;
  }
  if (event.type === "task.assigned") {
    if (run.status !== "active" || !run.plan) return "task assignment needs an active plan";
    if (run.currentTaskId) return "another task is already assigned";
    const ready = nextReadyTask(run);
    return ready?.unit.id === event.unitId && ready.task.id === event.taskId
      ? null
      : `task ${event.taskId} is not ready`;
  }
  if (event.type === "task.packet_sent") {
    if (run.status !== "active" || !run.plan) return "task packet needs an active plan";
    if (event.taskId !== run.currentTaskId || event.unitId !== run.currentUnitId)
      return `task packet ${event.taskId} is not assigned`;
    return null;
  }
  if (event.type === "task.reported") {
    if (run.status !== "active" || !run.plan) return "task report needs an active plan";
    if (event.taskId !== run.currentTaskId) return `task ${event.taskId} is not assigned`;
    if (!event.evidence.trim()) return "task report needs evidence";
    const task = findTask(run, event.taskId);
    if (!task) return `unknown task ${event.taskId}`;
    if (event.result === "complete" && isTaskComplete(task))
      return `task ${event.taskId} is already complete`;
    return null;
  }
  if (event.type === "unit.rolled_up") {
    if (run.status !== "active" || !run.plan) return "unit rollup needs an active plan";
    if (run.currentUnitId !== event.unitId) return `unit ${event.unitId} is not current`;
    const unit = findUnit(run, event.unitId);
    if (!unit) return `unknown unit ${event.unitId}`;
    if (unit.summaryEntryId) return `unit ${event.unitId} is already rolled up`;
    const taskIssue = validateRollupTasks(unit, event.tasks);
    if (taskIssue) return taskIssue;
    if (!event.tasks) return null;
    const unitWithFacts = clone(unit);
    applyRolledUpFactsToUnit(unitWithFacts, event.tasks, nowSeconds());
    return isUnitWorkComplete(unitWithFacts) ? null : `unit ${event.unitId} is not complete`;
  }
  if (event.type === "run.paused")
    return run.status === "active" || run.status === "setup" ? null : "run is not pausable";
  if (event.type === "run.resumed")
    return run.status === "paused" && Boolean(run.plan) ? null : "run is not resumable";
  if (event.type === "run.completed") return isPlanComplete(run) ? null : "plan is not complete";
  return null;
}

function markInvalidEvent(run: RunState, entry: RunnerCoreEventEntry, issue: string): void {
  if (run.status === "complete") return;
  run.status = "paused";
  run.blockedReason = "invalid_event";
  run.blockedDetail = `${entry.event.type}: ${issue}`;
  run.updatedAt = entry.timestamp;
}

function markMalformedEntry(run: RunState, entryId: string): void {
  if (run.status === "complete") return;
  run.status = "paused";
  run.blockedReason = "invalid_event";
  run.blockedDetail = `Malformed runner entry ${entryId}.`;
  run.updatedAt = nowSeconds();
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

function isMalformedRunnerEntry(entry: SessionEntry, runnerId: string): boolean {
  if (entry.type !== "custom" || entry.customType !== RUNNER_ENTRY_TYPE) return false;
  const data = entry.data;
  if (!isRecord(data)) return true;
  return typeof data.runnerId !== "string" || data.runnerId === runnerId;
}

function parseRunnerEntry(entry: SessionEntry): RunnerStoredEntry | null {
  if (entry.type !== "custom" || entry.customType !== RUNNER_ENTRY_TYPE) return null;
  const data = entry.data;
  if (!isRecord(data) || typeof data.runnerId !== "string" || typeof data.runId !== "string")
    return null;
  const timestamp =
    typeof data.timestamp === "number" ? data.timestamp : (timestampSeconds(entry) ?? nowSeconds());

  if (data.version === 1 && data.scope === "core") {
    return {
      version: 1,
      scope: "core",
      runnerId: data.runnerId,
      runId: data.runId,
      timestamp,
      event: isCoreEvent(data.event)
        ? clone(data.event)
        : { type: "run.paused", reason: "invalid_event", detail: "Malformed runner core event." },
    };
  }
  if (
    data.version === 1 &&
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
  if (kind === "plan-approved" && isPlan(data.plan))
    return { type: "plan.approved", plan: clonePlan(data.plan) };
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
  if (value.type === "run.created") {
    return (
      typeof value.intent === "string" && (value.metadata === undefined || isRecord(value.metadata))
    );
  }
  if (value.type === "plan.approved") return isPlan(value.plan);
  if (value.type === "task.assigned")
    return typeof value.unitId === "string" && typeof value.taskId === "string";
  if (value.type === "task.packet_sent")
    return typeof value.unitId === "string" && typeof value.taskId === "string";
  if (value.type === "task.reported") {
    return (
      typeof value.taskId === "string" &&
      (value.result === "complete" || value.result === "failed") &&
      typeof value.evidence === "string"
    );
  }
  if (value.type === "unit.rolled_up") {
    return (
      typeof value.unitId === "string" &&
      (value.tasks === undefined ||
        (Array.isArray(value.tasks) && value.tasks.every(isRollupTask))) &&
      (value.summaryEntryId === undefined || typeof value.summaryEntryId === "string") &&
      (value.summary === undefined || typeof value.summary === "string")
    );
  }
  if (value.type === "run.paused") {
    return (
      typeof value.reason === "string" &&
      (value.detail === undefined || typeof value.detail === "string")
    );
  }
  return ["run.resumed", "run.completed", "run.cleared"].includes(value.type);
}

function validateRollupTasks(unit: WorkUnit, tasks: UnitRollupTask[] | undefined): string | null {
  if (!tasks) return null;
  const expected = new Set(unit.tasks.map((task) => task.id));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!expected.has(task.id)) return `rollup includes unknown task ${task.id}`;
    if (seen.has(task.id)) return `rollup includes duplicate task ${task.id}`;
    seen.add(task.id);
    if (!taskHasCompletionFact(task)) return `rollup task ${task.id} needs completion evidence`;
  }
  for (const taskId of expected) if (!seen.has(taskId)) return `rollup is missing task ${taskId}`;
  return null;
}

function taskHasCompletionFact(task: UnitRollupTask): boolean {
  return Boolean(
    task.evidence?.trim() ||
    task.reports?.some((report) => report.result === "complete" && report.evidence.trim()),
  );
}

function isRollupTask(value: unknown): value is UnitRollupTask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (!("evidence" in value) || typeof value.evidence === "string") &&
    (!("reports" in value) || (Array.isArray(value.reports) && value.reports.every(isTaskReport)))
  );
}

function isTaskReport(value: unknown): value is TaskReport {
  return (
    isRecord(value) &&
    (value.result === "complete" || value.result === "failed") &&
    typeof value.evidence === "string" &&
    typeof value.createdAt === "number"
  );
}

function applyRolledUpTaskFacts(
  run: RunState,
  unitId: string,
  tasks: UnitRollupTask[] | undefined,
  timestamp: number,
): void {
  const unit = findUnit(run, unitId);
  if (!unit) return;
  applyRolledUpFactsToUnit(unit, tasks, timestamp);
}

function applyRolledUpFactsToUnit(
  unit: WorkUnit,
  tasks: UnitRollupTask[] | undefined,
  timestamp: number,
): void {
  for (const task of tasks ?? []) {
    const target = unit.tasks.find((item) => item.id === task.id);
    if (!target) continue;
    target.reports = clone(task.reports ?? target.reports ?? []);
    if (task.evidence) target.evidence = task.evidence;
    else if (target.reports?.some((report) => report.result === "complete")) {
      target.evidence = [...target.reports]
        .reverse()
        .find((report) => report.result === "complete")?.evidence;
    }
    if (
      target.evidence &&
      !target.reports?.some(
        (report) => report.result === "complete" && report.evidence === target.evidence,
      )
    ) {
      appendTaskReport(target, "complete", target.evidence, timestamp);
    }
  }
}

function appendTaskReport(
  task: WorkTask | undefined,
  result: "complete" | "failed",
  evidence: string,
  timestamp: number,
): void {
  if (!task) return;
  task.reports = [...(task.reports ?? []), { result, evidence, createdAt: timestamp }];
}

function findUnit(run: RunState, id: string): WorkUnit | undefined {
  return run.plan?.units.find((unit) => unit.id === id);
}

function findTask(run: RunState, id: string): WorkTask | undefined {
  return run.plan?.units.flatMap((unit) => unit.tasks).find((task) => task.id === id);
}

function isPlan(value: unknown): value is WorkPlan {
  return (
    isRecord(value) &&
    typeof value.contract === "string" &&
    Array.isArray(value.units) &&
    value.units.every(isUnit)
  );
}

function isUnit(value: unknown): value is WorkUnit {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.objective === "string" &&
    Array.isArray(value.dependsOn) &&
    value.dependsOn.every((dep) => typeof dep === "string") &&
    Array.isArray(value.tasks) &&
    value.tasks.every(isTask)
  );
}

function isTask(value: unknown): value is WorkTask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.objective === "string" &&
    typeof value.verification === "string" &&
    Array.isArray(value.dependsOn) &&
    value.dependsOn.every((dep) => typeof dep === "string")
  );
}

function cleanPlan(plan: WorkPlan): WorkPlan {
  return {
    contract: plan.contract,
    units: plan.units.map((unit) => ({
      id: unit.id,
      name: unit.name,
      objective: unit.objective,
      dependsOn: [...unit.dependsOn],
      tasks: unit.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        objective: task.objective,
        verification: task.verification,
        dependsOn: [...task.dependsOn],
      })),
    })),
  };
}

function clonePlan(plan: WorkPlan): WorkPlan {
  return cleanPlan(plan);
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
