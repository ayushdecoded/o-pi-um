import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type TSchema } from "typebox";

import { planApprovedText, taskUpdateText } from "./format.ts";
import { hookInput } from "./hooks.ts";
import {
  normalizePlan,
  normalizeTaskUpdate,
  type PlanInput,
  type TaskUpdateInput,
} from "./plan.ts";
import { appendRunEntry, readRun } from "./store.ts";
import { approvePlan, pauseRun, updateTask } from "./transitions.ts";
import type { RunnerDefinition, RunnerToolAction, RunnerToolResult, RunState } from "./types.ts";

export type RunnerToolParams =
  | { action: "approve"; contract: string; plan: PlanInput }
  | ({ action: "evidence" } & TaskUpdateInput)
  | { action: "pause"; reason?: string };

// Registers the model-facing state tool for a runner. Core supplies approve,
// evidence, and pause; feature definitions can add/override actions without
// forking the base tool protocol.
export function registerRunnerTool(pi: ExtensionAPI, definition: RunnerDefinition): void {
  const toolName = definition.tool.name;
  const actions = toolActions(definition);
  pi.registerTool({
    name: toolName,
    label: definition.label,
    description: definition.tool.description ?? `${definition.label} work state`,
    promptSnippet: `${definition.label}: approve the plan; during work, submit evidence for the assigned task.`,
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
  return action.execute({ pi, ctx, definition, params, run: readRun(ctx, definition.id) });
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
      guideline: 'Work: call { action:"evidence", id, evidence } for the assigned task.',
      execute: updateTaskFromTool,
    },
    {
      action: "pause",
      parameters: PauseParamsSchema,
      guideline: 'Use { action:"pause", reason } if blocked.',
      execute: pauseFromTool,
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
  const clean = normalizePlan(String(params.contract ?? ""), params.plan as PlanInput);
  const approved = approvePlan(run, definition, clean);
  if (!approved.ok) fail(formatIssues(approved.message, approved.issues));
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: approved.value.id,
    kind: "plan-approved",
    plan: approved.value.plan,
  });
  await definition.hooks?.onPlanApproved?.(hookInput(pi, ctx, definition, approved.value));
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
  const update = normalizeTaskUpdate(params as TaskUpdateInput);
  if (!update?.evidence) fail("Provide task evidence for the assigned task.");
  const updated = updateTask(run, update);
  if (!updated.ok) fail(formatIssues(updated.message, updated.issues));
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: updated.value.id,
    kind: "task-evidence",
    taskId: update?.id,
    evidence: update?.evidence,
  });
  await definition.hooks?.onTaskEvidence?.({
    ...hookInput(pi, ctx, definition, updated.value),
    taskId: update.id,
    evidence: update.evidence,
  });
  return response(taskUpdateText(updated.value));
}

async function pauseFromTool({
  pi,
  definition,
  params,
  ctx,
  run,
}: Parameters<RunnerToolAction["execute"]>[0]): Promise<RunnerToolResult> {
  if (!run || run.status !== "active") fail(`No active ${definition.label} run to pause.`);
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const paused = pauseRun(run, "blocked", reason?.trim() || "Blocked by the current work.");
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: paused.id,
    kind: "paused",
    reason: paused.blockedReason,
    detail: paused.blockedDetail,
  });
  await definition.hooks?.onPaused?.(hookInput(pi, ctx, definition, paused));
  return response(`${definition.label} paused: ${paused.blockedDetail}`);
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
  const schemas = actions.map((action) => action.parameters as TSchema);
  return schemas.length === 1 ? schemas[0] : Type.Union(schemas);
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
    evidence: Type.String({ description: "Completion evidence." }),
  },
  strict,
);

const PauseParamsSchema = Type.Object(
  {
    action: StringEnum(["pause"] as const),
    reason: Type.Optional(Type.String({ description: "Pause/blocker reason." })),
  },
  strict,
);
