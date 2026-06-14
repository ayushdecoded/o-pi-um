import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAX_ACTIVE, MAX_DEPTH, SESSION_ROOT } from "./constants.ts";
import { getPiSpawnCommand } from "./pi-spawn.ts";
import { resolveModelRoute } from "./models.ts";
import { renderPanel, startPanel } from "./panel.ts";
import { acquireSlot, activeRuns, releaseSlot } from "./runtime.ts";
import { finalTextFromMessage } from "./text.ts";
import { usageFromMessages } from "./usage.ts";
import type { FollowupParamsType, RunDetails, ThinkingLevelType } from "./types.ts";

export async function runParallelSubagents(params: { tasks: Array<{ task: string; model?: string; reasoning?: ThinkingLevelType }>; model?: string; reasoning?: ThinkingLevelType }, ctx: ExtensionContext, signal?: AbortSignal): Promise<RunDetails[]> {
  // The schema caps tasks, but slice again here so programmatic callers cannot over-fan-out.
  const tasks = params.tasks.slice(0, MAX_ACTIVE);
  return Promise.all(tasks.map((task) => {
    const route = resolveModelRoute(ctx, task.model ?? params.model, task.reasoning ?? params.reasoning);
    return runPiSubagent({ task: task.task, ...route }, ctx, signal);
  }));
}

