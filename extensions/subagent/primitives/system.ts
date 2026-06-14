import { spawn } from "node:child_process";
import * as fs from "node:fs";

export type CommandResult = { code: number; stdout: string; stderr: string };

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
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

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function safeRead(file: string): string {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}
