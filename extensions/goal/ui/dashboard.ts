import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { GOAL_STATUS_KEY } from "../domain/constants.ts";
import { activeObjective, isApprovedGoal, nowSeconds } from "../domain/state.ts";
import type { GoalState, GoalStatus } from "../domain/types.ts";
import { goalRef, readGoal } from "../runtime/store.ts";
import { formatElapsed, formatTokens, truncate } from "./format.ts";
import { checklistSummaryText } from "./text.ts";
import { statusLine, statusLabel } from "./statusline.ts";
import { liveElapsedBaseline, runtime } from "../core/runtime.ts";

let statusRefreshTimer: ReturnType<typeof setInterval> | undefined;
let completionClearTimer: ReturnType<typeof setTimeout> | undefined;

// Dashboard/widget/statusline rendering. It reads runtime counters but never mutates durable goal state.
export function updateGoalUi(ctx: ExtensionContext, goal: GoalState | null): void {
  try {
    if (!ctx.hasUI) return;
    if (!goal) {
      stopStatusRefresh();
      (
        globalThis as { __piGoalDashboardActive?: boolean }
      ).__piGoalDashboardActive = false;
      ctx.ui.setStatus(GOAL_STATUS_KEY, undefined);
      ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(GOAL_STATUS_KEY, statusLine(ctx, goal));
    if (goal.status === "complete" && runtime.completedThisTurnGoalId !== goal.id) {
      stopStatusRefresh();
      (
        globalThis as { __piGoalDashboardActive?: boolean }
      ).__piGoalDashboardActive = false;
      ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
      return;
    }
    (
      globalThis as { __piGoalDashboardActive?: boolean }
    ).__piGoalDashboardActive = true;
    ctx.ui.setWidget(GOAL_STATUS_KEY, goalWidget(ctx, goal), {
      placement: "aboveEditor",
    });
    if (
      goal.status === "active" ||
      !isApprovedGoal(goal) ||
      runtime.completedThisTurnGoalId === goal.id
    )
      startStatusRefresh(ctx);
    else stopStatusRefresh();
  } catch {
    // UI updates are best-effort, especially for print/json/resumed CLI sessions.
  }
}

function goalWidget(ctx: ExtensionContext, goal: GoalState) {
  return () => ({
    render: (width: number) =>
      goalDashboardLines(ctx, goal, width).map((line) =>
        clampWidgetLine(resetDim(line), width),
      ),
    invalidate: () => {},
  });
}

function resetDim(line: string): string {
  return `\x1b[22m${line}\x1b[22m`;
}

function clampWidgetLine(line: string, width: number): string {
  let out = truncateToWidth(line, Math.max(1, width), "…");
  while (visibleWidth(out) > width && out.length > 0) out = out.slice(0, -1);
  return out;
}

function goalDashboardLines(
  ctx: ExtensionContext,
  goal: GoalState,
  width: number,
): string[] {
  if (width < 72) return compactGoalDashboardLines(ctx, goal, width);
  const leftWidth = Math.max(
    34,
    Math.min(Math.floor(width * 0.56), width - 28),
  );
  const rightWidth = Math.max(0, width - leftWidth - 3);
  const left = goalDashboardLeft(ctx, goal, leftWidth);
  const right = rightWidth > 20 ? subagentDashboardRight(ctx, rightWidth) : [];
  const rows = Math.max(left.length, right.length, 1);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    lines.push(
      fitAnsi(rightWidth > 20 ? `${padAnsi(l, leftWidth)}   ${r}` : l, width),
    );
  }
  return lines;
}

function compactGoalDashboardLines(
  ctx: ExtensionContext,
  goal: GoalState,
  width: number,
): string[] {
  const theme = ctx.ui.theme;
  const liveSeconds = liveGoalSeconds(goal);
  const title = goalTitleLine(theme, goal, liveSeconds, width);
  const objective = truncate(activeObjective(goal), Math.max(12, width - 2));
  const subagents = plainSubagentSummary(width);
  return [title, `  ${objective}`, subagents]
    .filter((line): line is string => Boolean(line))
    .map((line) => truncateToWidth(line, width, "…"));
}

function goalDashboardLeft(
  ctx: ExtensionContext,
  goal: GoalState,
  width: number,
): string[] {
  const theme = ctx.ui.theme;
  const liveSeconds = liveGoalSeconds(goal);
  const objective = truncate(activeObjective(goal), Math.max(20, width - 4));
  const checklist = goal.subtasks?.length
    ? truncateToWidth(
        `Checklist: ${checklistSummaryText(goal)}`,
        Math.max(20, width - 2),
        "…",
      )
    : undefined;
  const title = goalTitleLine(theme, goal, liveSeconds, width);
  return [
    title,
    fgFit(theme, "text", `  ${objective}`, width),
    checklist ? fgFit(theme, "text", `  ${checklist}`, width) : undefined,
  ].filter((line): line is string => Boolean(line));
}

