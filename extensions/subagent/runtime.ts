import type { ActiveRun } from "./types.ts";
import { MAX_ACTIVE } from "./constants.ts";

// Process-local scheduler state. Child session JSONL files are the durable record.
export const activeRuns = new Map<string, ActiveRun>();
let activeCount = 0;
const waitQueue: Array<() => void> = [];

export async function acquireSlot(): Promise<void> {
  if (activeCount < MAX_ACTIVE) {
    activeCount++;
    return;
  }
  // FIFO backpressure keeps the tool from spawning unbounded Pi processes.
  await new Promise<void>((resolve) => waitQueue.push(resolve));
  activeCount++;
}

export function releaseSlot(): void {
  activeCount = Math.max(0, activeCount - 1);
  const next = waitQueue.shift();
  if (next) next();
}

export function resetRuntime(): void {
  activeRuns.clear();
  activeCount = 0;
  waitQueue.length = 0;
}
