import type { Message } from "@earendil-works/pi-ai";
import type { RunDetails } from "./types.ts";

// Child Pi JSON mode gives structured messages; tool results should return only final assistant text.
export function finalTextFromMessage(message: Message): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string")
        return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function shortTask(task: string): string {
  return task.replace(/\s+/g, " ").trim().slice(0, 72) || "subagent";
}

export function formatRun(run: RunDetails): string {
  const lines = [
    `Subagent: ${run.id}`,
    `Status: ${run.status}`,
    run.model ? `Model: ${run.model}` : undefined,
    run.sessionFile ? `Session: ${run.sessionFile}` : undefined,
    run.usage
      ? `Usage: ${run.usage.inputTokens} in / ${run.usage.outputTokens} out (${run.usage.tokens} tokens)${run.usage.costUsd ? `, $${run.usage.costUsd.toFixed(4)}` : ""}`
      : undefined,
    run.error ? `Error: ${run.error}` : undefined,
    run.output ? "" : undefined,
    run.output || undefined,
  ].filter((line): line is string => line !== undefined);
  return lines.join("\n");
}

export function formatParallelRuns(runs: RunDetails[]): string {
  const ok = runs.filter((run) => run.status === "complete").length;
  const lines = [`Parallel subagents: ${ok}/${runs.length} complete`];
  for (const [index, run] of runs.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${shortTask(run.task)}`,
      `Subagent: ${run.id}`,
      `Status: ${run.status}`,
    );
    if (run.model) lines.push(`Model: ${run.model}`);
    if (run.sessionFile) lines.push(`Session: ${run.sessionFile}`);
    if (run.usage)
      lines.push(
        `Usage: ${run.usage.inputTokens} in / ${run.usage.outputTokens} out (${run.usage.tokens} tokens)${run.usage.costUsd ? `, $${run.usage.costUsd.toFixed(4)}` : ""}`,
      );
    if (run.error) lines.push(`Error: ${run.error}`);
    if (run.output) lines.push("", run.output);
  }
  return lines.join("\n");
}

export function oneLine(value: string, max: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1))}…`;
}

// TUI rendering is a compact preview; full details remain in text result + child session file.
export function renderRunsForUser(
  runs: RunDetails[] | undefined,
  fallback: string,
  theme: { fg(name: string, value: string): string; bold(value: string): string },
): string {
  if (!runs?.length) return theme.fg("toolOutput", fallback);
  const ok = runs.filter((run) => run.status === "complete").length;
  const lines = [
    `${theme.fg("toolTitle", theme.bold(runs.length === 1 ? "subagent" : "subagents"))} ${theme.fg(ok === runs.length ? "success" : "warning", `${ok}/${runs.length} complete`)}`,
  ];
  for (const [index, run] of runs.entries())
    lines.push("", ...renderRunSummary(run, runs.length === 1 ? undefined : index, theme));
  return lines.join("\n");
}

function renderRunSummary(
  run: RunDetails,
  index: number | undefined,
  theme: { fg(name: string, value: string): string; bold(value: string): string },
): string[] {
  const status =
    run.status === "complete"
      ? theme.fg("success", "complete")
      : run.status === "running"
        ? theme.fg("warning", "running")
        : theme.fg("error", "failed");
  const title = index === undefined ? "subagent" : `${index + 1}. ${shortTask(run.task)}`;
  const lines = [`${theme.fg("toolTitle", theme.bold(title))} ${status}`];
  if (run.model) lines.push(`  ${theme.fg("muted", "model")} ${theme.fg("toolOutput", run.model)}`);
  if (run.sessionFile)
    lines.push(
      `  ${theme.fg("muted", "follow-up")} ${theme.fg("accent", "subagent sessionFile")} ${theme.fg("muted", run.sessionFile)}`,
    );
  if (run.usage)
    lines.push(
      `  ${theme.fg("muted", "usage")} ${theme.fg("toolOutput", `${run.usage.inputTokens} in / ${run.usage.outputTokens} out · ${run.usage.tokens} tokens${run.usage.costUsd ? ` · $${run.usage.costUsd.toFixed(4)}` : ""}`)}`,
    );
  if (run.error) lines.push(`  ${theme.fg("error", oneLine(run.error, 220))}`);
  if (run.output?.trim()) {
    const outputLines = run.output.trim().split("\n").filter(Boolean).slice(0, 8);
    lines.push(theme.fg("muted", "  summary"));
    for (const line of outputLines) lines.push(`    ${theme.fg("toolOutput", oneLine(line, 180))}`);
    const totalLines = run.output.trim().split("\n").filter(Boolean).length;
    if (totalLines > outputLines.length)
      lines.push(`    ${theme.fg("muted", `… ${totalLines - outputLines.length} more lines`)}`);
  }
  return lines;
}
