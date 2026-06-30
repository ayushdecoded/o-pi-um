import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import { planApprovedText, taskUpdateText } from "./format.ts";
import {
  normalizePlan,
  normalizeTaskUpdate,
  type PlanInput,
  type TaskUpdateInput,
} from "./plan.ts";
import { appendRunEntry, readRun } from "./store.ts";
import { approvePlan, pauseRun, updateTask } from "./transitions.ts";
import type { RunnerDefinition } from "./types.ts";

export type RunnerToolParams =
  | { action: "approve"; contract: string; plan: PlanInput }
  | ({ action: "evidence" } & TaskUpdateInput)
  | { action: "pause"; reason?: string };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, never>;
};

// Registers the model-facing state tool for a runner. The action discriminant keeps
// setup/evidence/pause modes separate and avoids ignored cross-mode fields.
export function registerRunnerTool(pi: ExtensionAPI, definition: RunnerDefinition): void {
  const toolName = definition.tool.name;
  pi.registerTool({
    name: toolName,
    label: definition.label,
    description: definition.tool.description ?? `${definition.label} work state`,
    promptSnippet: `${definition.label}: approve the plan; during work, submit evidence for the assigned task.`,
    promptGuidelines: [
      `Setup: after user approval, call ${toolName} with { action:"approve", contract, plan }.`,
      `Work: call ${toolName} with { action:"evidence", id, evidence } for the assigned task.`,
      `Use ${toolName} with { action:"pause", reason } if blocked.`,
    ],
    parameters: RunnerToolParamsSchema,
    executionMode: "sequential",
    async execute(_toolCallId, params: RunnerToolParams, _signal, _onUpdate, ctx) {
      return executeRunnerTool(pi, definition, params, ctx);
    },
  });
}

function executeRunnerTool(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  params: RunnerToolParams,
  ctx: ExtensionContext,
): ToolResult {
  if (params.action === "approve") return approvePlanFromTool(pi, definition, params, ctx);
  if (params.action === "evidence") return updateTaskFromTool(pi, definition, params, ctx);
  return pauseFromTool(pi, definition, params, ctx);
}

function approvePlanFromTool(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  params: Extract<RunnerToolParams, { action: "approve" }>,
  ctx: ExtensionContext,
): ToolResult {
  const run = readRun(ctx, definition.id);
  if (!run || run.status !== "setup") fail(`No ${definition.label} setup is active.`);
  const approved = approvePlan(run, definition, normalizePlan(params.contract, params.plan));
  if (!approved.ok) fail(formatIssues(approved.message, approved.issues));
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: approved.value.id,
    kind: "plan-approved",
    plan: approved.value.plan,
  });
  return response(planApprovedText(approved.value));
}

function updateTaskFromTool(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  params: Extract<RunnerToolParams, { action: "evidence" }>,
  ctx: ExtensionContext,
): ToolResult {
  const run = readRun(ctx, definition.id);
  if (!run || run.status !== "active") fail(`No active ${definition.label} run.`);
  const update = normalizeTaskUpdate(params);
  const updated = updateTask(run, update);
  if (!updated.ok) fail(formatIssues(updated.message, updated.issues));
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: updated.value.id,
    kind: "task-evidence",
    taskId: update?.id,
    evidence: update?.evidence,
  });
  return response(taskUpdateText(updated.value));
}

function pauseFromTool(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  params: Extract<RunnerToolParams, { action: "pause" }>,
  ctx: ExtensionContext,
): ToolResult {
  const run = readRun(ctx, definition.id);
  if (!run || run.status !== "active") fail(`No active ${definition.label} run to pause.`);
  const paused = pauseRun(run, "blocked", params.reason?.trim() || "Blocked by the current work.");
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: paused.id,
    kind: "paused",
    reason: paused.blockedReason,
    detail: paused.blockedDetail,
  });
  return response(`${definition.label} paused: ${paused.blockedDetail}`);
}

function response(text: string): ToolResult {
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

const RunnerToolParamsSchema = Type.Union([
  Type.Object(
    {
      action: StringEnum(["approve"] as const),
      contract: Type.String({ description: "Approved contract text." }),
      plan: PlanSchema,
    },
    strict,
  ),
  Type.Object(
    {
      action: StringEnum(["evidence"] as const),
      id: Type.String({ description: "Assigned task id." }),
      evidence: Type.String({ description: "Completion evidence." }),
    },
    strict,
  ),
  Type.Object(
    {
      action: StringEnum(["pause"] as const),
      reason: Type.Optional(Type.String({ description: "Pause/blocker reason." })),
    },
    strict,
  ),
]);
