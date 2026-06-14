import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import type { GoalState } from "../domain/types.ts";
import { truncate } from "./format.ts";

// The only modal approval step: setup contract -> active goal.
export function goalContractPreviewLines(
  ctx: ExtensionContext,
  goal: GoalState,
  objective: string,
): string[] {
  const theme = ctx.ui.theme;
  return [
    theme.fg("warning", "◇ Activate goal contract?") +
      theme.fg("dim", " · enter selects Yes, esc cancels"),
    theme.fg("dim", `  Intent: ${truncate(goal.intent, 100)}`),
    ...previewLines(objective, 3).map((line, index) =>
      theme.fg(index === 0 ? "toolOutput" : "dim", `  ${line}`),
    ),
  ];
}

export async function approveGoalContract(
  ctx: ExtensionContext,
  goal: GoalState,
  objective: string,
): Promise<boolean> {
  return await ctx.ui.custom<boolean>(
    (tui, theme, _keybindings, done) => {
      let scroll = 0;
      const previewHeight = 16;
      const markdown = goalContractMarkdown(goal, objective);
      const md = new Markdown(markdown, 0, 0, getMarkdownTheme());
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
          const panelWidth = Math.max(58, width);
          const innerWidth = Math.max(36, panelWidth - 8);
          const lines = md.render(innerWidth);
          const maxScroll = Math.max(0, lines.length - previewHeight);
          scroll = Math.min(scroll, maxScroll);
          const shown = lines.slice(scroll, scroll + previewHeight);
          while (shown.length < previewHeight) shown.push("");
          const info =
            maxScroll > 0
              ? theme.fg(
                  "dim",
                  ` showing ${scroll + 1}-${Math.min(lines.length, scroll + previewHeight)} of ${lines.length}`,
                )
              : "";
          const title = `${theme.fg("accent", theme.bold("Goal Contract Review"))}${theme.fg("dim", " · setup → active after approval")}${info}`;
          const help = `${theme.fg("dim", "scroll")} ↑↓ PgUp/PgDn   ${theme.fg("success", theme.bold("approve"))} Y/Enter   ${theme.fg("warning", theme.bold("cancel"))} N/Esc`;
          return [
            border(panelWidth),
            pad(`│  ${title}`, panelWidth - 1) + bg(theme.fg("accent", "│")),
            pad(
              `│  ${theme.fg("muted", truncate(goal.intent, Math.max(20, innerWidth - 8)))}`,
              panelWidth - 1,
            ) + bg(theme.fg("accent", "│")),
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
          if (matchesKey(data, "enter") || data.toLowerCase() === "y") return done(true);
          if (
            matchesKey(data, "escape") ||
            matchesKey(data, "ctrl+c") ||
            data.toLowerCase() === "n"
          )
            return done(false);
          if (matchesKey(data, "down")) scroll += 1;
          else if (matchesKey(data, "up")) scroll = Math.max(0, scroll - 1);
          else if (matchesKey(data, "pageDown")) scroll += previewHeight;
          else if (matchesKey(data, "pageUp")) scroll = Math.max(0, scroll - previewHeight);
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

function goalContractMarkdown(goal: GoalState, objective: string): string {
  return [
    "**Approve only if this matches what you want the autonomous goal runner to do.**",
    "",
    "## Contract",
    objective,
  ].join("\n");
}

function previewLines(value: string, maxLines: number): string[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const shown = lines
    .slice(0, maxLines)
    .map((line) => truncate(line.replace(/^[-*#\d.)\s]+/, ""), 110));
  if (lines.length > maxLines) shown.push(`… ${lines.length - maxLines} more lines`);
  return shown.length ? shown : [truncate(value, 110)];
}
