import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import { HEADLESS_AUTO_APPROVE_ENV } from "../domain/constants.ts";
import { truncate } from "./format.ts";

export async function showSubagentDetails(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("UI not available", "error");
    return;
  }
  const runs = activeSubagents();
  if (runs.length === 0) {
    ctx.ui.notify("No active subagents", "info");
    return;
  }
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const bg = (text: string) => theme.bg("customMessageBg", text);
      const pad = (line: string, width: number) => {
        const clipped = line.replace(/\r/g, "");
        return bg(`${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`);
      };
      const border = (w: number) =>
        bg(theme.fg("accent", `╭${String("─").repeat(Math.max(0, w - 2))}╮`));
      const bottom = (w: number) =>
        bg(theme.fg("accent", `╰${String("─").repeat(Math.max(0, w - 2))}╯`));
      const refreshInterval = setInterval(() => tui.requestRender(), 2000);
      const line = (s: string, pw: number) =>
        pad(`│  ${truncate(s, Math.max(20, pw - 12))}`, pw - 1) + bg(theme.fg("accent", "│"));
      return {
        render(width: number) {
          const pw = Math.max(52, width);
          const now = Date.now();
          const rows = activeSubagents().map((run) => {
            const dur = Math.max(0, Math.round((now - (run.startedAt ?? now)) / 1000));
            const durStr = dur >= 120 ? `${Math.floor(dur / 60)}m${dur % 60}s` : `${dur}s`;
            return `${run.model ?? "model?"} · ${durStr} · ${run.task ?? "subagent"}`;
          });
          const help = theme.fg("dim", "any key to close · auto-refreshes");
          return [
            border(pw),
            line(theme.fg("accent", `Active subagents (${rows.length})`), pw),
            line(help, pw),
            pad("│", pw - 1) + bg(theme.fg("accent", "│")),
            ...rows.map((row) => line(row, pw)),
            pad("│", pw - 1) + bg(theme.fg("accent", "│")),
            line(help, pw),
            bottom(pw),
          ];
        },
        invalidate() {},
        handleInput(data: string) {
          if (!data) return;
          clearInterval(refreshInterval);
          done(undefined);
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "72%",
        minWidth: 64,
        maxHeight: "70%",
        anchor: "center",
      },
    },
  );
}

export function goalHelpText(): string {
  return [
    "/goal <intent>",
    "/goal status",
    "/goal pause",
    "/goal resume",
    "/goal clear",
    "/agents",
    "",
    "/goal starts with contract setup. After approval, Goal runs one visible work slice at a time and rolls each completed slice into a compact Pi branch summary.",
    `Headless tests: set ${HEADLESS_AUTO_APPROVE_ENV}=1 to allow contract activation without UI.`,
  ].join("\n");
}

function activeSubagents(): Array<{ task?: string; model?: string; startedAt?: number }> {
  const data = (
    globalThis as {
      __piGoalDashboardSubagents?: {
        runs?: Array<{ task?: string; model?: string; startedAt?: number }>;
      };
    }
  ).__piGoalDashboardSubagents;
  return Array.isArray(data?.runs) ? data.runs : [];
}