export async function runPiSubagent(params: { task: string; model?: string; reasoning?: ThinkingLevelType }, ctx: ExtensionContext, signal?: AbortSignal): Promise<RunDetails> {
  // Depth is propagated through env so nested child Pi processes cannot recursively explode.
  const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
  if (depth >= MAX_DEPTH) return blockedRun(params.task, params.model);
  await acquireSlot();
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
  const id = `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const sessionFile = sessionFileForRun(id, startedAt);
  // activeRuns is UI-only; the durable artifact is the child JSONL session file.
  activeRuns.set(id, { id, task: params.task, model: params.model, startedAt, status: "running" });
  startPanel(ctx);
  const args = ["--mode", "json", "--session-dir", SESSION_ROOT, "--session", sessionFile, ...modelArgs(params), "-p", params.task];
  try {
    return await runTmuxPi({ id, task: params.task, model: params.model, sessionFile, startedAt, args, cwd: ctx.cwd, depth, signal });
  } finally {
    activeRuns.delete(id);
    releaseSlot();
    renderPanel(ctx);
  }
}

export async function messageSubagentSession(params: FollowupParamsType, ctx: ExtensionContext, signal?: AbortSignal): Promise<RunDetails> {
  // Follow-ups reuse the child session file so context accumulates in that child, not the parent.
  const route = resolveModelRoute(ctx, params.model, params.reasoning);
  params = { ...params, ...route };
  const sessionFile = path.resolve(params.sessionFile.startsWith("~/") ? path.join(os.homedir(), params.sessionFile.slice(2)) : params.sessionFile);
  const startedAt = Date.now();
  if (!fs.existsSync(sessionFile)) return failedRun(params.message, params.model, sessionFile, `Session file not found: ${sessionFile}`, startedAt);
  await acquireSlot();
  const id = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  activeRuns.set(id, { id, task: params.message, model: params.model, startedAt, status: "running" });
  startPanel(ctx);
  const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
  const args = ["--mode", "json", "--session", sessionFile, ...modelArgs(params), "-p", params.message];
  try {
    return await runTmuxPi({ id, task: params.message, model: params.model, sessionFile, startedAt, args, cwd: ctx.cwd, depth, signal });
  } finally {
    activeRuns.delete(id);
    releaseSlot();
    renderPanel(ctx);
  }
}

function modelArgs(params: { model?: string; reasoning?: ThinkingLevelType }): string[] {
  const args: string[] = [];
  if (params.model?.trim()) args.push("--model", params.model.trim());
  if (params.reasoning) args.push("--thinking", params.reasoning);
  return args;
}

async function runTmuxPi(input: { id: string; task: string; model?: string; sessionFile: string; startedAt: number; args: string[]; cwd: string; depth: number; signal?: AbortSignal }): Promise<RunDetails> {
  // tmux owns the child process so a run can be inspected independently of the parent Pi process.
  const tmux = await requireTmux(input.task, input.model, input.sessionFile, input.startedAt);
  if (tmux) return tmux;
  const runDir = path.join(SESSION_ROOT, "runs", input.id);
  fs.mkdirSync(runDir, { recursive: true });
  const stdoutFile = path.join(runDir, "stdout.jsonl");
  const stderrFile = path.join(runDir, "stderr.log");
  const statusFile = path.join(runDir, "exit.status");
  const scriptFile = path.join(runDir, "run.sh");
  const spawnSpec = getPiSpawnCommand(input.args);
  const command = [spawnSpec.command, ...spawnSpec.args].map(shellQuote).join(" ");
  fs.writeFileSync(scriptFile, renderRunScript({ cwd: input.cwd, depth: input.depth, command, stdoutFile, stderrFile, statusFile }), { mode: 0o700 });
  const tmuxSession = tmuxName(input.id);
  const started = await runCommand("tmux", ["new-session", "-d", "-s", tmuxSession, "bash", scriptFile]);
  if (started.code !== 0) return failedRun(input.task, input.model, input.sessionFile, started.stderr || started.stdout || "tmux failed to start child", input.startedAt);
  const exitCode = await waitForStatus(statusFile, tmuxSession, input.signal);
  const messages = readJsonMessages(stdoutFile);
  const output = messages.length ? finalTextFromMessage(messages[messages.length - 1]!) : "";
  const usage = usageFromMessages(messages);
  const stderr = safeRead(stderrFile).trim();
  return { id: input.id, task: input.task, model: input.model, status: exitCode === 0 ? "complete" : "failed", exitCode, output, sessionFile: input.sessionFile, usage, ...(exitCode === 0 ? {} : { error: stderr || `pi exited with code ${exitCode}` }), startedAt: input.startedAt, completedAt: Date.now() };
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

async function requireTmux(task: string, model: string | undefined, sessionFile: string, startedAt: number): Promise<RunDetails | null> {
  const check = await runCommand("tmux", ["-V"]);
  return check.code === 0 ? null : failedRun(task, model, sessionFile, "tmux is required for subagent runs but was not found", startedAt);
}

async function waitForStatus(statusFile: string, tmuxSession: string, signal?: AbortSignal): Promise<number> {
  while (!fs.existsSync(statusFile)) {
    if (signal?.aborted) {
      await runCommand("tmux", ["kill-session", "-t", tmuxSession]);
      return 130;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return Number.parseInt(safeRead(statusFile).trim() || "1", 10);
}

function readJsonMessages(stdoutFile: string): Message[] {
  const messages: Message[] = [];
  for (const line of safeRead(stdoutFile).split("\n")) collectJsonMessage(line, messages);
  return messages;
}

function collectJsonMessage(line: string, messages: Message[]): void {
  if (!line.trim()) return;
  // Ignore non-JSON startup warnings/stderr-ish lines that can appear in stdout.
  try {
    const event = JSON.parse(line) as { type?: string; message?: Message };
    if (event.type === "message_end" && event.message) messages.push(event.message);
  } catch {}
}

async function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    proc.on("error", (error) => resolve({ code: 1, stdout, stderr: error instanceof Error ? error.message : String(error) }));
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function safeRead(file: string): string {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function tmuxName(id: string): string {
  return `pi-${id}`.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80);
}

function sessionFileForRun(id: string, startedAt: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  return path.join(SESSION_ROOT, `${stamp}_${id}.jsonl`);
}

function blockedRun(task: string, model?: string): RunDetails {
  const now = Date.now();
  return { id: `blocked-${now.toString(36)}`, task, model, status: "failed", error: `Max subagent nesting depth (${MAX_DEPTH}) reached.`, startedAt: now, completedAt: now };
}

function failedRun(task: string, model: string | undefined, sessionFile: string, error: string, startedAt: number): RunDetails {
  return { id: `msg-${Date.now().toString(36)}`, task, model, status: "failed", error, sessionFile, startedAt, completedAt: Date.now() };
}
