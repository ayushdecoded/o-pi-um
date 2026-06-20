import * as fs from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAX_ACTIVE, MAX_DEPTH } from "./constants.ts";
import { resolveModelRoute } from "./models.ts";
import { renderPanel, startPanel } from "./panel.ts";
import { runPiInTmux } from "./pi-runner.ts";
import { acquireSlot, activeRuns, releaseSlot } from "./runtime.ts";
import type {
  FollowupParamsType,
  RunDetails,
  SubagentTimeout,
  ThinkingLevelType,
} from "./types.ts";
import {
  ensureSessionRoot,
  makeRunId,
  normalizeSessionFile,
  sessionFileForRun,
} from "./primitives/session.ts";

export async function runParallelSubagents(
  params: {
    tasks: Array<{
      task: string;
      model?: string;
      reasoning?: ThinkingLevelType;
      timeout?: SubagentTimeout;
    }>;
    model?: string;
    reasoning?: ThinkingLevelType;
    timeout?: SubagentTimeout;
  },
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<RunDetails[]> {
  const tasks = params.tasks.slice(0, MAX_ACTIVE);
  return Promise.all(
    tasks.map((task) => {
      const route = resolveModelRoute(
        ctx,
        task.model ?? params.model,
        task.reasoning ?? params.reasoning,
      );
      return runPiSubagent(
        { task: task.task, ...route, timeout: task.timeout ?? params.timeout },
        ctx,
        signal,
      );
    }),
  );
}

export async function runPiSubagent(
  params: {
    task: string;
    model?: string;
    reasoning?: ThinkingLevelType;
    timeout?: SubagentTimeout;
  },
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<RunDetails> {
  // New subagents get isolated Pi session files and can be followed up by path.
  const depth = currentDepth();
  if (depth >= MAX_DEPTH) return blockedRun(params.task, params.model);
  const startedAt = Date.now();
  const id = makeRunId("sub");
  const sessionFile = sessionFileForRun(id, startedAt);
  const timeoutMs = subagentTimeoutMs(params.timeout);
  if (typeof timeoutMs === "string")
    return failedRun(params.task, params.model, sessionFile, timeoutMs, startedAt);
  return withTrackedRun(
    { id, task: params.task, model: params.model, startedAt },
    ctx,
    async () => {
      ensureSessionRoot();
      return runPiInTmux({
        id,
        task: params.task,
        model: params.model,
        reasoning: params.reasoning,
        sessionFile,
        startedAt,
        cwd: ctx.cwd,
        depth,
        timeoutMs,
        freshSessionDir: true,
        signal,
      });
    },
  );
}

export async function messageSubagentSession(
  params: FollowupParamsType,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<RunDetails> {
  // Follow-ups reuse exactly the provided child session file; no transcript is copied into the parent.
  const route = resolveModelRoute(ctx, params.model, params.reasoning);
  const model = route.model;
  const reasoning = route.reasoning;
  const sessionFile = normalizeSessionFile(params.sessionFile);
  const startedAt = Date.now();
  if (!fs.existsSync(sessionFile))
    return failedRun(
      params.message,
      model,
      sessionFile,
      `Session file not found: ${sessionFile}`,
      startedAt,
    );
  const id = makeRunId("msg");
  const timeoutMs = subagentTimeoutMs(params.timeout);
  if (typeof timeoutMs === "string")
    return failedRun(params.message, model, sessionFile, timeoutMs, startedAt);
  return withTrackedRun({ id, task: params.message, model, startedAt }, ctx, async () => {
    return runPiInTmux({
      id,
      task: params.message,
      model,
      reasoning,
      sessionFile,
      startedAt,
      cwd: ctx.cwd,
      depth: currentDepth(),
      timeoutMs,
      freshSessionDir: false,
      signal,
    });
  });
}

async function withTrackedRun(
  input: { id: string; task: string; model?: string; startedAt: number },
  ctx: ExtensionContext,
  fn: () => Promise<RunDetails>,
): Promise<RunDetails> {
  // Scheduling/UI concerns stay outside the Pi runner primitive.
  await acquireSlot();
  activeRuns.set(input.id, { ...input, status: "running" });
  startPanel(ctx);
  try {
    return await fn();
  } finally {
    activeRuns.delete(input.id);
    releaseSlot();
    renderPanel(ctx);
  }
}

function currentDepth(): number {
  return Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
}

function subagentTimeoutMs(timeoutMinutes?: SubagentTimeout): number | false | string {
  if (timeoutMinutes !== undefined) {
    if (timeoutMinutes === -1) return false;
    if (Number.isFinite(timeoutMinutes) && timeoutMinutes > 0) return timeoutMinutes * 60_000;
    return "Invalid subagent timeout: use minutes > 0, or -1 for no timeout.";
  }
  const envMinutes = Number.parseFloat(process.env.PI_SUBAGENT_TIMEOUT_MINUTES ?? "");
  if (Number.isFinite(envMinutes)) {
    if (envMinutes === -1) return false;
    if (envMinutes > 0) return envMinutes * 60_000;
  }
  return 10 * 60_000;
}

function blockedRun(task: string, model?: string): RunDetails {
  const now = Date.now();
  return {
    id: `blocked-${now.toString(36)}`,
    task,
    model,
    status: "failed",
    error: `Max subagent nesting depth (${MAX_DEPTH}) reached.`,
    startedAt: now,
    completedAt: now,
  };
}

function failedRun(
  task: string,
  model: string | undefined,
  sessionFile: string,
  error: string,
  startedAt: number,
): RunDetails {
  return {
    id: makeRunId("msg"),
    task,
    model,
    status: "failed",
    error,
    sessionFile,
    startedAt,
    completedAt: Date.now(),
  };
}
