import * as fs from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SESSION_ROOT } from "./constants.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";
import { finalTextFromMessage } from "./text.ts";
import { usageFromMessages } from "./usage.ts";
import type { RunDetails, ThinkingLevelType } from "./types.ts";
import { readJsonMessages } from "./primitives/pi-json.ts";
import { runPaths } from "./primitives/session.ts";
import { safeRead, shellQuote } from "./primitives/system.ts";
import { startTmuxScript, tmuxAvailable, tmuxName, waitForStatus } from "./primitives/tmux.ts";

export type PiRunInput = {
  id: string;
  task: string;
  model?: string;
  reasoning?: ThinkingLevelType;
  sessionFile: string;
  startedAt: number;
  cwd: string;
  depth: number;
  freshSessionDir: boolean;
  signal?: AbortSignal;
};

export async function runPiInTmux(input: PiRunInput): Promise<RunDetails> {
  if (!(await tmuxAvailable())) return failedRun(input, "tmux is required for subagent runs but was not found");
  const paths = runPaths(input.id);
  const args = piArgs(input);
  const spawnSpec = getPiSpawnCommand(args);
  const command = [spawnSpec.command, ...spawnSpec.args].map(shellQuote).join(" ");
  fs.writeFileSync(paths.scriptFile, renderRunScript({ cwd: input.cwd, depth: input.depth, command, stdoutFile: paths.stdoutFile, stderrFile: paths.stderrFile, statusFile: paths.statusFile }), { mode: 0o700 });
  const tmuxSession = tmuxName(input.id);
  const startError = await startTmuxScript(tmuxSession, paths.scriptFile);
  if (startError) return failedRun(input, startError);
  const exitCode = await waitForStatus(paths.statusFile, tmuxSession, input.signal);
  const messages = readJsonMessages(paths.stdoutFile);
  const output = messages.length ? finalTextFromMessage(messages[messages.length - 1]!) : "";
  const usage = usageFromMessages(messages);
  const stderr = safeRead(paths.stderrFile).trim();
  return { id: input.id, task: input.task, model: input.model, status: exitCode === 0 ? "complete" : "failed", exitCode, output, sessionFile: input.sessionFile, usage, ...(exitCode === 0 ? {} : { error: stderr || `pi exited with code ${exitCode}` }), startedAt: input.startedAt, completedAt: Date.now() };
}

function piArgs(input: PiRunInput): string[] {
  const args = ["--mode", "json"];
  if (input.freshSessionDir) args.push("--session-dir", SESSION_ROOT);
  args.push("--session", input.sessionFile);
  if (input.model?.trim()) args.push("--model", input.model.trim());
  if (input.reasoning) args.push("--thinking", input.reasoning);
  args.push("-p", input.task);
  return args;
}

function renderRunScript(input: { cwd: string; depth: number; command: string; stdoutFile: string; stderrFile: string; statusFile: string }): string {
  return `#!/usr/bin/env bash
set +e
cd ${shellQuote(input.cwd)}
export PI_CODING_AGENT_SESSION_DIR=${shellQuote(SESSION_ROOT)}
export PI_SUBAGENT_DEPTH=${shellQuote(String(input.depth + 1))}
${input.command} > ${shellQuote(input.stdoutFile)} 2> ${shellQuote(input.stderrFile)}
printf "%s" "$?" > ${shellQuote(input.statusFile)}
`;
}

function failedRun(input: PiRunInput, error: string): RunDetails {
  return { id: input.id, task: input.task, model: input.model, status: "failed", error, sessionFile: input.sessionFile, startedAt: input.startedAt, completedAt: Date.now() };
}
