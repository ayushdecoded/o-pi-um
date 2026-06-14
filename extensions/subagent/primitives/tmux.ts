import * as fs from "node:fs";
import { runCommand, safeRead } from "./system.ts";

export async function tmuxAvailable(): Promise<boolean> {
  return (await runCommand("tmux", ["-V"])).code === 0;
}

export function tmuxName(id: string): string {
  return `pi-${id}`.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80);
}

export async function startTmuxScript(
  sessionName: string,
  scriptFile: string,
): Promise<string | null> {
  const result = await runCommand("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "bash",
    scriptFile,
  ]);
  return result.code === 0 ? null : result.stderr || result.stdout || "tmux failed to start child";
}

export type WaitStatusResult = { exitCode: number; timedOut: boolean };

export async function waitForStatus(
  statusFile: string,
  tmuxSession: string,
  signal?: AbortSignal,
  timeoutMs = 300_000,
): Promise<WaitStatusResult> {
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000);
  // The shell script writes this sentinel after Pi exits; until then tmux owns the child.
  while (!fs.existsSync(statusFile)) {
    if (signal?.aborted) {
      await runCommand("tmux", ["kill-session", "-t", tmuxSession]);
      return { exitCode: 130, timedOut: false };
    }
    if (Date.now() >= deadline) return { exitCode: 124, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { exitCode: Number.parseInt(safeRead(statusFile).trim() || "1", 10), timedOut: false };
}
