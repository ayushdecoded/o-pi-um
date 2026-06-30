import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { RunnerDefinition } from "./types.ts";

const runnerToolNames = new Set<string>();

export function rememberRunnerTool(definition: RunnerDefinition): void {
  runnerToolNames.add(definition.tool.name);
}

export function activateRunnerTool(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
): void {
  rememberRunnerTool(definition);
  if (!hasToolScope(pi)) return;
  const toolName = definition.tool.name;
  const active = pi.getActiveTools();
  const next = active.filter((name) => !runnerToolNames.has(name) || name === toolName);
  if (!next.includes(toolName)) next.push(toolName);
  setIfChanged(pi, active, next);
  if (!active.includes(toolName)) ctx.ui.notify(`${definition.label} tool enabled.`, "info");
}

export function clearRunnerTool(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
): void {
  rememberRunnerTool(definition);
  if (!hasToolScope(pi)) return;
  const toolName = definition.tool.name;
  const active = pi.getActiveTools();
  if (!active.includes(toolName)) return;
  setIfChanged(
    pi,
    active,
    active.filter((name) => name !== toolName),
  );
  ctx.ui.notify(`${definition.label} tool disabled.`, "info");
}

function hasToolScope(
  pi: ExtensionAPI,
): pi is ExtensionAPI & { getActiveTools(): string[]; setActiveTools(names: string[]): void } {
  return typeof pi.getActiveTools === "function" && typeof pi.setActiveTools === "function";
}

function setIfChanged(pi: ExtensionAPI, active: string[], next: string[]): void {
  if (active.length === next.length && active.every((name, index) => name === next[index])) return;
  pi.setActiveTools(next);
}
