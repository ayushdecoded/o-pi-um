import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { formatCompactNumber, formatCost } from "../shared/format.ts";
import { sessionUsageTotals, type UsageTotals } from "../shared/usage.ts";

export default function registerFooter(pi: ExtensionAPI): void {
  let requestFooterRender: (() => void) | undefined;
  const refreshFooter = () => requestFooterRender?.();

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestFooterRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(refreshFooter);

      return {
        dispose: () => {
          unsubscribe();
          if (requestFooterRender) requestFooterRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          const active = sessionUsageTotals(ctx.sessionManager.getBranch());
          const ledger = sessionUsageTotals(ctx.sessionManager.getEntries());
          const branch = footerData.getGitBranch() ?? undefined;
          const left = [
            branchLabel(branch, theme),
            isSubagent() ? chip("sub", "dim", theme) : "",
            contextLabel(ctx, theme),
            cacheLabel(ctx.sessionManager.getBranch(), theme),
            activeCostLabel(active, theme),
            ledgerCostLabel(active, ledger, theme),
          ]
            .filter(Boolean)
            .join(color(theme, "borderMuted", "  · "));
          const right = modelLabel(ctx.model?.provider, ctx.model?.id, theme);
          return [fit(left, right, width)];
        },
      };
    });
  });

  pi.on("turn_start", refreshFooter);
  pi.on("tool_execution_start", refreshFooter);
  pi.on("tool_execution_end", refreshFooter);
  pi.on("tool_result", refreshFooter);
  pi.on("turn_end", refreshFooter);
  pi.on("agent_end", refreshFooter);
}

function branchLabel(branch: string | undefined, theme: any): string {
  if (!branch) return "";
  return `${color(theme, "dim", "")} ${color(theme, "muted", branch)}`;
}

function contextLabel(ctx: any, theme: any): string {
  const usage = ctx.getContextUsage();
  if (!usage) return "";
  const pct = usage.percent === null ? undefined : Math.round(usage.percent);
  const label =
    pct === undefined
      ? `?%/${formatCompactNumber(usage.contextWindow)}`
      : `${pct}%/${formatCompactNumber(usage.contextWindow)}`;
  if (pct === undefined || pct <= 65) return label;
  return color(theme, pct > 75 ? "error" : "warning", label);
}

function cacheLabel(entries: unknown[], theme: any): string {
  const cacheHit = latestCacheHitRate(entries);
  if (cacheHit === undefined) return "";
  const hit = Math.round(cacheHit);
  const colorName = hit >= 98 ? "success" : hit >= 92 ? "warning" : "error";
  return `${color(theme, colorName, "↻")} ${color(theme, colorName, `${hit}%`)}`;
}

function latestCacheHitRate(entries: unknown[]): number | undefined {
  let latest: number | undefined;
  for (const entry of entries) {
    const message = (entry as { type?: unknown; message?: Record<string, unknown> }).message;
    if ((entry as { type?: unknown }).type !== "message" || message?.role !== "assistant") continue;
    const usage = message.usage as Record<string, unknown> | undefined;
    const input = numberField(usage, "input");
    const cacheRead = numberField(usage, "cacheRead");
    const cacheWrite = numberField(usage, "cacheWrite");
    const promptTokens = input + cacheRead + cacheWrite;
    latest = promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
  }
  return latest;
}

function numberField(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function activeCostLabel(totals: UsageTotals, theme: any): string {
  return color(theme, "accent", `↳$${formatCost(totals.costUsd)}`);
}

function ledgerCostLabel(active: UsageTotals, ledger: UsageTotals, theme: any): string {
  // Active follows the current branch; ledger scans the whole persisted session tree.
  if (ledger.costUsd <= active.costUsd + 0.005) return "";
  return costLabel(ledger, "◆", theme);
}

function costLabel(totals: UsageTotals, label: string, theme: any): string {
  const colorName = totals.costUsd >= 5 ? "error" : totals.costUsd >= 2 ? "warning" : "muted";
  return color(theme, colorName, `${label}$${formatCost(totals.costUsd)}`);
}

function modelLabel(provider: string | undefined, id: string | undefined, theme: any): string {
  const providerText = shortProvider(provider ?? "");
  const modelText = shortModel(id ?? "no-model");
  return `${color(theme, "dim", providerText)} ${theme.bold(color(theme, "accent", modelText))}`.trim();
}

function chip(text: string, colorName: string, theme: any): string {
  return `${color(theme, "borderMuted", "[")}${color(theme, colorName, text)}${color(theme, "borderMuted", "]")}`;
}

function shortProvider(provider: string): string {
  return provider
    .replace(/^openai-codex$/, "codex")
    .replace(/^openrouter$/, "or")
    .replace(/^anthropic$/, "anth")
    .replace(/^cursor$/, "cursor");
}

function shortModel(model: string): string {
  return model
    .replace(/^gpt-/, "gpt-")
    .replace(/^claude-/, "claude-")
    .replace(/-latest$/, "")
    .replace(/-preview$/, "");
}

function isSubagent(): boolean {
  return Number(process.env.PI_SUBAGENT_DEPTH ?? "0") > 0;
}

function fit(left: string, right: string, width: number): string {
  const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
  return truncateToWidth(left + pad + right, width);
}

function color(theme: any, name: string, text: string): string {
  return text ? theme.fg(name, text) : "";
}
