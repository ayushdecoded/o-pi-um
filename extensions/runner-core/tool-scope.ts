import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { RunnerDefinition } from "./types.ts";

const runnerTools = new Set<string>();
const activeRunnerBySession = new Map<string, string | undefined>();

export function rememberRunnerTool(definition: RunnerDefinition): void {
  runnerTools.add(definition.tool.name);
}

export function activateRunnerTool(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
): void {
  setRunnerToolScope(
    pi,
    ctx,
    definition.tool.name,
    `${definition.label} active: model tool scope set to ${definition.tool.name}.`,
  );
}

export function clearRunnerTool(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  definition: RunnerDefinition,
): void {
  const key = sessionKey(ctx);
  const active = activeRunnerBySession.get(key);
  if (active && active !== definition.tool.name) return;
  setRunnerToolScope(
    pi,
    ctx,
    undefined,
    `${definition.label} inactive: runner model tools disabled.`,
  );
}

function setRunnerToolScope(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  activeRunnerTool: string | undefined,
  notice: string,
): void {
  const getActiveTools = (pi as Partial<Pick<ExtensionAPI, "getActiveTools">>).getActiveTools;
  const setActiveTools = (pi as Partial<Pick<ExtensionAPI, "setActiveTools">>).setActiveTools;
  if (!getActiveTools || !setActiveTools) return;

  const key = sessionKey(ctx);
  const currentTools = getActiveTools.call(pi);
  const next = [
    ...currentTools.filter((tool) => !runnerTools.has(tool)),
    ...(activeRunnerTool ? [activeRunnerTool] : []),
  ];
  const unique = Array.from(new Set(next));
  const changed =
    activeRunnerBySession.get(key) !== activeRunnerTool || !sameTools(currentTools, unique);
  setActiveTools.call(pi, unique);
  activeRunnerBySession.set(key, activeRunnerTool);
  if (changed) ctx.ui?.notify?.(notice, "info");
}

function sameTools(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sessionKey(ctx: ExtensionContext): string {
  const manager = ctx.sessionManager as {
    getSessionFile?: () => string | undefined;
    getSessionId?: () => string;
  };
  return manager.getSessionFile?.() ?? manager.getSessionId?.() ?? "default";
}
