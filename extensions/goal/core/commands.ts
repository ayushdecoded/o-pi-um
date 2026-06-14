import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { THINKING_LEVELS } from "../domain/constants.ts";
import { parseGoalIntent } from "../domain/intent.ts";
import { isApprovedActiveGoal, isApprovedGoal, normalizedObjectives, nowSeconds, touchGoal } from "../domain/state.ts";
import type { GoalModelOverride, GoalState, ThinkingLevel } from "../domain/types.ts";
import { goalRef, readGoal, readGoalModelOverride, setGoalModelOverride, writeGoal } from "../runtime/store.ts";

export type GoalCommandDeps = {
  showGoalStatus: (ctx: ExtensionContext, goal: GoalState | null, pendingModelOverride?: GoalModelOverride) => Promise<void>;
  updateGoalUi: (ctx: ExtensionContext, goal: GoalState | null) => void;
  showSubagentDetails: (ctx: ExtensionContext) => Promise<void>;
  goalHelpText: () => string;
  pickWithSearch: (ctx: ExtensionContext, title: string, items: Array<{ value: string; label: string }>) => Promise<{ value: string; label: string } | undefined>;
  queueSetup: (pi: ExtensionAPI, goal: GoalState) => void;
  queueContinuation: (pi: ExtensionAPI, ctx: ExtensionContext, goal: GoalState, reason: string) => void;
  clearRuntimeFlags: () => void;
  accountLiveElapsed: (goal: GoalState) => void;
};

