import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WIDGET_KEY } from "./constants.ts";
import { activeRuns } from "./runtime.ts";
import type { ActiveRun } from "./types.ts";
import { shortTask } from "./text.ts";

let widgetTimer: NodeJS.Timeout | undefined;
let panelCtx: ExtensionContext | undefined;
let goalDashboardActive = false;
let publishSubagentSnapshot: (runs: ActiveRun[]) => void = () => {};

export function connectPanelEvents(pi: Pick<ExtensionAPI, "events">): void {
  publishSubagentSnapshot = (runs) => {
    pi.events.emit("subagent:active", {
      updatedAt: Date.now(),
      runs: runs.map((run) => ({
        id: run.id,
        task: run.task,
        model: run.model,
        startedAt: run.startedAt,
        status: run.status,
      })),
    });
  };
  pi.events.on("goal-dashboard:active", (data) => {
    goalDashboardActive = Boolean((data as { active?: unknown }).active);
    if (panelCtx?.hasUI) renderPanel(panelCtx);
  });
}

export function renderPanel(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  panelCtx = ctx;
  const runs = Array.from(activeRuns.values());
  // Publish first so the goal dashboard can render subagent chips instead of a separate widget.
  publishDashboardSubagents(runs);
  if (runs.length === 0) {
    clearPanel(ctx);
    return;
  }
  // When goal dashboard is active, it owns the visual surface and reads our published data.
  if (goalDashboardActive) {
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
        return ctx.ui.theme.fg(
          "dim",
          `  ${run.id.slice(0, 8)} · ${age}s · ${shortTask(run.task)}${model}`,
        );
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
  panelCtx = undefined;
  if (ctx?.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
  publishDashboardSubagents([]);
}

function clearPanel(ctx: ExtensionContext): void {
  ctx.ui.setWidget(WIDGET_KEY, undefined);
  stopPanel();
}

function publishDashboardSubagents(runs: ActiveRun[]): void {
  publishSubagentSnapshot(runs);
}
