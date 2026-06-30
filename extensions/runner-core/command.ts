import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { rememberRunnerContext, runRunnerController, turnInProgressReason } from "./controller.ts";
import { runStatusText } from "./format.ts";
import { hookInput } from "./hooks.ts";
import { appendRunEntry, readRun } from "./store.ts";
import { createRun, pauseRun, resumeRun } from "./transitions.ts";
import type {
  RunnerCommandAction,
  RunnerCommandApi,
  RunnerCommandInput,
  RunnerDefinition,
  RunState,
} from "./types.ts";

// Generic slash-command shell. Core provides normal runner actions; features can
// add or override actions without forking state, scheduling, or rollup behavior.
export function registerRunnerCommand(pi: ExtensionAPI, definition: RunnerDefinition): void {
  pi.registerCommand(definition.command.name, {
    description: definition.command.description ?? `Start or control ${definition.label}`,
    getArgumentCompletions: (prefix) => completeArgs(definition, prefix),
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
  const api = commandApi(pi, definition, ctx);
  const actions = commandActions(definition);
  const parsed = parseCommandText(text);
  const action = findAction(actions, parsed.action || "status");

  if (action) return void (await action.handler(parsed, api));
  ctx.ui.notify(
    `Unknown ${definition.label} command. Use /${definition.command.name} help.`,
    "warning",
  );
}

function defaultCommandActions(): RunnerCommandAction[] {
  return [
    {
      name: "start",
      usage: "start <intent>",
      description: "Start a new approved-plan run.",
      handler: startCommand,
    },
    {
      name: "status",
      description: "Show current run status.",
      handler: (_input, api) => notifyStatus(api.ctx, api.definition, api.readRun()),
    },
    {
      name: "help",
      description: "Show available commands.",
      handler: (_input, api) => api.ctx.ui.notify(helpText(api.definition), "info"),
    },
    {
      name: "pause",
      description: "Pause the active run.",
      handler: pauseCommand,
    },
    {
      name: "resume",
      description: "Resume a paused run or wake the current run.",
      handler: resumeCommand,
    },
    {
      name: "clear",
      aliases: ["cancel"],
      description: "Clear the current run.",
      handler: clearCommand,
    },
  ];
}

// Starting a run only creates setup state and sends the setup packet. No work is
// allowed until the model submits an approved plan through the tool.
async function startCommand(input: RunnerCommandInput, api: RunnerCommandApi): Promise<void> {
  const intent = input.args.trim();
  if (!intent)
    return void api.ctx.ui.notify(
      `Usage: /${api.definition.command.name} start <intent>`,
      "warning",
    );

  const existing = api.readRun();
  if (existing && existing.status !== "complete") {
    const ok =
      !api.ctx.hasUI ||
      (await api.ctx.ui.confirm(`Replace current ${api.definition.label}?`, existing.intent));
    if (!ok) return;
    api.appendEntry({ runId: existing.id, kind: "cleared" });
  }

  const run = createRun(api.definition, intent);
  api.appendEntry({ runId: run.id, kind: "created", intent: run.intent, metadata: run.metadata });
  await api.definition.hooks?.onRunCreated?.(hookInput(api.pi, api.ctx, api.definition, run));
  api.ctx.ui.notify(`${api.definition.label} setup started.`, "info");
  await api.runController();
}

async function pauseCommand(_input: RunnerCommandInput, api: RunnerCommandApi): Promise<void> {
  const run = api.readRun();
  if (!run || run.status !== "active") {
    api.ctx.ui.notify(`No active ${api.definition.label} run to pause.`, "warning");
    return;
  }
  const paused = pauseRun(run, "user", "Paused by user command.");
  api.appendEntry({
    runId: paused.id,
    kind: "paused",
    reason: paused.blockedReason,
    detail: paused.blockedDetail,
  });
  await api.definition.hooks?.onPaused?.(hookInput(api.pi, api.ctx, api.definition, paused));
}

function clearCommand(_input: RunnerCommandInput, api: RunnerCommandApi): void {
  const run = api.readRun();
  if (!run) return void api.ctx.ui.notify(`No ${api.definition.label} run to clear.`, "warning");
  api.appendEntry({ runId: run.id, kind: "cleared" });
  api.ctx.ui.notify(`${api.definition.label} cleared.`, "info");
}

// /<runner> resume is user-facing recovery: reactivate paused state if needed,
// then hand control to the same controller path used by automatic continuation.
async function resumeCommand(_input: RunnerCommandInput, api: RunnerCommandApi): Promise<void> {
  const run = api.readRun();
  if (!run) return void api.ctx.ui.notify(`No ${api.definition.label} run to resume.`, "warning");
  const inProgress = turnInProgressReason(api.ctx);
  if (inProgress)
    return void api.ctx.ui.notify(
      `${api.definition.label} resume skipped: ${inProgress}.`,
      "warning",
    );
  if (run.status === "paused") {
    const resumed = resumeRun(run);
    if (!resumed.ok) return void api.ctx.ui.notify(resumed.message, "warning");
    api.appendEntry({ runId: resumed.value.id, kind: "resumed" });
    await api.definition.hooks?.onResumed?.(
      hookInput(api.pi, api.ctx, api.definition, resumed.value),
    );
  }
  await api.runController();
}

function notifyStatus(
  ctx: ExtensionContext,
  definition: RunnerDefinition,
  run: RunState | null,
): void {
  ctx.ui.notify(runStatusText(run, definition.label), run ? "info" : "warning");
}

function completeArgs(definition: RunnerDefinition, prefix: string): AutocompleteItem[] | null {
  const actions = commandActions(definition);
  const firstSpace = prefix.indexOf(" ");
  if (firstSpace >= 0) {
    const parsed = parseCommandText(prefix);
    return findAction(actions, parsed.action)?.complete?.(parsed) ?? null;
  }

  const needle = prefix.trim().toLowerCase();
  const items = actions
    .filter((action) => action.name.startsWith(needle))
    .map((action) => ({ value: action.name, label: action.usage ?? action.name }));
  return items.length ? items : null;
}

function commandActions(definition: RunnerDefinition): RunnerCommandAction[] {
  const defaults =
    definition.command.includeDefaultActions === false ? [] : defaultCommandActions();
  const actions = [...defaults, ...(definition.command.actions ?? [])];
  const byName = new Map<string, RunnerCommandAction>();
  for (const action of actions) byName.set(action.name, action);
  return [...byName.values()];
}

function findAction(actions: RunnerCommandAction[], name: string): RunnerCommandAction | undefined {
  return actions.find((action) => action.name === name || action.aliases?.includes(name));
}

function commandApi(
  pi: ExtensionAPI,
  definition: RunnerDefinition,
  ctx: ExtensionCommandContext,
): RunnerCommandApi {
  return {
    pi,
    ctx,
    definition,
    readRun: () => readRun(ctx, definition.id),
    appendEntry: (entry) => appendRunEntry(pi, ctx, { ...entry, runnerId: definition.id }),
    runController: () => runRunnerController(pi, definition, ctx),
  };
}

function parseCommandText(text: string): RunnerCommandInput {
  const trimmed = text.trim();
  const [action = "", ...rest] = trimmed.split(/\s+/);
  return { raw: trimmed, action: action.toLowerCase(), args: rest.join(" ").trim() };
}

function helpText(definition: RunnerDefinition): string {
  const command = definition.command.name;
  return commandActions(definition)
    .map((action) => `/${command} ${action.usage ?? action.name}`)
    .join("\n");
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