function goalTitleLine(
  theme: ExtensionContext["ui"]["theme"],
  goal: GoalState,
  liveSeconds: number,
  width: number,
): string {
  let color: "success" | "warning" | "accent" = "accent";
  let text: string;
  if (goal.status === "complete") {
    color = "success";
    text = `✓ Goal complete · ${formatTokens(goal.tokensUsed)} tokens · ${formatElapsed(goal.timeUsedSeconds)}`;
  } else if (goal.blockedReason === "budget_limited") {
    color = "warning";
    text = `⚠ Goal budget reached · ${tokenUsageLabel(goal)} · ${formatElapsed(goal.timeUsedSeconds)}`;
  } else if (goal.status === "paused") {
    text = `Ⅱ Goal paused · ${tokenUsageLabel(goal)} · ${formatElapsed(goal.timeUsedSeconds)}`;
  } else if (!isApprovedGoal(goal)) {
    color = "warning";
    text = "◇ Goal setup · waiting for contract approval";
  } else if (goal.blockedReason === "waiting_on_user") {
    color = "warning";
    text = `? Goal needs input · ${formatElapsed(liveSeconds)} · reply below`;
  } else {
    const moreObjectives = Math.max(0, (goal.objectives?.length ?? 1) - 1);
    const objBadge = moreObjectives > 0 ? ` +${moreObjectives}obj` : "";
    text = `● Pursuing goal · ${tokenUsageLabel(goal)}${objBadge} · ${formatElapsed(liveSeconds)}`;
  }
  return fgFit(theme, color, text, width);
}

function subagentDashboardRight(
  ctx: ExtensionContext,
  width: number,
): string[] {
  const theme = ctx.ui.theme;
  const runs = activeDashboardSubagents();
  if (runs.length === 0) return [];
  // Count subagents per model, grouped by full model name
  const counts = new Map<string, number>();
  for (const run of runs) {
    const model = run.model ?? "model?";
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  // Build aggregated chips: "model×count"
  const chips: string[] = [];
  for (const [model, count] of counts) {
    chips.push(`${model}×${count}`);
  }
  // Pack chips below header line
  const usable = Math.max(16, width - 2);
  const lines: string[] = [
    fgFit(theme, "accent", `subagents · ${runs.length} active`, width),
  ];
  let current = "";
  for (const chip of chips) {
    const would = current ? `${current} · ${chip}` : chip;
    if (visibleWidth(would) <= usable) {
      current = would;
    } else if (current) {
      lines.push(fgFit(theme, "text", `  ${current}`, width));
      current = chip;
    } else {
      lines.push(fgFit(theme, "text", `  ${truncate(chip, usable)}`, width));
      current = "";
    }
  }
  if (current) lines.push(fgFit(theme, "text", `  ${current}`, width));
  return lines.slice(0, 3);
}

function plainSubagentSummary(width: number): string | undefined {
  const runs = activeDashboardSubagents();
  if (runs.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const run of runs)
    counts.set(
      run.model ?? "model?",
      (counts.get(run.model ?? "model?") ?? 0) + 1,
    );
  const chips = Array.from(counts, ([model, count]) => `${model}×${count}`);
  return truncateToWidth(
    `subagents · ${runs.length} · ${chips.join(" · ")}`,
    width,
    "…",
  );
}

function activeDashboardSubagents(): Array<{
  id?: string;
  task?: string;
  model?: string;
  startedAt?: number;
}> {
  const data = (
    globalThis as {
      __piGoalDashboardSubagents?: {
        runs?: Array<{
          id?: string;
          task?: string;
          model?: string;
          startedAt?: number;
        }>;
      };
    }
  ).__piGoalDashboardSubagents;
  return Array.isArray(data?.runs) ? data.runs : [];
}

function fgFit(
  theme: ExtensionContext["ui"]["theme"],
  color: string,
  text: string,
  width: number,
): string {
  return theme.fg(color, truncateToWidth(text, Math.max(1, width), "…"));
}

function fitAnsi(value: string, width: number): string {
  return truncateToWidth(value, Math.max(1, width), "…");
}

function padAnsi(value: string, width: number): string {
  const fitted = fitAnsi(value, width);
  const len = visibleWidth(fitted);
  return len >= width ? fitted : fitted + " ".repeat(width - len);
}

function startStatusRefresh(ctx: ExtensionContext): void {
  if (!ctx.hasUI || statusRefreshTimer) return;
  statusRefreshTimer = setInterval(async () => {
    try {
      const goal = await readGoal(goalRef(ctx));
      if (
        !goal ||
        (goal.status !== "active" &&
          isApprovedGoal(goal) &&
          runtime.completedThisTurnGoalId !== goal.id)
      ) {
        stopStatusRefresh();
        if (!goal) ctx.ui.setStatus(GOAL_STATUS_KEY, undefined);
        (
          globalThis as { __piGoalDashboardActive?: boolean }
        ).__piGoalDashboardActive = false;
        ctx.ui.setWidget(GOAL_STATUS_KEY, undefined);
        return;
      }
      (
        globalThis as { __piGoalDashboardActive?: boolean }
      ).__piGoalDashboardActive = true;
      ctx.ui.setStatus(GOAL_STATUS_KEY, statusLine(ctx, goal));
      ctx.ui.setWidget(GOAL_STATUS_KEY, goalWidget(ctx, goal), {
        placement: "aboveEditor",
      });
    } catch {
      // UI refresh is best-effort; never break agent work because the status line failed.
    }
  }, 1000);
}

export function stopStatusRefresh(): void {
  if (!statusRefreshTimer) return;
  clearInterval(statusRefreshTimer);
  statusRefreshTimer = undefined;
}

export function clearCompletionBannerTimer(): void {
  if (completionClearTimer) clearTimeout(completionClearTimer);
  completionClearTimer = undefined;
}

export function scheduleCompletionBannerClear(
  ctx: ExtensionContext,
  goalId: string,
): void {
  if (!ctx.hasUI) return;
  if (completionClearTimer) clearTimeout(completionClearTimer);
  completionClearTimer = setTimeout(async () => {
    try {
      if (runtime.completedThisTurnGoalId !== goalId) return;
      runtime.completedThisTurnGoalId = null;
      const goal = await readGoal(goalRef(ctx));
      updateGoalUi(ctx, goal);
    } catch {
      // Best-effort UI cleanup.
    }
  }, 45_000);
}

