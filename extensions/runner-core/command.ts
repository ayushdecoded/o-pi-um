import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { rememberRunnerContext, runRunnerController, turnInProgressReason } from "./controller.ts";
import { runStatusText } from "./format.ts";
import { appendRunEntry, readRun } from "./store.ts";
import { createRun, pauseRun, resumeRun } from "./transitions.ts";
import type { RunnerDefinition } from "./types.ts";

const DEFAULT_SUBCOMMANDS = ["start", "status", "help", "pause", "resume", "clear", "cancel"];

// Generic slash-command shell. Feature definitions supply only name/label; core
// provides start/status/pause/resume/clear behavior consistently.
export function registerRunnerCommand(pi: ExtensionAPI, definition: RunnerDefinition): void {
  pi.registerCommand(definition.command.name, {
    description: definition.command.description ?? `Start or control ${definition.label}`,
    getArgumentCompletions: (prefix) => completeArgs(prefix, definition),
    handler: async (args, ctx) =>
      withErrors(ctx, definition, () => handleCommand(pi, definition, ctx, args.trim())),
  });
}

async function handleCommand(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  text: string,
): Promise<void> {
  rememberRunnerContext(definition, ctx);
  const lower = text.toLowerCase();
  const run = readRun(ctx, definition.id);

  if (!text || lower === "status") return notifyStatus(ctx, definition, run);
  if (lower === "help") return void ctx.ui.notify(helpText(definition), "info");
  if (lower === "pause") return pauseCommand(pi, definition, ctx, run);
  if (lower === "resume") return resumeCommand(pi, definition, ctx, run);
  if (lower === "clear" || lower === "cancel") return clearCommand(pi, definition, ctx, run);
  if (lower.startsWith("start "))
    return startCommand(pi, definition, ctx, text.slice("start ".length).trim(), run);

  ctx.ui.notify(
    `Unknown ${definition.label} command. Use /${definition.command.name} help.`,
    "warning",
  );
}

// Starting a run only creates setup state and sends the setup packet. No work is
// allowed until the model submits an approved plan through the tool.
async function startCommand(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  intent: string,
  existing: ReturnType<typeof readRun>,
): Promise<void> {
  if (!intent)
    return void ctx.ui.notify(`Usage: /${definition.command.name} start <intent>`, "warning");
  if (existing && existing.status !== "complete") {
    const ok =
      !ctx.hasUI || (await ctx.ui.confirm(`Replace current ${definition.label}?`, existing.intent));
    if (!ok) return;
    appendRunEntry(pi, ctx, { runnerId: definition.id, runId: existing.id, kind: "cleared" });
  }

  const run = createRun(definition, intent);
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: run.id,
    kind: "created",
    intent: run.intent,
    metadata: run.metadata,
  });
  ctx.ui.notify(`${definition.label} setup started.`, "info");
  await runRunnerController(pi, definition, ctx);
}

function pauseCommand(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: ReturnType<typeof readRun>,
): void {
  if (!run || run.status !== "active") {
    ctx.ui.notify(`No active ${definition.label} run to pause.`, "warning");
    return;
  }
  const paused = pauseRun(run, "user", "Paused by user command.");
  appendRunEntry(pi, ctx, {
    runnerId: definition.id,
    runId: paused.id,
    kind: "paused",
    reason: paused.blockedReason,
    detail: paused.blockedDetail,
  });
}

function clearCommand(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: ReturnType<typeof readRun>,
): void {
  if (!run) return void ctx.ui.notify(`No ${definition.label} run to clear.`, "warning");
  appendRunEntry(pi, ctx, { runnerId: definition.id, runId: run.id, kind: "cleared" });
  ctx.ui.notify(`${definition.label} cleared.`, "info");
}

// /<runner> resume is user-facing recovery: reactivate paused state if needed,
// then hand control to the same controller path used by automatic continuation.
async function resumeCommand(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
  run: ReturnType<typeof readRun>,
): Promise<void> {
  if (!run) return void ctx.ui.notify(`No ${definition.label} run to resume.`, "warning");
  const inProgress = turnInProgressReason(ctx);
  if (inProgress)
    return void ctx.ui.notify(`${definition.label} resume skipped: ${inProgress}.`, "warning");
  if (run.status === "paused") {
    const resumed = resumeRun(run);
    if (!resumed.ok) return void ctx.ui.notify(resumed.message, "warning");
    appendRunEntry(pi, ctx, { runnerId: definition.id, runId: resumed.value.id, kind: "resumed" });
  }
  await runRunnerController(pi, definition, ctx);
}

function notifyStatus(
  ctx: ExtensionContext,
  definition: RunnerDefinition,
  run: ReturnType<typeof readRun>,
): void {
  ctx.ui.notify(runStatusText(run, definition.label), run ? "info" : "warning");
}

function completeArgs(prefix: string, definition: RunnerDefinition): AutocompleteItem[] | null {
  const actions = definition.command.subcommands ?? DEFAULT_SUBCOMMANDS;
  const needle = prefix.trim().toLowerCase();
  const items = actions
    .filter((action) => action.startsWith(needle))
    .map((action) => ({ value: action, label: action }));
  return items.length ? items : null;
}

function helpText(definition: RunnerDefinition): string {
  const command = definition.command.name;
  return [
    `/${command} start <intent>`,
    `/${command} status`,
    `/${command} pause`,
    `/${command} resume`,
    `/${command} clear`,
  ].join("\n");
}

async function withErrors(
  ctx: ExtensionContext,
  definition: RunnerDefinition,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    ctx.ui.notify(`${definition.label} command failed: ${errorMessage(error)}`, "error");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
