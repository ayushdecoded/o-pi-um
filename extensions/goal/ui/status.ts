import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_SETUP_MESSAGE_TYPE,
  GOAL_STATUS_KEY,
  GOAL_WORK_ORDER_MESSAGE_TYPE,
} from "../domain/constants.ts";
import { activeObjective, currentWorkItem, nowSeconds, readGoalState } from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { formatElapsed, truncate } from "./format.ts";
import { checklistSummaryText } from "./text.ts";

type GoalUiPhase = { goalId: string; title: string; detail: string };

let statusRefreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshCtx: ExtensionContext | undefined;
let activePhase: GoalUiPhase | null = null;

export function setGoalUiPhase(goalId: string, title?: string, detail?: string): void {
  activePhase = title && detail ? { goalId, title, detail } : null;
}

export function updateGoalUi(ctx: ExtensionContext, goal: GoalState | null): void {
  try {
    if (!ctx.hasUI) return;
    renderGoalUi(ctx, goal);
    setDashboardActive(Boolean(goal && goal.status !== "complete"));
    if (goal && goal.status !== "complete") startStatusRefresh(ctx);
    else stopStatusRefresh();
  } catch {
    // UI is best-effort.
  }
}

export async function showGoalStatus(ctx: ExtensionContext, goal: GoalState | null): Promise<void> {
  ctx.ui.notify(goalPanelPlaintext(goal), goal ? "info" : "warning");
}

