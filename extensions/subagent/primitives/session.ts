import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SESSION_ROOT } from "../constants.ts";

export type RunPaths = {
  runDir: string;
  stdoutFile: string;
  stderrFile: string;
  statusFile: string;
  scriptFile: string;
};

export function makeRunId(prefix: "sub" | "msg"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sessionFileForRun(id: string, startedAt: number): string {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  return path.join(SESSION_ROOT, `${stamp}_${id}.jsonl`);
}

export function normalizeSessionFile(file: string): string {
  return path.resolve(file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file);
}

export function isSubagentSessionFile(file: string): boolean {
  try {
    const root = fs.realpathSync(SESSION_ROOT);
    const resolved = fs.realpathSync(file);
    const relative = path.relative(root, resolved);
    return Boolean(
      relative &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative) &&
      path.dirname(relative) === "." &&
      /_sub-[^/]+\.jsonl$/.test(path.basename(relative)),
    );
  } catch {
    return false;
  }
}

export function ensureSessionRoot(): void {
  fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

export function runPaths(id: string): RunPaths {
  // Per-run files are intentionally stable so failures can be inspected after the parent returns.
  const runDir = path.join(SESSION_ROOT, "runs", id);
  fs.mkdirSync(runDir, { recursive: true });
  return {
    runDir,
    stdoutFile: path.join(runDir, "stdout.jsonl"),
    stderrFile: path.join(runDir, "stderr.log"),
    statusFile: path.join(runDir, "exit.status"),
    scriptFile: path.join(runDir, "run.sh"),
  };
}
