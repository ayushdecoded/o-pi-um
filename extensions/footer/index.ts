import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { formatCompactNumber, formatCost } from "../shared/format.ts";
import { cacheHitRateFromTotals, sessionUsageTotals, type UsageTotals } from "../shared/usage.ts";

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
          const active = sessionUsageTotals(ctx.sessionManager.getBranch());
          const ledger = sessionUsageTotals(ctx.sessionManager.getEntries());
          const left = [
            color(theme, "muted", footerData.getGitBranch() ?? ""),
            isSubagent(ctx) ? color(theme, "dim", "[sub]") : "",
            contextLabel(ctx, theme),
            color(
              theme,
              "dim",
              `↑${formatCompactNumber(active.inputTokens)} ↓${formatCompactNumber(active.outputTokens)}`,
            ),
            cacheLabel(active, theme),
            activeCostLabel(active, theme),
            ledgerCostLabel(active, ledger, theme),
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

function cacheLabel(totals: UsageTotals, theme: any): string {
  const cacheHit = cacheHitRateFromTotals(totals);
  if (cacheHit === undefined) return "";
  const hit = Math.round(cacheHit);
  const colorName = hit >= 98 ? "success" : hit >= 92 ? "warning" : "error";
  const icon = hit >= 98 ? "●" : hit >= 92 ? "▲" : "●";
  return color(theme, colorName, `${icon}${hit}%`);
}

function activeCostLabel(totals: UsageTotals, theme: any): string {
  return costLabel(totals, "↳", theme);
}

function ledgerCostLabel(active: UsageTotals, ledger: UsageTotals, theme: any): string {
  // ↳ follows the active tree branch; ◆ scans the whole persisted session ledger.
  if (ledger.costUsd <= active.costUsd + 0.005) return "";
  return costLabel(ledger, "◆", theme);
}

function costLabel(totals: UsageTotals, icon: string, theme: any): string {
  return color(
    theme,
    totals.costUsd >= 2 ? "warning" : "muted",
    `${icon}$${formatCost(totals.costUsd)}`,
  );
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
