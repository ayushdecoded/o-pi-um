import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { GOAL_FILE_VERSION, THINKING_LEVELS } from "../domain/constants.ts";
import type {
  GoalFile,
  GoalMetrics,
  GoalModelOverride,
  GoalState,
  GoalStatus,
  GoalSubTurn,
  GoalSubtask,
  ThinkingLevel,
} from "../domain/types.ts";

export type GoalStoreRef = { baseDir: string; threadId: string; modelOverride?: GoalModelOverride };

export function goalRef(ctx: ExtensionContext): GoalStoreRef {
  const sessionDir = ctx.sessionManager.getSessionDir?.() ?? join(ctx.cwd, ".pi", "sessions");
  const sessionFile = ctx.sessionManager.getSessionFile?.();
  const rawId = ctx.sessionManager.getSessionId?.() ?? sessionFile ?? ctx.cwd;
  const threadId = createHash("sha256").update(rawId).digest("hex").slice(0, 24);
  return { baseDir: join(sessionDir, "goals"), threadId };
}

export function goalPath(ref: GoalStoreRef): string {
  return join(ref.baseDir, `${ref.threadId}.json`);
}

export async function readGoalFile(ref: GoalStoreRef): Promise<GoalFile> {
  try {
    const raw = await readFile(goalPath(ref), "utf8");
    const parsed = JSON.parse(raw) as GoalFile;
    if (parsed.version !== GOAL_FILE_VERSION) return { version: GOAL_FILE_VERSION, goal: null };
    return {
      version: GOAL_FILE_VERSION,
      goal: isGoalState(parsed.goal) ? parsed.goal : null,
      ...(isGoalModelOverride(parsed.modelOverride) ? { modelOverride: parsed.modelOverride } : {}),
    };
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT")
      return { version: GOAL_FILE_VERSION, goal: null };
    if (err instanceof SyntaxError) {
      await quarantineCorruptGoalFile(ref);
      return { version: GOAL_FILE_VERSION, goal: null };
    }
    throw err;
  }
}

export async function readGoal(ref: GoalStoreRef): Promise<GoalState | null> {
  return (await readGoalFile(ref)).goal;
}

export async function readGoalModelOverride(
  ref: GoalStoreRef,
): Promise<GoalModelOverride | undefined> {
  return (await readGoalFile(ref)).modelOverride;
}

async function quarantineCorruptGoalFile(ref: GoalStoreRef): Promise<void> {
  const target = goalPath(ref);
  try {
    await rename(target, `${target}.corrupt-${Date.now()}`);
  } catch {
    // Best-effort quarantine; if rename fails, ignore and start clean in memory.
  }
}

export async function writeGoalFile(ref: GoalStoreRef, file: GoalFile): Promise<void> {
  await mkdir(ref.baseDir, { recursive: true });
  const target = goalPath(ref);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(temp, target);
}

export async function writeGoal(ref: GoalStoreRef, goal: GoalState | null): Promise<void> {
  const existing = await readGoalFile(ref);
  await writeGoalFile(ref, {
    version: GOAL_FILE_VERSION,
    goal,
    ...(existing.modelOverride ? { modelOverride: existing.modelOverride } : {}),
  });
}

export async function setGoalModelOverride(
  ref: GoalStoreRef,
  modelOverride: GoalModelOverride | undefined,
): Promise<void> {
  const existing = await readGoalFile(ref);
  const goal = existing.goal
    ? { ...existing.goal, ...(modelOverride ? { modelOverride } : { modelOverride: undefined }) }
    : null;
  await writeGoalFile(ref, {
    version: GOAL_FILE_VERSION,
    goal,
    ...(modelOverride ? { modelOverride } : {}),
  });
}

function isGoalState(value: unknown): value is GoalState {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.threadId === "string" &&
    typeof value.intent === "string" &&
    Array.isArray(value.objectives) &&
    value.objectives.every((item) => typeof item === "string") &&
    isNonNegativeInteger(value.currentObjectiveIndex) &&
    isGoalStatus(value.status) &&
    (value.tokenBudget === null || isPositiveInteger(value.tokenBudget)) &&
    (value.timeBudgetSeconds === undefined ||
      value.timeBudgetSeconds === null ||
      isPositiveInteger(value.timeBudgetSeconds)) &&
    (value.turnBudget === undefined ||
      value.turnBudget === null ||
      isPositiveInteger(value.turnBudget)) &&
    (value.costBudgetUsd === undefined ||
      value.costBudgetUsd === null ||
      isPositiveNumber(value.costBudgetUsd)) &&
    isNonNegativeInteger(value.tokensUsed) &&
    isNonNegativeInteger(value.timeUsedSeconds) &&
    (value.turnsUsed === undefined || isNonNegativeInteger(value.turnsUsed)) &&
    (value.costUsedUsd === undefined || isNonNegativeNumber(value.costUsedUsd)) &&
    isNonNegativeInteger(value.createdAt) &&
    isNonNegativeInteger(value.updatedAt) &&
    (value.activatedAt === undefined || isNonNegativeInteger(value.activatedAt)) &&
    (value.subTurns === undefined ||
      (Array.isArray(value.subTurns) && value.subTurns.every(isGoalSubTurn))) &&
    (value.completedAt === undefined || isNonNegativeInteger(value.completedAt)) &&
    (value.subtasks === undefined ||
      (Array.isArray(value.subtasks) && value.subtasks.every(isGoalSubtask))) &&
    (value.metrics === undefined || isGoalMetrics(value.metrics)) &&
    (value.budgetLimitPrompted === undefined || typeof value.budgetLimitPrompted === "boolean") &&
    (value.blockedReason === undefined ||
      value.blockedReason === null ||
      value.blockedReason === "waiting_on_user" ||
      value.blockedReason === "budget_limited") &&
    (value.blockedDetail === undefined || typeof value.blockedDetail === "string") &&
    (value.modelOverride === undefined || isGoalModelOverride(value.modelOverride))
  );
}

function isGoalSubtask(value: unknown): value is GoalSubtask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.completed === "boolean" &&
    isNonNegativeInteger(value.objectiveIndex) &&
    isNonNegativeInteger(value.createdAt) &&
    isNonNegativeInteger(value.updatedAt)
  );
}

function isGoalMetrics(value: unknown): value is GoalMetrics {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.toolCalls) &&
    isNonNegativeInteger(value.continuationsStarted) &&
    isNonNegativeInteger(value.budgetLimits)
  );
}

function isGoalSubTurn(value: unknown): value is GoalSubTurn {
  return (
    isRecord(value) &&
    typeof value.index === "number" &&
    isNonNegativeInteger(value.tokens) &&
    isNonNegativeInteger(value.tools) &&
    isNonNegativeInteger(value.durationSeconds)
  );
}

function isGoalStatus(value: unknown): value is GoalStatus {
  return value === "active" || value === "paused" || value === "complete";
}

function isGoalModelOverride(value: unknown): value is GoalModelOverride {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    (value.thinking === undefined || THINKING_LEVELS.includes(value.thinking as ThinkingLevel))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
