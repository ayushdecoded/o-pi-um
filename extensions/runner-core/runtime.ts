import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { RUNNER_SETUP_MESSAGE_TYPE, RUNNER_WORK_MESSAGE_TYPE } from "./constants.ts";
import type { RunnerDefinition } from "./types.ts";

export type RunnerRuntime = {
  /** Last command context for this runner/session. Rollup needs command-only tree APIs. */
  ctx?: ExtensionCommandContext;
  /** Incremented on shutdown/reset so late async callbacks become no-ops. */
  generation: number;
  /** Prevents two controller loops from operating on the same run concurrently. */
  runningRunId?: string;
  /** Debounces post-turn auto scheduling. */
  scheduled: boolean;
  /** Marks this runtime unusable after session shutdown. */
  shutdown: boolean;
  /** Avoids repeating reload recovery notifications for the same run. */
  resumeNoticeRunId?: string;
};

export type RunnerToken = {
  key: string;
  generation: number;
  runId: string;
};

const runtimes = new Map<string, RunnerRuntime>();

export function rememberRunnerContext(
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
): void {
  const runtime = runtimeFor(definition, ctx);
  runtime.ctx = ctx;
  runtime.shutdown = false;
}

export function resetRunnerContext(definition: RunnerDefinition, ctx: ExtensionContext): void {
  const runtime = runtimeFor(definition, ctx);
  runtime.generation += 1;
  runtime.ctx = undefined;
  runtime.runningRunId = undefined;
  runtime.scheduled = false;
  runtime.shutdown = true;
}

export function runtimeFor(definition: RunnerDefinition, ctx: ExtensionContext): RunnerRuntime {
  const key = runtimeKey(definition, ctx);
  let runtime = runtimes.get(key);
  if (!runtime) {
    runtime = { generation: 0, scheduled: false, shutdown: false };
    runtimes.set(key, runtime);
  }
  return runtime;
}

export function runtimeKey(definition: RunnerDefinition, ctx: ExtensionContext): string {
  return `${definition.id}:${ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId()}`;
}

export function isCurrent(token: Pick<RunnerToken, "key" | "generation">): boolean {
  const runtime = runtimes.get(token.key);
  return Boolean(runtime && !runtime.shutdown && runtime.generation === token.generation);
}

// Never inject another packet when the leaf already has queued work, an
// unprocessed tool result, or unresolved tool calls.
export function turnInProgressReason(ctx: ExtensionContext): string | null {
  const leaf = ctx.sessionManager.getLeafEntry() as
    | { type?: unknown; customType?: unknown; message?: { role?: unknown; stopReason?: unknown } }
    | undefined;
  if (!leaf) return null;
  if (
    leaf.type === "custom_message" &&
    (leaf.customType === RUNNER_SETUP_MESSAGE_TYPE || leaf.customType === RUNNER_WORK_MESSAGE_TYPE)
  ) {
    return "a work packet is already queued at the session leaf";
  }
  if (leaf.type !== "message") return null;
  if (leaf.message?.role === "toolResult") return "the last tool result has not been processed";
  if (leaf.message?.role === "assistant" && leaf.message.stopReason === "toolUse") {
    return "the last assistant message is still waiting on tool results";
  }
  return null;
}
