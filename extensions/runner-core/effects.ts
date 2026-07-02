import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { appendFeatureEvent, readFeatureEvents, readRun } from "./store.ts";
import { toRunView } from "./view.ts";
import type {
  RunnerCoreEvent,
  RunnerDefinition,
  RunnerEffect,
  RunnerEffectApi,
  RunState,
} from "./types.ts";

export async function emitRunnerEvent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
  event: RunnerCoreEvent,
  run: RunState,
  entryId: string,
): Promise<void> {
  const api = effectApi(pi, ctx, definition, run.id);
  for (const effect of effectsFor(definition)) {
    try {
      await effect({ ...clone(event), run: toRunView(run)!, entryId }, api);
    } catch (error) {
      const message = errorMessage(error);
      appendFeatureEvent(pi, ctx, {
        runnerId: definition.id,
        runId: run.id,
        namespace: "runner-core",
        event: "effect_failed",
        payload: { coreEvent: event.type, entryId, message },
      });
      api.notify(`${definition.label} effect failed: ${message}`, "warning");
    }
  }
}

function effectApi(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
  runId: string,
): RunnerEffectApi {
  return {
    runnerId: definition.id,
    label: definition.label,
    readRun: () => toRunView(readRun(ctx, definition.id)),
    appendFeatureEvent: (type, payload, namespace = definition.id) =>
      appendFeatureEvent(pi, ctx, {
        runnerId: definition.id,
        runId,
        namespace,
        event: type,
        payload,
      }),
    readFeatureEvents: (options = {}) =>
      readFeatureEvents(ctx, definition.id, { runId, ...options }) as never,
    notify: ctx.ui?.notify?.bind(ctx.ui) ?? (() => undefined),
  };
}

function effectsFor(definition: RunnerDefinition): RunnerEffect[] {
  return definition.effects
    ? Array.isArray(definition.effects)
      ? definition.effects
      : [definition.effects]
    : [];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