export function goalPanelPlaintext(goal: GoalState | null): string {
  if (!goal) return "No active goal. Start one with /goal <intent>.";
  return [
    `Goal: ${goal.status}`,
    `Intent: ${goal.intent}`,
    goal.contract ? `Contract: ${goal.contract}` : undefined,
    `Objective: ${activeObjective(goal)}`,
    goal.currentSlice ? `Current slice: ${goal.currentSlice.id}` : undefined,
    goal.lastSummaryEntryId ? `Last summary: ${goal.lastSummaryEntryId}` : undefined,
    goal.blockedDetail ? `Blocked: ${goal.blockedDetail}` : undefined,
    goal.subtasks.length ? `Checklist: ${checklistSummaryText(goal)}` : "Checklist: none yet",
    ...goal.subtasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${item.title}`),
  ]
    .filter(Boolean)
    .join("\n");
}

function renderGoalUi(ctx: ExtensionContext, goal: GoalState | null): void {
  if (!goal) {
    ctx.ui.setStatus(GOAL_STATUS_KEY, undefined);
    ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
    return;
  }
  ctx.ui.setStatus(GOAL_STATUS_KEY, statusLine(ctx, goal));
  ctx.ui.setWidget(GOAL_STATUS_KEY, goalWidgetLines(ctx, goal), { placement: "aboveEditor" });
}

function statusLine(ctx: ExtensionContext, goal: GoalState): string {
  const theme = ctx.ui.theme;
  const phase = phaseFor(goal);
  const colorName = phase ? "accent" : goalColor(goal);
  const elapsed = formatElapsed(goalElapsedSeconds(ctx, goal));
  const work = truncate(phase?.detail ?? displayWorkItem(goal), 54);
  return theme.fg(colorName, `${phase?.title ?? goalTitle(goal)} · ◷ ${elapsed} · ${work}`);
}

function goalWidgetLines(ctx: ExtensionContext, goal: GoalState): string[] {
  const theme = ctx.ui.theme;
  const elapsed = formatElapsed(goalElapsedSeconds(ctx, goal));
  const phase = phaseFor(goal);
  const title = phase?.title ?? goalTitle(goal);
  const head = theme.fg(phase ? "accent" : goalColor(goal), `${title} · ◷ ${elapsed}`);
  const work = `  ↳ ${truncate(phase?.detail ?? displayWorkItem(goal), 120)}`;
  const subagents = subagentLine();
  const checklistIcon = phase ? "✓" : "☑";
  const checklist = goal.subtasks.length
    ? `  ${checklistIcon} ${checklistSummaryText(goal)}`
    : undefined;
  return [head, work, subagents, checklist].filter((line): line is string => Boolean(line));
}

function displayWorkItem(goal: GoalState): string {
  if (goal.status === "setup") return goal.intent;
  if (goal.status === "complete") return activeObjective(goal);
  return currentWorkItem(goal);
}

function phaseFor(goal: GoalState): GoalUiPhase | null {
  return activePhase?.goalId === goal.id ? activePhase : null;
}

function goalTitle(goal: GoalState): string {
  const slice = goal.currentSlice ? ` · slice ${goal.currentSlice.id}` : "";
  return `${goalMarker(goal)} ${goalVerb(goal)}${slice}`;
}

function goalMarker(goal: GoalState): string {
  if (goal.status === "complete") return "✓";
  if (goal.status === "paused") return "Ⅱ";
  if (goal.status === "setup") return "◇";
  return "●";
}

function goalVerb(goal: GoalState): string {
  if (goal.status === "complete") return "Done";
  if (goal.status === "paused") return "Paused";
  if (goal.status === "setup") return "Setup";
  return "Working";
}

function goalColor(goal: GoalState): "success" | "warning" | "accent" {
  if (goal.status === "complete") return "success";
  if (goal.status === "paused" || goal.status === "setup") return "warning";
  return "accent";
}

function startStatusRefresh(ctx: ExtensionContext): void {
  refreshCtx = ctx;
  setDashboardActive(true);
  if (statusRefreshTimer) return;
  statusRefreshTimer = setInterval(() => {
    try {
      if (!refreshCtx?.hasUI) return;
      const goal = readGoalState(refreshCtx);
      renderGoalUi(refreshCtx, goal);
      setDashboardActive(Boolean(goal && goal.status !== "complete"));
      if (!goal || goal.status === "complete") stopStatusRefresh();
    } catch {
      // UI refresh is best-effort.
    }
  }, 1000);
}

function stopStatusRefresh(): void {
  if (statusRefreshTimer) clearInterval(statusRefreshTimer);
  statusRefreshTimer = undefined;
  refreshCtx = undefined;
}

function setDashboardActive(active: boolean): void {
  (globalThis as { __piGoalDashboardActive?: boolean }).__piGoalDashboardActive = active;
}

function subagentLine(): string | undefined {
  const runs = activeSubagents();
  if (runs.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const run of runs) {
    const model = run.model ?? "model?";
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  const chips = Array.from(counts, ([model, count]) => `${model}×${count}`);
  return `  ⎇ ${runs.length} · ${truncate(chips.join(" · "), 96)}`;
}

function activeSubagents(): Array<{ model?: string }> {
  const data = (
    globalThis as {
      __piGoalDashboardSubagents?: { runs?: Array<{ model?: string }> };
    }
  ).__piGoalDashboardSubagents;
  return Array.isArray(data?.runs) ? data.runs : [];
}

// UI-only time accounting. This is intentionally derived from session entry
// timestamps and never written into GoalState, prompts, tool results, or branch
// summaries visible to the model.
function goalElapsedSeconds(ctx: ExtensionContext, goal: GoalState): number {
  const entries = ctx.sessionManager.getEntries();
  let total = 0;
  let startedAt: number | null = null;
  let lastAssistantAt: number | null = null;

  const closeTurn = () => {
    if (startedAt === null) return;
    if (lastAssistantAt !== null) total += Math.max(0, lastAssistantAt - startedAt);
    else if (!ctx.isIdle()) total += Math.max(0, nowSeconds() - startedAt);
    startedAt = null;
    lastAssistantAt = null;
  };

  for (const entry of entries) {
    if (isGoalTurnStart(entry, goal.id)) {
      closeTurn();
      startedAt = entrySeconds(entry);
      lastAssistantAt = null;
      continue;
    }
    if (startedAt !== null && isAssistantEntry(entry)) lastAssistantAt = entrySeconds(entry);
  }

  closeTurn();
  return total;
}

function isGoalTurnStart(entry: unknown, goalId: string): boolean {
  const item = entry as {
    type?: unknown;
    customType?: unknown;
    details?: { goalId?: unknown };
  };
  return (
    item.type === "custom_message" &&
    (item.customType === GOAL_SETUP_MESSAGE_TYPE ||
      item.customType === GOAL_WORK_ORDER_MESSAGE_TYPE) &&
    item.details?.goalId === goalId
  );
}

function isAssistantEntry(entry: unknown): boolean {
  const item = entry as { type?: unknown; message?: { role?: unknown } };
  return item.type === "message" && item.message?.role === "assistant";
}

function entrySeconds(entry: unknown): number {
  const item = entry as { timestamp?: unknown; message?: { timestamp?: unknown } };
  return timestampSeconds(item.timestamp ?? item.message?.timestamp) ?? nowSeconds();
}

function timestampSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return Math.floor(ms / 1000);
  }
  return null;
}
