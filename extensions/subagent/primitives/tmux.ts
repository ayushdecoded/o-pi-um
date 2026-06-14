import * as fs from "node:fs";
import { runCommand, safeRead } from "./system.ts";

export async function tmuxAvailable(): Promise<boolean> {
  return (await runCommand("tmux", ["-V"])).code === 0;
}

export function tmuxName(id: string): string {
  return `pi-${id}`.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 80);
}

export async function startTmuxScript(sessionName: string, scriptFile: string): Promise<string | null> {
  const result = await runCommand("tmux", ["new-session", "-d", "-s", sessionName, "bash", scriptFile]);
  return result.code === 0 ? null : result.stderr || result.stdout || "tmux failed to start child";
}

export async function waitForStatus(statusFile: string, tmuxSession: string, signal?: AbortSignal): Promise<number> {
  // The shell script writes this sentinel after Pi exits; until then tmux owns the child.
  while (!fs.existsSync(statusFile)) {
    if (signal?.aborted) {
      await runCommand("tmux", ["kill-session", "-t", tmuxSession]);
      return 130;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return Number.parseInt(safeRead(statusFile).trim() || "1", 10);
}
