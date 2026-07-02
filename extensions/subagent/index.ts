import * as fs from "node:fs";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SESSION_ROOT } from "./constants.ts";
import { resolveModelRoute, validateModelsMd } from "./models.ts";
import { formatSubagentPrompt } from "./prompt.ts";
import { resetRuntime } from "./runtime.ts";
import { messageSubagentSessions, runParallelSubagents, runPiSubagent } from "./runner.ts";
import { SubagentParams } from "./schema.ts";
import { formatParallelRuns, formatRun, renderRunsForUser, shortTask } from "./text.ts";
import type { SubagentParamsType, ToolDetails } from "./types.ts";
import { connectPanelEvents, stopPanel } from "./panel.ts";
import { registerSubagentCommands } from "./commands.ts";
import { registerModelCommands } from "./model-commands.ts";

export default function registerSubagentExtension(pi: ExtensionAPI): void {
  // Child sessions are real Pi sessions; keep their JSONL under one predictable directory.
  fs.mkdirSync(SESSION_ROOT, { recursive: true });

  // Teach the parent model when to delegate, without exposing spawn/process details.
  pi.on("before_agent_start", (event, ctx) => ({
    systemPrompt: `${event.systemPrompt}\n\n${formatSubagentPrompt(ctx)}`,
  }));

  connectPanelEvents(pi);
  pi.registerTool(createSubagentTool(pi));
  registerSubagentResultStatus(pi);
  registerSubagentCommands(pi);
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
      "Spawn child Pi sessions from tasks, run them in parallel, or follow up with existing child sessions via sessionFiles.",
    parameters: SubagentParams,
    async execute(_id, params: SubagentParamsType, signal, onUpdate, ctx) {
      const options = params.options ?? {};
      const tasks = params.tasks?.map((task) => task.trim()).filter(Boolean) ?? [];
      const sessionFiles = params.sessionFiles?.map((file) => file.trim()).filter(Boolean) ?? [];
      if (tasks.length === 0) throw new Error("Provide `tasks` with at least one instruction.");
      if (sessionFiles.length > 0) {
        if (tasks.length !== 1 && tasks.length !== sessionFiles.length)
          throw new Error(
            "Use follow-up sessionFiles with either one shared task or one task per session file.",
          );
        if (new Set(sessionFiles).size !== sessionFiles.length)
          throw new Error("Duplicate follow-up session files are not supported in one tool call.");

        const runs = await messageSubagentSessions(
          {
            followups: sessionFiles.map((file, index) => ({
              sessionFile: file,
              message: tasks.length === 1 ? tasks[0] : tasks[index],
              model: options.model,
              reasoning: options.reasoning,
              timeout: options.timeout,
            })),
          },
          ctx,
          signal,
        );
        return {
          content: [
            {
              type: "text",
              text: runs.length === 1 ? formatRun(runs[0]) : formatParallelRuns(runs),
            },
          ],
          details: { runs },
        };
      }
      // Multiple tasks fan out; one task is the solo path.
      if (tasks.length > 1) {
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `Running ${tasks.length} subagents in parallel. Results will be returned when all finish.`,
            },
          ],
          details: { runs: [] },
        });
        const runs = await runParallelSubagents(
          {
            tasks,
            model: options.model,
            reasoning: options.reasoning,
            timeout: options.timeout,
          },
          ctx,
          signal,
        );
        return {
          content: [{ type: "text", text: formatParallelRuns(runs) }],
          details: { runs },
        };
      }
      const route = resolveModelRoute(ctx, options.model, options.reasoning);
      const run = await runPiSubagent(
        { task: tasks[0], ...route, timeout: options.timeout },
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
        details: { runs: [run] },
      };
    },
    renderCall(args, theme) {
      const taskCount = args.tasks?.length ?? 0;
      const followupCount = args.sessionFiles?.length ?? 0;
      const action =
        followupCount > 1
          ? `${followupCount} parallel follow-ups`
          : followupCount === 1
            ? `follow-up: ${args.tasks?.[0] ?? ""}`
            : taskCount > 1
              ? `${taskCount} parallel jobs`
              : (args.tasks?.[0] ?? "");
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

function registerSubagentResultStatus(pi: ExtensionAPI): void {
  pi.on("tool_result", (event) => {
    if (event.toolName !== "subagent") return;
    const details = event.details as ToolDetails | undefined;
    if (details?.runs?.some((run) => run.status !== "complete")) return { isError: true };
  });
}
