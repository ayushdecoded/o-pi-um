import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  GOAL_ROLLUP_MESSAGE_TYPE,
  GOAL_SETUP_MESSAGE_TYPE,
  GOAL_STATUS_KEY,
  GOAL_WORK_ORDER_MESSAGE_TYPE,
} from "../domain/constants.ts";
import {
  activeObjective,
  currentTasks,
  currentWorkItem,
  nowSeconds,
  readGoalState,
} from "../domain/state.ts";
import type { GoalState } from "../domain/types.ts";
import { formatElapsed, truncate } from "./format.ts";
import { goalOwnerLabel } from "./names.ts";
import { taskSummaryText } from "./text.ts";

type GoalUiPhase = { goalId: string; title: string; detail: string };
type DashboardSubagentRun = { task?: string; model?: string; startedAt?: number };

let renderCtx: ExtensionContext | undefined;
let activePhase: GoalUiPhase | null = null;
let dashboardSubagentRuns: DashboardSubagentRun[] = [];
let publishDashboardActive: (active: boolean) => void = () => {};
let dashboardActive = false;
let renderedStatus: string | undefined;
let renderedWidget: string | undefined;

export function registerGoalDashboardEvents(pi: Pick<ExtensionAPI, "events">): void {
  publishDashboardActive = (active) => pi.events.emit("goal-dashboard:active", { active });
  pi.events.on("subagent:active", (data) => {
    dashboardSubagentRuns = parseSubagentRuns(data);
    if (renderCtx?.hasUI) renderGoalUi(renderCtx, readGoalState(renderCtx));
  });
}

export function activeSubagentRuns(): DashboardSubagentRun[] {
  return dashboardSubagentRuns;
}

export function setGoalUiPhase(goalId: string, title?: string, detail?: string): void {
  activePhase = title && detail ? { goalId, title, detail } : null;
}

export function updateGoalUi(ctx: ExtensionContext, goal: GoalState | null): void {
  try {
    if (!ctx.hasUI) return;
    renderGoalUi(ctx, goal);
    setDashboardActive(Boolean(goal && goal.status !== "complete"));
  } catch {
    // UI is best-effort.
  }
}

export async function showGoalStatus(ctx: ExtensionContext, goal: GoalState | null): Promise<void> {
  ctx.ui.notify(goalPanelPlaintext(goal), goal ? "info" : "warning");
}

export function goalPanelPlaintext(goal: GoalState | null): string {
  if (!goal) return "No active Goal. Start one with /goal <intent>.";
  const tasks = currentTasks(goal);
  return [
    `${goalOwnerLabel(goal)}: ${goal.status}`,
    `Intent: ${goal.intent}`,
    goal.contract ? `Contract: ${goal.contract}` : undefined,
    `Objective: ${activeObjective(goal)}`,
    goal.currentSlice
      ? `Current slice: s${goal.currentSlice.id} ${goal.currentSlice.name}`
      : undefined,
    goal.lastSummaryEntryId ? `Last summary: ${goal.lastSummaryEntryId}` : undefined,
    goal.blockedDetail ? `Blocked: ${goal.blockedDetail}` : undefined,
    tasks.length ? taskSummaryText(goal) : "Tasks: none yet",
    ...tasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${item.name}`),
    goal.plannedSlices.length ? "Queued slices:" : undefined,
    ...goal.plannedSlices.map(
      (item) => `- ${item.name}${item.objective ? `: ${item.objective}` : ""}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

function renderGoalUi(ctx: ExtensionContext, goal: GoalState | null): void {
  renderCtx = ctx;
  if (!goal) {
    if (renderedStatus !== undefined) ctx.ui.setStatus(GOAL_STATUS_KEY, undefined);
    if (renderedWidget !== undefined) ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
    renderedStatus = undefined;
    renderedWidget = undefined;
    return;
  }

  const status = statusLine(ctx, goal);
  if (status !== renderedStatus) {
    ctx.ui.setStatus(GOAL_STATUS_KEY, status);
    renderedStatus = status;
  }

  const lines = goalWidgetLines(ctx, goal);
  const widget = lines.join("\n");
  if (widget !== renderedWidget) {
    ctx.ui.setWidget(GOAL_STATUS_KEY, lines, { placement: "aboveEditor" });
    renderedWidget = widget;
  }
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
  const queued = queuedSlicesLine(goal);
  const tasks = currentTasks(goal);
  const taskLine = tasks.length ? `  ${phase ? "✓" : "☑"} ${taskSummaryText(goal)}` : undefined;
  return [head, work, queued, subagents, taskLine].filter((line): line is string => Boolean(line));
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
  const slice = goal.currentSlice ? ` · s${goal.currentSlice.id} ${goal.currentSlice.name}` : "";
  const owner = goalOwnerLabel(goal);
  const prefix = owner === "Goal" ? "" : `${owner} `;
  return `${goalMarker(goal)} ${prefix}${goalVerb(goal)}${slice}`;
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

function setDashboardActive(active: boolean): void {
  if (active === dashboardActive) return;
  dashboardActive = active;
  publishDashboardActive(active);
}

function queuedSlicesLine(goal: GoalState): string | undefined {
  const next = goal.plannedSlices[0];
  if (!next) return undefined;
  const rest = Math.max(0, goal.plannedSlices.length - 1);
  return `  → next ${truncate(next.name, 72)}${rest ? ` · +${rest}` : ""}`;
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
  return dashboardSubagentRuns;
}

function parseSubagentRuns(data: unknown): DashboardSubagentRun[] {
  const runs = (data as { runs?: unknown }).runs;
  if (!Array.isArray(runs)) return [];
  return runs.flatMap((run) => {
    if (!run || typeof run !== "object") return [];
    const item = run as Record<string, unknown>;
    return [
      {
        task: typeof item.task === "string" ? item.task : undefined,
        model: typeof item.model === "string" ? item.model : undefined,
        startedAt: typeof item.startedAt === "number" ? item.startedAt : undefined,
      },
    ];
  });
}

// UI-only time accounting. This is intentionally derived from visible goal turn
// timestamps and never written into model-visible task state.
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
    if (startedAt !== null && isTurnCompletionEntry(entry)) lastAssistantAt = entrySeconds(entry);
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
      item.customType === GOAL_WORK_ORDER_MESSAGE_TYPE ||
      item.customType === GOAL_ROLLUP_MESSAGE_TYPE) &&
    item.details?.goalId === goalId
  );
}

function isTurnCompletionEntry(entry: unknown): boolean {
  const item = entry as { type?: unknown; message?: { role?: unknown } };
  return (
    (item.type === "message" && item.message?.role === "assistant") ||
    item.type === "branch_summary"
  );
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