export function registerGoalCommands(pi: ExtensionAPI, deps: GoalCommandDeps): void {
  const { showGoalStatus, updateGoalUi, showSubagentDetails, goalHelpText, pickWithSearch, queueSetup, queueContinuation, clearRuntimeFlags, accountLiveElapsed } = deps;

  pi.registerCommand("agents", {
    description: "Show active goal/subagent details",
    handler: async (_args, ctx) => withCommandErrors(ctx, async () => showSubagentDetails(ctx)),
  });
  pi.registerCommand("goal", {
    description: "Set up, inspect, pause, resume, or clear a long-running goal",
    handler: async (args, ctx) =>
      withCommandErrors(ctx, async () => {
        const text = args.trim();
        const lower = text.toLowerCase();
        const ref = goalRef(ctx);
        const goal = await readGoal(ref);

        if (!text || lower === "status") {
          await showGoalStatus(ctx, goal, await readGoalModelOverride(ref));
          updateGoalUi(ctx, goal);
          return;
        }

        if (lower === "agents") {
          await showSubagentDetails(ctx);
          return;
        }

        if (lower.startsWith("expand ") || lower === "expand") {
          const extText = text.replace(/^expand\s*/, "").trim();
          if (!goal || !isApprovedGoal(goal) || goal.status === "complete") {
            ctx.ui.notify("No approved active goal to expand.", "warning");
            return;
          }
          if (!extText) {
            ctx.ui.notify(
              "Usage: /goal expand <additional objective>",
              "warning",
            );
            return;
          }
          goal.objectives = normalizedObjectives(goal);
          goal.objectives.push(extText);
          touchGoal(goal);
          await writeGoal(ref, goal);
          updateGoalUi(ctx, goal);
          ctx.ui.notify(`Objective added: ${extText}`, "info");
          return;
        }

        if (lower.startsWith("expand-drop")) {
          const idxStr = text.replace(/^expand-drop\s*/, "").trim();
          const idx = Number.parseInt(idxStr, 10);
          if (
            !goal ||
            !isApprovedGoal(goal) ||
            isNaN(idx) ||
            idx <= 0 ||
            idx >= normalizedObjectives(goal).length
          ) {
            ctx.ui.notify(
              "Invalid objective index. Index 0 is the base objective and cannot be dropped.",
              "warning",
            );
            return;
          }
          goal.objectives = normalizedObjectives(goal);
          const removed = goal.objectives.splice(idx, 1)[0]!;
          touchGoal(goal);
          await writeGoal(ref, goal);
          updateGoalUi(ctx, goal);
          ctx.ui.notify(`Dropped objective: ${removed}`, "info");
          return;
        }

        if (lower === "help") {
          ctx.ui.notify(goalHelpText(), "info");
          return;
        }

        if (lower === "pause") {
          if (!goal || !isApprovedActiveGoal(goal)) {
            ctx.ui.notify("No active goal to pause.", "warning");
            return;
          }
          accountLiveElapsed(goal);
          goal.status = "paused";
          touchGoal(goal);
          await writeGoal(ref, goal);
          clearRuntimeFlags();
          updateGoalUi(ctx, goal);
          ctx.ui.notify("Goal paused", "info");
          return;
        }

        if (lower === "resume") {
          if (
            !goal ||
            !isApprovedGoal(goal) ||
            (goal.status !== "paused" &&
              goal.blockedReason !== "waiting_on_user")
          ) {
            ctx.ui.notify("No paused or blocked goal to resume.", "warning");
            return;
          }
          goal.status = "active";
          touchGoal(goal);
          goal.blockedReason = null;
          goal.blockedDetail = undefined;
          goal.budgetLimitPrompted = false;
          await writeGoal(ref, goal);
          updateGoalUi(ctx, goal);
          ctx.ui.notify("Goal resumed", "info");
          queueContinuation(pi, ctx, goal, "resume");
          return;
        }

        if (lower === "clear" || lower === "cancel") {
          await writeGoal(ref, null);
          clearRuntimeFlags();
          updateGoalUi(ctx, null);
          ctx.ui.notify(goal ? "Goal cleared" : "No goal to clear", goal ? "info" : "warning");
          return;
        }

        const parsed = parseGoalIntent(text);
        if (parsed.error) {
          ctx.ui.notify(parsed.error, "error");
          return;
        }

        if (goal && goal.status !== "complete") {
          const ok =
            !ctx.hasUI ||
            (await ctx.ui.confirm(
              "Replace current goal?",
              `Current: ${goal.intent}\n\nNew: ${parsed.intent}`,
            ));
          if (!ok) return;
        }

        const modelOverride =
          goal?.modelOverride ?? (await readGoalModelOverride(ref));
        const next: GoalState = {
          id: randomUUID(),
          threadId: ref.threadId,
          intent: parsed.intent,
          objectives: [],
          currentObjectiveIndex: 0,
          status: "paused",
          tokenBudget: parsed.tokenBudget,
          timeBudgetSeconds: parsed.timeBudgetSeconds,
          turnBudget: parsed.turnBudget,
          costBudgetUsd: parsed.costBudgetUsd,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          turnsUsed: 0,
          costUsedUsd: 0,
          subtasks: [],
          createdAt: nowSeconds(),
          updatedAt: nowSeconds(),
          budgetLimitPrompted: false,
          blockedReason: null,
          ...(modelOverride ? { modelOverride } : {}),
        };
        await writeGoal(ref, next);
        updateGoalUi(ctx, next);
        ctx.ui.notify("Goal setup started", "info");
        queueSetup(pi, next);
      }),
  });

  pi.registerCommand("goal_model", {
    description: "Pick the model and thinking level used for goal turns",
    handler: async (_args, ctx) =>
      withCommandErrors(ctx, async () => {
        if (!ctx.hasUI) {
          ctx.ui.notify("/goal_model requires interactive UI", "error");
          return;
        }
        const ref = goalRef(ctx);
        const goal = await readGoal(ref);
        const allModels = ctx.modelRegistry.getAvailable();
        const allAuth =
          allModels.length > 0 ? allModels : ctx.modelRegistry.getAll();
        const enabledSet = new Set(scopedModels());
        const models =
          enabledSet.size > 0
            ? allAuth.filter((m) => enabledSet.has(`${m.provider}/${m.id}`))
            : allAuth;
        const currentModel = currentModelName(ctx);
        const items: Array<{ value: string; label: string }> = [
          ...(currentModel
            ? [
                {
                  value: "__current",
                  label: `Use current model (${currentModel})`,
                },
              ]
            : []),
          ...models.map((m) => ({
            value: `${m.provider}/${m.id}`,
            label: `${m.provider}/${m.id}`,
          })),
          { value: "__clear", label: "Clear goal model override" },
        ];
        const chosen = await pickWithSearch(ctx, "Goal model", items);
        if (!chosen) return;
        if (chosen.value === "__clear") {
          await setGoalModelOverride(ref, undefined);
          const updatedGoal = await readGoal(ref);
          updateGoalUi(ctx, updatedGoal);
          ctx.ui.notify("Goal model override cleared", "info");
          return;
        }
        const model =
          chosen.value === "__current" && currentModel
            ? currentModel
            : chosen.value;
        const currentThinking = pi.getThinkingLevel();
        const thinkingItems: Array<{ value: string; label: string }> = [
          { value: "__current", label: `current (${currentThinking})` },
          ...THINKING_LEVELS.map((t) => ({ value: t, label: t })),
        ];
        const thinkingChoice = await pickWithSearch(
          ctx,
          "Goal thinking level",
          thinkingItems,
        );
        if (!thinkingChoice) return;
        const thinking =
          thinkingChoice.value === "__current"
            ? currentThinking
            : (thinkingChoice.value as ThinkingLevel);
        const override: GoalModelOverride = { model, thinking };
        await setGoalModelOverride(ref, override);
        const updatedGoal = await readGoal(ref);
        updateGoalUi(ctx, updatedGoal);
        ctx.ui.notify(
          `Goal model set: ${override.model}${override.thinking ? ` (${override.thinking})` : ""}. Now run /goal <intent>.`,
          "info",
        );
      }),
  });


}

async function withCommandErrors(ctx: ExtensionContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    ctx.ui.notify(`Goal command failed: ${errorMessage(error)}`, "error");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentModelName(ctx: ExtensionContext): string | undefined {
  const model = (ctx as { model?: { provider?: string; id?: string } }).model;
  return model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
}

function scopedModels(): string[] {
  try {
    const raw = readFileSync(join(os.homedir(), ".pi", "agent", "settings.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.enabledModels)) return parsed.enabledModels as string[];
  } catch {
    // settings.json may not exist or be unreadable; fall back to all authenticated models.
  }
  return [];
}
