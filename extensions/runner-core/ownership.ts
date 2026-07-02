import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { readRun } from "./store.ts";
import type { RunnerDefinition, RunState } from "./types.ts";

const definitions = new Map<string, RunnerDefinition>();

export function rememberRunnerDefinition(definition: RunnerDefinition): void {
  definitions.set(definition.id, definition);
}

export function activeRunnerOwner(
  ctx: ExtensionContext,
  exceptRunnerId?: string,
): { definition: RunnerDefinition; run: RunState } | null {
  for (const definition of definitions.values()) {
    if (definition.id === exceptRunnerId) continue;
    const run = readRun(ctx, definition.id);
    if (run && run.status !== "complete") return { definition, run };
  }
  return null;
}
