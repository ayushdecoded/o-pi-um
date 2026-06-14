import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WIDGET_KEY } from "./constants.ts";
import { activeRuns } from "./runtime.ts";
import type { ActiveRun } from "./types.ts";
import { shortTask } from "./text.ts";

let widgetTimer: NodeJS.Timeout | undefined;

export function renderPanel(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  const runs = Array.from(activeRuns.values());
  // Publish first so the goal dashboard can render subagent chips instead of a separate widget.
  publishDashboardSubagents(runs);
  if (runs.length === 0) {
    clearPanel(ctx);
    return;
  }
  // When goal dashboard is active, it owns the visual surface and reads our published data.
  if ((globalThis as { __piGoalDashboardActive?: boolean }).__piGoalDashboardActive) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  ctx.ui.setWidget(
    WIDGET_KEY,
    [
      ctx.ui.theme.fg("muted", `subagents · ${runs.length} active`),
      ...runs.slice(0, 10).map((run) => {
        const age = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000));
        const model = run.model ? ` · ${run.model}` : "";
        return ctx.ui.theme.fg("dim", `  ${run.id.slice(0, 8)} · ${age}s · ${shortTask(run.task)}${model}`);
      }),
    ],
    { placement: "aboveEditor" },
  );
}

export function startPanel(ctx: ExtensionContext): void {
  renderPanel(ctx);
  if (!ctx.hasUI || widgetTimer) return;
  // Refresh age counters while children are running.
  widgetTimer = setInterval(() => renderPanel(ctx), 1000);
}

export function stopPanel(ctx?: ExtensionContext): void {
  if (widgetTimer) clearInterval(widgetTimer);
  widgetTimer = undefined;
  if (ctx?.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
  publishDashboardSubagents([]);
}

function clearPanel(ctx: ExtensionContext): void {
  ctx.ui.setWidget(WIDGET_KEY, undefined);
  stopPanel();
}

function publishDashboardSubagents(runs: ActiveRun[]): void {
  (globalThis as { __piGoalDashboardSubagents?: unknown }).__piGoalDashboardSubagents = {
    updatedAt: Date.now(),
    runs: runs.map((run) => ({
      id: run.id,
      task: run.task,
      model: run.model,
      startedAt: run.startedAt,
      status: run.status,
    })),
  };
}
