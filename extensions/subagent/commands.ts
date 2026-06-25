import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { activeRuns } from "./runtime.ts";

export function registerSubagentCommands(pi: ExtensionAPI): void {
  pi.registerCommand("agents", {
    description: "Show active subagent details",
    handler: async (_args, ctx) => withCommandErrors(ctx, async () => showSubagentDetails(ctx)),
  });
}

async function showSubagentDetails(ctx: ExtensionContext): Promise<void> {
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
            const dur = Math.max(0, Math.round((now - run.startedAt) / 1000));
            const durStr = dur >= 120 ? `${Math.floor(dur / 60)}m${dur % 60}s` : `${dur}s`;
            return `${run.model ?? "model?"} · ${durStr} · ${run.task}`;
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

async function withCommandErrors(ctx: ExtensionContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    ctx.ui.notify(`Subagent command failed: ${errorMessage(error)}`, "error");
  }
}

function activeSubagents(): Array<{ task: string; model?: string; startedAt: number }> {
  return Array.from(activeRuns.values()).map((run) => ({
    task: run.task,
    model: run.model,
    startedAt: run.startedAt,
  }));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
