import type { ActiveRun } from "./types.ts";
import { MAX_ACTIVE } from "./constants.ts";

// Process-local scheduler state. Child session JSONL files are the durable record.
export const activeRuns = new Map<string, ActiveRun>();
let activeCount = 0;
let runtimeGeneration = 0;
const waitQueue: Array<{ generation: number; resolve: () => void }> = [];

export type RuntimeToken = { generation: number; released: boolean };

export async function acquireSlot(): Promise<RuntimeToken> {
  const generation = runtimeGeneration;
  if (activeCount < MAX_ACTIVE) {
    activeCount++;
    return { generation, released: false };
  }
  // FIFO backpressure keeps the tool from spawning unbounded Pi processes.
  await new Promise<void>((resolve) => waitQueue.push({ generation, resolve }));
  if (generation !== runtimeGeneration) return { generation, released: true };
  activeCount++;
  return { generation, released: false };
}

export function releaseSlot(token: RuntimeToken): void {
  if (token.released || token.generation !== runtimeGeneration) return;
  token.released = true;
  activeCount = Math.max(0, activeCount - 1);
  wakeNextWaiter();
}

export function isRuntimeCurrent(token: RuntimeToken): boolean {
  return !token.released && token.generation === runtimeGeneration;
}

export function resetRuntime(): void {
  runtimeGeneration++;
  activeRuns.clear();
  activeCount = 0;
  wakeAllWaiters();
}

function wakeNextWaiter(): void {
  while (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
    if (next.generation === runtimeGeneration) return;
  }
}

function wakeAllWaiters(): void {
  const waiters = waitQueue.splice(0);
  for (const waiter of waiters) waiter.resolve();
}
