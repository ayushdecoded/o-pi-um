import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";

import { RUNNER_SETUP_MESSAGE_TYPE, RUNNER_WORK_MESSAGE_TYPE } from "./constants.ts";
import { emitRunnerEvent } from "./effects.ts";
import { planApprovedText, taskUpdateText } from "./format.ts";
import {
  normalizePlan,
  normalizeTaskUpdate,
  type PlanInput,
  type TaskUpdateInput,
} from "./plan.ts";
import { appendCoreEvent, appendFeatureEvent, readFeatureEvents, readRun } from "./store.ts";
import { activateRunnerTool, clearRunnerTool } from "./tool-scope.ts";
import { approvePlan, pauseRun, updateTask } from "./transitions.ts";
import type { RunnerDefinition, RunnerToolAction, RunnerToolResult } from "./types.ts";

export type RunnerToolParams =
  | { action: "approve"; contract: string; plan: PlanInput }
  | ({ action: "evidence"; result: "complete" | "failed" } & TaskUpdateInput);

// Registers the model-facing state tool for a runner. Core supplies approve and
// evidence. Evidence is explicit: the assigned task either completed or failed.
// Feature definitions can add/override actions without forking the base tool protocol.
export function registerRunnerTool(pi: ExtensionAPI, definition: RunnerDefinition): void {
  const toolName = definition.tool.name;
  const actions = toolActions(definition);
  pi.registerTool({
    name: toolName,
    label: definition.label,
    description: definition.tool.description ?? `${definition.label} work state`,
    promptSnippet:
      definition.tool.promptSnippet ??
      `${definition.label}: use this runner tool for ${actions.map((action) => action.action).join("/")}.`,
    promptGuidelines: promptGuidelines(toolName, actions),
    parameters: parametersFor(actions),
    executionMode: "sequential",
    async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx) {
      return executeRunnerTool(pi, definition, actions, params, ctx);
    },
  });
}

async function executeRunnerTool(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  actions: RunnerToolAction[],
  params: Record<string, unknown>,
  ctx: ExtensionContext,
): Promise<RunnerToolResult> {
  const actionName = typeof params.action === "string" ? params.action : "";
  const action = actions.find((item) => item.action === actionName);
  if (!action) fail(`Unknown ${definition.label} tool action: ${actionName || "<missing>"}.`);
  const run = readRun(ctx, definition.id);
  const packet = currentRunnerPacket(ctx, definition);
  // Custom actions are run-bound by default too; actions that intentionally work
  // without an active run must opt out with requireRunId:false.
  if (action.requireRunId !== false) {
    if (!run) fail(`No ${definition.label} run is active.`);
    assertPacketMatchesRun(packet, run, definition);
  }
  return action.execute({
    pi,
    ctx,
    definition,
    params,
    run,
    appendFeatureEvent: (type, payload, namespace = definition.id) => {
      if (!run) throw new Error(`No ${definition.label} run is active.`);
      return appendFeatureEvent(pi, ctx, {
        runnerId: definition.id,
        runId: run.id,
        namespace,
        event: type,
        payload,
      });
    },
    readFeatureEvents: (options = {}) => readFeatureEvents(ctx, definition.id, options),
  });
}

function defaultToolActions(): RunnerToolAction[] {
  return [
    {
      action: "approve",
      parameters: ApproveParamsSchema,
      guideline: 'Setup: after user approval, call { action:"approve", contract, plan }.',
      execute: approvePlanFromTool,
    },
    {
      action: "evidence",
      parameters: EvidenceParamsSchema,
      guideline:
        'Work: call { action:"evidence", id, result:"complete", evidence } when done, or { action:"evidence", id, result:"failed", evidence } when blocked/failed.',
      execute: updateTaskFromTool,
    },
  ];
}

async function approvePlanFromTool({
  pi,
  definition,
  params,
  ctx,
  run,
}: Parameters<RunnerToolAction["execute"]>[0]): Promise<RunnerToolResult> {
  if (!run || run.status !== "setup") fail(`No ${definition.label} setup is active.`);
  assertPacketMatchesRun(currentRunnerPacket(ctx, definition), run, definition, "setup");
  const clean = normalizePlan(String(params.contract ?? ""), params.plan as PlanInput);
  const approved = approvePlan(run, definition, clean);
  if (!approved.ok) fail(formatIssues(approved.message, approved.issues));
  const event = { type: "plan.approved", plan: approved.value.plan! } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: definition.id,
    runId: approved.value.id,
    event,
  });
  await emitRunnerEvent(pi, ctx, definition, event, approved.value, entryId);
  activateRunnerTool(pi, ctx, definition);
  return response(planApprovedText(approved.value));
}

async function updateTaskFromTool({
  pi,
  definition,
  params,
  ctx,
  run,
}: Parameters<RunnerToolAction["execute"]>[0]): Promise<RunnerToolResult> {
  if (!run || run.status !== "active") fail(`No active ${definition.label} run.`);
  const packet = currentRunnerPacket(ctx, definition);
  assertPacketMatchesRun(packet, run, definition, "work");
  const update = normalizeTaskUpdate(params as TaskUpdateInput);
  if (!update?.evidence) fail("Provide task evidence for the assigned task.");
  if (params.result === "failed") {
    if (!run.currentTaskId) fail("No task is currently assigned.");
    if (update.id !== run.currentTaskId)
      fail(`Task ${update.id} is not the current assigned task.`);
    assertPacketTaskMatches(packet, update.id, definition);
    const failed = pauseRun({ ...run, currentTaskId: undefined }, "task_failed", update.evidence);
    const event = {
      type: "task.reported",
      taskId: update.id,
      result: "failed",
      evidence: update.evidence,
    } as const;
    const entryId = appendCoreEvent(pi, ctx, {
      runnerId: definition.id,
      runId: failed.id,
      event,
    });
    await emitRunnerEvent(pi, ctx, definition, event, failed, entryId);
    clearRunnerTool(pi, ctx, definition);
    return response(`${definition.label} paused: task ${update.id} failed. ${update.evidence}`);
  }

  assertPacketTaskMatches(packet, update.id, definition);
  const updated = updateTask(run, update);
  if (!updated.ok) fail(formatIssues(updated.message, updated.issues));
  const event = {
    type: "task.reported",
    taskId: update.id,
    result: "complete",
    evidence: update.evidence,
  } as const;
  const entryId = appendCoreEvent(pi, ctx, {
    runnerId: definition.id,
    runId: updated.value.id,
    event,
  });
  await emitRunnerEvent(pi, ctx, definition, event, updated.value, entryId);
  return response(taskUpdateText(updated.value));
}

