import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import { activeObjective, goalMetrics, isApprovedGoal } from "../domain/state.ts";
import type { GoalModelOverride, GoalState } from "../domain/types.ts";
import { formatElapsed, formatTokens } from "./format.ts";
import { checklistSummaryText } from "./text.ts";
import { exactGoalTokensSoFar, statusLabel } from "./statusline.ts";

// Detailed status views for `/goal` and `/goal status`.
export async function showGoalStatus(
  ctx: ExtensionContext,
  goal: GoalState | null,
  pendingModelOverride?: GoalModelOverride,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(goalPanelPlaintext(goal, pendingModelOverride), goal ? "info" : "warning");
    return;
  }
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let scroll = 0;
      const previewHeight = 18;
      const md = new Markdown(
        goalStatusMarkdown(goal, pendingModelOverride),
        0,
        0,
        getMarkdownTheme(),
      );
      const bg = (text: string) => theme.bg("customMessageBg", text);
      const pad = (line: string, width: number) => {
        const clipped = line.replace(/\r/g, "");
        const padded = `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
        return bg(padded);
      };
      const border = (width: number) =>
        bg(theme.fg("accent", `╭${"─".repeat(Math.max(0, width - 2))}╮`));
      const bottom = (width: number) =>
        bg(theme.fg("accent", `╰${"─".repeat(Math.max(0, width - 2))}╯`));
      return {
        render(width: number) {
          const panelWidth = Math.max(62, width);
          const innerWidth = Math.max(40, panelWidth - 8);
          const lines = md.render(innerWidth);
          const maxScroll = Math.max(0, lines.length - previewHeight);
          scroll = Math.min(scroll, maxScroll);
          const shown = lines.slice(scroll, scroll + previewHeight);
          while (shown.length < previewHeight) shown.push("");
          const info =
            maxScroll > 0
              ? theme.fg(
                  "dim",
                  ` · ${scroll + 1}-${Math.min(lines.length, scroll + previewHeight)}/${lines.length}`,
                )
              : "";
          const title = `${theme.fg("accent", theme.bold("Goal Status"))}${info}`;
          const help = theme.fg(
            "dim",
            maxScroll > 0 ? "↑↓ PgUp/PgDn scroll · any key closes" : "any key closes",
          );
          return [
            border(panelWidth),
            pad(`│  ${title}`, panelWidth - 1) + bg(theme.fg("accent", "│")),
            pad(`│  ${help}`, panelWidth - 1) + bg(theme.fg("accent", "│")),
            pad("│", panelWidth - 1) + bg(theme.fg("accent", "│")),
            ...shown.map((line) => pad(`│  ${line}`, panelWidth - 1) + bg(theme.fg("accent", "│"))),
            pad("│", panelWidth - 1) + bg(theme.fg("accent", "│")),
            pad(`│  ${help}`, panelWidth - 1) + bg(theme.fg("accent", "│")),
            bottom(panelWidth),
          ];
        },
        invalidate() {
          md.invalidate();
        },
        handleInput(data: string) {
          if (matchesKey(data, "down")) scroll += 1;
          else if (matchesKey(data, "up")) scroll = Math.max(0, scroll - 1);
          else if (matchesKey(data, "pageDown")) scroll += previewHeight;
          else if (matchesKey(data, "pageUp")) scroll = Math.max(0, scroll - previewHeight);
          else if (data) return done(undefined);
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "78%",
        minWidth: 72,
        maxHeight: "82%",
        anchor: "center",
      },
    },
  );
}

export function goalPanelPlaintext(
  goal: GoalState | null,
  pendingModelOverride?: GoalModelOverride,
): string {
  if (!goal) {
    return pendingModelOverride
      ? `No active goal.\n\n**Goal model:** ${pendingModelOverride.model}${pendingModelOverride.thinking ? ` (${pendingModelOverride.thinking})` : ""}\n\nStart one with \`/goal <intent>\`.`
      : "No active goal.\n\nStart one with `/goal <intent>`.";
  }
  return [
    `Goal: ${statusLabel(goal.status)}`,
    `Intent: ${goal.intent}`,
    `Objective: ${activeObjective(goal)}`,
    `Time used: ${formatElapsed(goal.timeUsedSeconds)}`,
    `Tokens used: ${formatTokens(goal.tokensUsed)}`,
    goal.tokenBudget !== null ? `Token budget: ${formatTokens(goal.tokenBudget)}` : undefined,
    goal.timeBudgetSeconds != null
      ? `Time budget: ${formatElapsed(goal.timeBudgetSeconds)}`
      : undefined,
    goal.turnBudget != null ? `Turn budget: ${goal.turnsUsed ?? 0}/${goal.turnBudget}` : undefined,
    goal.costBudgetUsd != null
      ? `Cost budget: $${(goal.costUsedUsd ?? 0).toFixed(4)}/$${goal.costBudgetUsd.toFixed(4)}`
      : undefined,
    goal.metrics
      ? `Runtime: ${goal.metrics.toolCalls} tools, ${goal.metrics.continuationsStarted} continuations`
      : undefined,
    goal.blockedReason
      ? `Blocked: ${goal.blockedReason === "waiting_on_user" ? "waiting on user" : "no progress"}`
      : undefined,
    goal.subtasks?.length ? `Checklist: ${checklistSummaryText(goal)}` : undefined,
    ...(goal.subtasks?.length
      ? [
          "Tracked checklist:",
          ...goal.subtasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${item.title}`),
        ]
      : []),
    goal.modelOverride
      ? `Goal model: ${goal.modelOverride.model}${goal.modelOverride.thinking ? ` (${goal.modelOverride.thinking})` : ""}`
      : undefined,
    "",
    goal.status === "active"
      ? "Commands: /goal pause, /goal resume, /goal clear"
      : goal.status === "paused"
        ? "Commands: /goal resume, /goal clear"
        : "Commands: /goal clear",
  ]
    .filter(Boolean)
    .join("\n");
}

export function goalStatusMarkdown(
  goal: GoalState | null,
  pendingModelOverride?: GoalModelOverride,
): string {
  if (!goal) {
    return pendingModelOverride
      ? `No active goal.\n\n**Goal model:** ${pendingModelOverride.model}${pendingModelOverride.thinking ? ` (${pendingModelOverride.thinking})` : ""}\n\nStart one with \`/goal <intent>\`.`
      : "No active goal.\n\nStart one with `/goal <intent>`.";
  }
  const budgetLines = [
    `- Time: ${formatElapsed(goal.timeUsedSeconds)}${goal.timeBudgetSeconds != null ? ` / ${formatElapsed(goal.timeBudgetSeconds)}` : ""}`,
    `- Tokens: ${formatTokens(exactGoalTokensSoFar(goal))}${goal.tokenBudget !== null ? ` / ${formatTokens(goal.tokenBudget)}` : ""}`,
    goal.turnBudget != null ? `- Turns: ${goal.turnsUsed ?? 0} / ${goal.turnBudget}` : undefined,
    goal.costBudgetUsd != null
      ? `- Cost: $${(goal.costUsedUsd ?? 0).toFixed(4)} / $${goal.costBudgetUsd.toFixed(4)}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const checklist = goal.subtasks?.length
    ? [
        `## Checklist`,
        checklistSummaryText(goal),
        "",
        ...goal.subtasks.map((item) => `- ${item.completed ? "[x]" : "[ ]"} ${item.title}`),
      ].join("\n")
    : "## Checklist\nNo tracked subtasks yet.";
  return [
    `# ${statusLabel(goal.status)}`,
    "",
    `**Intent:** ${goal.intent}`,
    `\n## Objective\n${activeObjective(goal)}`,
    "## Budget",
    budgetLines,
    goal.metrics
      ? `\n## Runtime\n- Tools: ${goal.metrics.toolCalls}\n- Continuations: ${goal.metrics.continuationsStarted}`
      : "",
    goal.blockedReason
      ? `\n## Blocked\n${goal.blockedReason === "waiting_on_user" ? "Waiting on user" : "No progress"}${goal.blockedDetail ? `: ${goal.blockedDetail}` : ""}`
      : "",
    checklist,
    (goal.objectives?.length ?? 0) > 1
      ? `\n## Objectives\n${goal.objectives.map((obj, i) => `- ${i === goal.currentObjectiveIndex ? "→" : " "} [${i}] ${obj}`).join("\n")}`
      : "",
    goal.modelOverride
      ? `\n## Model\n${goal.modelOverride.model}${goal.modelOverride.thinking ? ` (${goal.modelOverride.thinking})` : ""}`
      : "",
    goal.subTurns?.length
      ? `\n## Sub-turns (most recent goal turn)\n${goal.subTurns.map((st) => `- Turn ${st.index}: ${formatTokens(st.tokens)} tokens, ${st.tools} tools`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
