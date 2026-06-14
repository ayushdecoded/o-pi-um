import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

import { HEADLESS_AUTO_APPROVE_ENV } from "../domain/constants.ts";
import { truncate } from "./format.ts";

// Small interactive overlays used by slash commands.
export async function showSubagentDetails(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("UI not available", "error");
    return;
  }
  const data = (
    globalThis as {
      __piGoalDashboardSubagents?: {
        runs?: Array<{
          id?: string;
          task?: string;
          model?: string;
          startedAt?: number;
          status?: string;
        }>;
      };
    }
  ).__piGoalDashboardSubagents;
  const runs = Array.isArray(data?.runs) ? data.runs : [];
  if (runs.length === 0) {
    ctx.ui.notify("No active subagents", "info");
    return;
  }
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const bg = (text: string) => theme.bg("customMessageBg", text);
      const pad = (line: string, width: number) => {
        const clipped = line.replace(/\r/g, "");
        const padded = `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
        return bg(padded);
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
          // Read latest subagent data live
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
          const live = Array.isArray(data?.runs) ? data.runs : runs;
          const now = Date.now();
          const rows = live.map((r) => {
            const dur = Math.max(0, Math.round((now - (r.startedAt ?? now)) / 1000));
            const durStr = dur >= 120 ? `${Math.floor(dur / 60)}m${dur % 60}s` : `${dur}s`;
            const model = r.model ?? "model?";
            const task = r.task ?? "subagent";
            return `${model} · ${durStr} · ${task}`;
          });
          const title = theme.fg("accent", `Active subagents (${live.length})`);
          const help = theme.fg("dim", "any key to close · auto-refreshes");
          return [
            border(pw),
            line(title, pw),
            line(help, pw),
            pad("│", pw - 1) + bg(theme.fg("accent", "│")),
            ...rows.map((r) => line(r, pw)),
            pad("│", pw - 1) + bg(theme.fg("accent", "│")),
            line(help, pw),
            bottom(pw),
          ];
        },
        invalidate() {},
        handleInput(data: string) {
          if (data) {
            clearInterval(refreshInterval);
            done(undefined);
          }
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

export async function pickWithSearch(
  ctx: ExtensionContext,
  title: string,
  items: Array<{ value: string; label: string }>,
): Promise<{ value: string; label: string } | undefined> {
  if (!ctx.hasUI) return undefined;
  return await ctx.ui.custom<{ value: string; label: string } | undefined>(
    (tui, theme, _kb, done) => {
      let filter = "";
      let selectedIndex = 0;
      const filtered = () => {
        if (!filter) return items;
        const f = filter.toLowerCase();
        return items.filter((item) => item.label.toLowerCase().includes(f));
      };
      const bg = (text: string) => theme.bg("customMessageBg", text);
      const pad = (line: string, width: number) => {
        const clipped = line.replace(/\r/g, "");
        const padded = `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
        return bg(padded);
      };
      const border = (w: number) => bg(theme.fg("accent", `╭${"─".repeat(Math.max(0, w - 2))}╮`));
      const bottom = (w: number) => bg(theme.fg("accent", `╰${"─".repeat(Math.max(0, w - 2))}╯`));
      return {
        render(width: number) {
          const pw = Math.max(48, width);
          const iw = Math.max(32, pw - 8);
          const matches = filtered();
          if (selectedIndex >= matches.length) selectedIndex = Math.max(0, matches.length - 1);
          const shown =
            matches.length > 0
              ? matches.slice(selectedIndex, selectedIndex + Math.min(10, matches.length))
              : [{ value: "__nomatch", label: "  No matching models" }];
          const line = (s: string) =>
            pad(`│  ${truncate(s, iw)}`, pw - 1) + bg(theme.fg("accent", "│"));
          const search = filter ? `search: ${filter}` : "type to search";
          const info = matches.length > 1 ? ` · ${selectedIndex + 1}/${matches.length}` : "";
          return [
            border(pw),
            line(`${theme.fg("accent", title)}${info}`),
            line(theme.fg("dim", search)),
            pad("│", pw - 1) + bg(theme.fg("accent", "│")),
            ...shown.map((item, idx) => {
              const globalIdx = matches.length > 0 ? filtered().indexOf(item) : -1;
              const isSelected = globalIdx === selectedIndex && matches.length > 0;
              const label =
                item.value === "__clear"
                  ? theme.fg("muted", item.label)
                  : isSelected
                    ? theme.fg("accent", item.label)
                    : item.label;
              return line(label);
            }),
            pad("│", pw - 1) + bg(theme.fg("accent", "│")),
            line(theme.fg("dim", "↑↓ navigate · enter select · esc cancel · type to search")),
            bottom(pw),
          ];
        },
        invalidate() {},
        handleInput(data: string) {
          if (matchesKey(data, "enter")) {
            const matches = filtered();
            if (matches.length > 0 && selectedIndex < matches.length) {
              done(matches[selectedIndex]);
            }
          } else if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
            done(undefined);
          } else if (matchesKey(data, "down")) {
            const matches = filtered();
            selectedIndex = Math.min(selectedIndex + 1, Math.max(0, matches.length - 1));
          } else if (matchesKey(data, "up")) {
            selectedIndex = Math.max(0, selectedIndex - 1);
          } else if (matchesKey(data, "backspace")) {
            filter = filter.slice(0, -1);
            selectedIndex = 0;
          } else if (data && data.length === 1 && data.charCodeAt(0) >= 32) {
            filter += data;
            selectedIndex = 0;
          }
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "72%",
        minWidth: 54,
        maxHeight: "70%",
        anchor: "center",
      },
    },
  );
}

export function goalHelpText(): string {
  return [
    "/goal <intent> [--token-budget N] [--time-budget 10m] [--turn-budget N] [--cost-budget 0.25]",
    "/goal status",
    "/agents",
    "/goal pause",
    "/goal resume",
    "/goal expand ...",
    "/goal clear",
    "/models setup",
    "/goal_model",
    "",
    "/goal starts setup first. The assistant clarifies the contract when needed, presents it for approval, then the expansion continues the goal while idle.",
    `Headless tests: set ${HEADLESS_AUTO_APPROVE_ENV}=1 to allow contract activation without UI. One-shot pi -p cannot process autonomous continuation turns after exit; test continuations via interactive/RPC or repeated resumes.`,
  ].join("\n");
}
