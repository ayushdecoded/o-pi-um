import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { readRun } from "./store.ts";
import type { RunnerDefinition, RunnerHookInput, RunState } from "./types.ts";

export function hookInput(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
  run: RunState,
): RunnerHookInput {
  return { pi, ctx, definition, run, readRun: () => readRun(ctx, definition.id) };
}
