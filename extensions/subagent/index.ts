import * as fs from "node:fs";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SESSION_ROOT } from "./constants.ts";
import { resolveModelRoute, validateModelsMd } from "./models.ts";
import { formatSubagentPrompt } from "./prompt.ts";
import { resetRuntime } from "./runtime.ts";
import { messageSubagentSession, runParallelSubagents, runPiSubagent } from "./runner.ts";
import { SubagentParams } from "./schema.ts";
import { formatParallelRuns, formatRun, renderRunsForUser, shortTask } from "./text.ts";
import type { SubagentParamsType, ToolDetails } from "./types.ts";
import { stopPanel } from "./panel.ts";
import { registerModelCommands } from "./model-commands.ts";

export default function registerSubagentExtension(pi: ExtensionAPI): void {
  // Child sessions are real Pi sessions; keep their JSONL under one predictable directory.
  fs.mkdirSync(SESSION_ROOT, { recursive: true });

  // Teach the parent model when to delegate, without exposing spawn/process details.
  pi.on("before_agent_start", (event, ctx) => ({
    systemPrompt: `${event.systemPrompt}\n\n${formatSubagentPrompt(ctx)}`,
  }));

  pi.registerTool(createSubagentTool(pi));
  registerModelCommands(pi);

  // Model routing is system-owned here: warn early, but don't block unrelated goal work.
  pi.on("session_start", (_event, ctx) => {
    const check = validateModelsMd(ctx.cwd);
    if (!check.exists)
      ctx.ui.notify("No .pi/MODELS.md found. Run /models setup to draft model routes.", "warning");
    else if (!check.ok)
      ctx.ui.notify(`Invalid .pi/MODELS.md:\n${check.errors.join("\n")}`, "error");
  });

  // Stop UI timers and forget in-process run state; child session files remain durable.
  pi.on("session_shutdown", (_event, ctx) => {
    stopPanel(ctx);
    resetRuntime();
  });
}

function createSubagentTool(pi: ExtensionAPI): ToolDefinition<typeof SubagentParams, ToolDetails> {
  return {
    name: "subagent",
    label: "Subagent",
    description:
      "Spawn child Pi sessions, run parallel child jobs, or follow up with an existing child session via sessionFile.",
    parameters: SubagentParams,
    async execute(_id, params: SubagentParamsType, signal, onUpdate, ctx) {
      const options = params.options ?? {};
      const fanout = params.tasks?.length ? params.tasks : undefined;
      // `tasks` means independent fan-out. Each child gets its own fresh context/session.
      if (fanout) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Running ${fanout.length} subagents in parallel. Results will be returned when all finish.`,
            },
          ],
          details: { runs: [] },
        });
        const runs = await runParallelSubagents(
          {
            tasks: fanout,
            model: options.model,
            reasoning: options.reasoning,
            timeout: options.timeout,
          },
          ctx,
          signal,
        );
        return {
          content: [{ type: "text", text: formatParallelRuns(runs) }],
          isError: runs.some((run) => run.status !== "complete"),
          details: { runs },
        };
      }
      // `sessionFile` means continue an existing child instead of spawning a related duplicate.
      if (params.sessionFile?.trim()) {
        if (!params.task?.trim())
          return errorResult("Provide `task` with `sessionFile` for a subagent follow-up.");
        const run = await messageSubagentSession(
          {
            sessionFile: params.sessionFile,
            message: params.task,
            model: options.model,
            reasoning: options.reasoning,
            timeout: options.timeout,
          },
          ctx,
          signal,
        );
        return {
          content: [{ type: "text", text: formatRun(run) }],
          isError: run.status !== "complete",
          details: { runs: [run] },
        };
      }
      if (!params.task?.trim())
        return errorResult(
          "Provide `task` for one subagent, `tasks` for parallel subagents, or `task` + `sessionFile` for a follow-up.",
        );
      // Solo path: one child session for one narrow task.
      const route = resolveModelRoute(ctx, options.model, options.reasoning);
      const run = await runPiSubagent(
        { task: params.task, ...route, timeout: options.timeout },
        ctx,
        signal,
      );
      // Keep a small event hook for other UI/extensions; detailed output stays in the tool result/session file.
      pi.events.emit("subagent:complete", {
        id: run.id,
        agent: "subagent",
        success: run.status === "complete",
        summary: run.output ?? run.error ?? "",
        exitCode: run.exitCode ?? 1,
        timestamp: Date.now(),
        sessionFile: run.sessionFile,
      });
      return {
        content: [{ type: "text", text: formatRun(run) }],
        isError: run.status !== "complete",
        details: { runs: [run] },
      };
    },
    renderCall(args, theme) {
      const action = args.tasks?.length
        ? `${args.tasks.length} parallel jobs`
        : args.sessionFile
          ? `follow-up: ${args.task ?? ""}`
          : (args.task ?? "");
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent"))}: ${theme.fg("accent", shortTask(action))}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const fallback = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
      return new Text(renderRunsForUser(result.details?.runs, fallback, theme), 0, 0);
    },
  };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true, details: { runs: [] } };
}
