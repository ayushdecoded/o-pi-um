import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { scheduleRunnerController, resetRunnerContext } from "./controller.ts";
import { registerRunnerCommand } from "./command.ts";
import { rememberRunnerDefinition } from "./ownership.ts";
import { registerRunnerTool } from "./tool.ts";
import { clearRunnerTool, rememberRunnerTool } from "./tool-scope.ts";
import type { RunnerDefinition } from "./types.ts";

export type RegisterRunnerOptions = {
  /** Defaults to true. */
  command?: boolean;
  /** Defaults to true. */
  tool?: boolean;
  /** Defaults to true. */
  scheduler?: boolean;
};

// Public entry point for feature extensions. Defaults wire command, model tool,
// and post-turn continuation; options let future features own any surface while
// still reusing the same durable state/controller core.
export function registerRunner(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  options: RegisterRunnerOptions = {},
): void {
  rememberRunnerDefinition(definition);
  if (options.command !== false) registerRunnerCommand(pi, definition);
  rememberRunnerTool(definition);
  if (options.tool !== false) registerRunnerTool(pi, definition);
  if (options.scheduler !== false) registerRunnerScheduler(pi, definition);
}

export function registerRunnerScheduler(pi: ExtensionAPI, definition: RunnerDefinition): void {
  rememberRunnerDefinition(definition);
  pi.on("agent_end", async (_event, ctx) => {
    scheduleRunnerController(pi, definition, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearRunnerTool(pi, ctx, definition);
    resetRunnerContext(definition, ctx);
  });
}