function toolActions(definition: RunnerDefinition): RunnerToolAction[] {
  const defaults = definition.tool.includeDefaultActions === false ? [] : defaultToolActions();
  const actions = [...defaults, ...(definition.tool.actions ?? [])];
  const byName = new Map<string, RunnerToolAction>();
  for (const action of actions) byName.set(action.action, action);
  return [...byName.values()];
}

function promptGuidelines(toolName: string, actions: RunnerToolAction[]): string[] {
  return actions
    .map((action) => action.guideline?.replace("call {", `call ${toolName} with {`))
    .filter((item): item is string => Boolean(item));
}

function parametersFor(actions: RunnerToolAction[]): TSchema {
  if (actions.length === 0) throw new Error("Runner tool has no actions.");
  const schemas = actions.map((action) => schemaForAction(action));
  return schemas.length === 1 ? schemas[0] : Type.Union(schemas);
}

function schemaForAction(action: RunnerToolAction): TSchema {
  const schema = action.parameters as TSchema & {
    type?: unknown;
    properties?: Record<string, TSchema>;
    required?: string[];
    additionalProperties?: boolean;
  };
  return schema;
}

type RunnerPacket = { phase?: string; runId?: string; taskId?: string };

function currentRunnerPacket(
  ctx: ExtensionContext,
  definition: RunnerDefinition,
): RunnerPacket | null {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index] as {
      type?: unknown;
      customType?: unknown;
      details?: Record<string, unknown>;
    };
    if (
      entry.type !== "custom_message" ||
      (entry.customType !== RUNNER_SETUP_MESSAGE_TYPE &&
        entry.customType !== RUNNER_WORK_MESSAGE_TYPE)
    )
      continue;
    const details = entry.details;
    if (details?.runnerId !== definition.id) continue;
    return {
      phase: typeof details.phase === "string" ? details.phase : undefined,
      runId: typeof details.runId === "string" ? details.runId : undefined,
      taskId: typeof details.taskId === "string" ? details.taskId : undefined,
    };
  }
  return null;
}

function assertPacketMatchesRun(
  packet: RunnerPacket | null,
  run: { id: string },
  definition: RunnerDefinition,
  phase?: "setup" | "work",
): void {
  if (!packet?.runId) fail(`${definition.label} tool call is not attached to a runner packet.`);
  if (packet.runId !== run.id) fail(`Stale ${definition.label} tool call for run ${packet.runId}.`);
  if (phase && packet.phase !== phase)
    fail(`${definition.label} ${phase} action came from a ${packet.phase ?? "unknown"} packet.`);
}

function assertPacketTaskMatches(
  packet: RunnerPacket | null,
  taskId: string,
  definition: RunnerDefinition,
): void {
  if (packet?.taskId !== taskId)
    fail(`Stale ${definition.label} tool call for task ${String(packet?.taskId ?? "<missing>")}.`);
}

function response(text: string): RunnerToolResult {
  return { content: [{ type: "text", text }], details: {} };
}

function fail(message: string): never {
  throw new Error(message);
}

function formatIssues(message: string, issues: string[] | undefined): string {
  return issues?.length ? Array.from(new Set([message, ...issues])).join("\n") : message;
}

const strict = { additionalProperties: false } as const;

const PlanSchema = Type.Object(
  {
    units: Type.Array(
      Type.Object(
        {
          id: Type.String({ description: "Stable unit id, e.g. s1." }),
          name: Type.String({ description: "Unit name." }),
          objective: Type.String({ description: "Unit objective." }),
          dependsOn: Type.Optional(
            Type.Array(Type.String({ description: "Earlier unit ids this unit depends on." })),
          ),
          tasks: Type.Array(
            Type.Object(
              {
                id: Type.String({ description: "Stable task id, e.g. t1." }),
                name: Type.String({ description: "Task name." }),
                objective: Type.String({ description: "Task objective." }),
                verification: Type.String({ description: "Done when..." }),
                dependsOn: Type.Optional(
                  Type.Array(Type.String({ description: "Earlier same-unit task ids." })),
                ),
              },
              strict,
            ),
          ),
        },
        strict,
      ),
    ),
  },
  strict,
);

const ApproveParamsSchema = Type.Object(
  {
    action: StringEnum(["approve"] as const),
    contract: Type.String({ description: "Approved contract text." }),
    plan: PlanSchema,
  },
  strict,
);

const EvidenceParamsSchema = Type.Object(
  {
    action: StringEnum(["evidence"] as const),
    id: Type.String({ description: "Assigned task id." }),
    result: StringEnum(["complete", "failed"] as const),
    evidence: Type.String({ description: "What was completed, or why the task failed/blocked." }),
  },
  strict,
);
