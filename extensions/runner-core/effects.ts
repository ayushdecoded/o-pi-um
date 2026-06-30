import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { appendFeatureEvent, readFeatureEvents, readRun } from "./store.ts";
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
    await effect({ ...clone(event), run: clone(run), entryId }, api);
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
    readRun: () => cloneOrNull(readRun(ctx, definition.id)),
    appendFeatureEvent: (type, payload, namespace = definition.id) =>
      appendFeatureEvent(pi, ctx, {
        runnerId: definition.id,
        runId,
        namespace,
        event: type,
        payload,
      }),
    readFeatureEvents: (options = {}) =>
      readFeatureEvents(ctx, definition.id, { runId, ...options }),
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

function cloneOrNull<T>(value: T | null): T | null {
  return value ? clone(value) : null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
