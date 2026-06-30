import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { scheduleRunnerController, resetRunnerContext } from "./controller.ts";
import { registerRunnerCommand } from "./command.ts";
import { registerRunnerTool } from "./tool.ts";
import type { RunnerDefinition } from "./types.ts";

/** One call wires command, tool, and lifecycle scheduling for a feature definition. */
// Public entry point for feature extensions. A runner definition becomes a command,
// a model tool, and post-turn auto-continuation hooks.
export function registerRunner(pi: ExtensionAPI, definition: RunnerDefinition): void {
  registerRunnerCommand(pi, definition);
  registerRunnerTool(pi, definition);

  pi.on("agent_end", async (_event, ctx) => {
    scheduleRunnerController(pi, definition, ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    resetRunnerContext(definition, ctx);
  });
}
