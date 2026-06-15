import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { formatCompactNumber, formatCost } from "../shared/format.ts";
import {
  addUsageTotals,
  cacheHitRateFromUsage,
  subagentToolResultTotals,
  usageTotalsFromUsage,
  type UsageTotals,
} from "../shared/usage.ts";

type FooterTotals = UsageTotals & { cacheHit?: number };

export default function registerFooter(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      // Usage changes while streaming; no need to repaint idle sessions on a timer.
      const interval = setInterval(() => !ctx.isIdle() && tui.requestRender(), 250);

      return {
        dispose: () => {
          unsubscribe();
          clearInterval(interval);
        },
        invalidate() {},
        render(width: number): string[] {
          const totals = sessionTotals(ctx.sessionManager.getBranch());
          const left = [
            color(theme, "muted", footerData.getGitBranch() ?? ""),
            isSubagent(ctx) ? color(theme, "dim", "[sub]") : "",
            contextLabel(ctx, theme),
            color(
              theme,
              "dim",
              `↑${formatCompactNumber(totals.inputTokens)} ↓${formatCompactNumber(totals.outputTokens)}`,
            ),
            cacheLabel(totals.cacheHit, theme),
            color(
              theme,
              totals.costUsd >= 2 ? "warning" : "muted",
              `$${formatCost(totals.costUsd)}`,
            ),
          ]
            .filter(Boolean)
            .join(color(theme, "muted", "  "));
          const right =
            `${color(theme, "dim", ctx.model?.provider ?? "")} ${theme.bold(color(theme, "accent", ctx.model?.id ?? "no-model"))}`.trim();
          return [fit(left, right, width)];
        },
      };
    });
  });
}

function sessionTotals(branch: any[]): FooterTotals {
  let totals: FooterTotals = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  for (const entry of branch) totals = addEntryUsage(totals, entry);
  return totals;
}

function addEntryUsage(totals: FooterTotals, entry: any): FooterTotals {
  if (entry.type !== "message") return totals;
  if (entry.message?.role === "assistant") return addAssistantUsage(totals, entry.message);
  // Subagents are separate Pi sessions, so parent assistant usage does not include them.
  // The subagent tool result is the durable parent-side place where child usage lives.
  if (entry.message?.role === "toolResult" && entry.message.toolName === "subagent")
    return {
      ...addUsageTotals(totals, subagentToolResultTotals(entry.message)),
      cacheHit: totals.cacheHit,
    };
  return totals;
}

function addAssistantUsage(totals: FooterTotals, message: AssistantMessage): FooterTotals {
  if (!message.usage) return totals;
  const usage = message.usage as unknown as Record<string, unknown>;
  const next = addUsageTotals(totals, usageTotalsFromUsage(usage));
  // Cache hit is provider/session-local; keep it parent-only instead of mixing child ratios.
  return { ...next, cacheHit: cacheHitRateFromUsage(usage) ?? totals.cacheHit };
}

function contextLabel(ctx: any, theme: any): string {
  const usage = ctx.getContextUsage();
  if (!usage) return "";
  const pct = usage.percent === null ? "?" : `${Math.round(usage.percent)}%`;
  const colorName =
    usage.percent === null
      ? "muted"
      : usage.percent >= 90
        ? "error"
        : usage.percent >= 70
          ? "warning"
          : "muted";
  return color(theme, colorName, `${pct}/${formatCompactNumber(usage.contextWindow)}`);
}

function cacheLabel(cacheHit: number | undefined, theme: any): string {
  if (cacheHit === undefined) return "";
  const hit = Math.round(cacheHit);
  const colorName = hit >= 98 ? "success" : hit >= 92 ? "warning" : "error";
  const icon = hit >= 98 ? "●" : hit >= 92 ? "▲" : "●";
  return color(theme, colorName, `${icon} CH${hit}%`);
}

function isSubagent(ctx: any): boolean {
  return Boolean((ctx.sessionManager as { isSubagent?: () => boolean }).isSubagent?.());
}

function fit(left: string, right: string, width: number): string {
  const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
  return truncateToWidth(left + pad + right, width);
}

function color(theme: any, name: string, text: string): string {
  return text ? theme.fg(name, text) : "";
}
