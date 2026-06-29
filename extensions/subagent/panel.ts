import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WIDGET_KEY } from "./constants.ts";
import { activeRuns } from "./runtime.ts";
import type { ActiveRun } from "./types.ts";
import { shortTask } from "./text.ts";

let panelCtx: ExtensionContext | undefined;
let goalDashboardActive = false;
let renderedPanel: string | undefined;
let publishedSnapshot: string | undefined;
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
    const active = Boolean((data as { active?: unknown }).active);
    if (active === goalDashboardActive) return;
    goalDashboardActive = active;
    if (panelCtx?.hasUI) renderPanel(panelCtx);
  });
}

export function renderPanel(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  panelCtx = ctx;
  const runs = Array.from(activeRuns.values());
  // Publish first so the goal dashboard can render subagent chips instead of a separate widget.
  publishDashboardSubagents(runs);
  if (runs.length === 0 || goalDashboardActive) {
    clearPanel(ctx);
    return;
  }
  const lines = [
    ctx.ui.theme.fg("muted", `subagents · ${runs.length} active`),
    ...runs.slice(0, 10).map((run) => {
      const model = run.model ? ` · ${run.model}` : "";
      return ctx.ui.theme.fg(
        "dim",
        `  ${run.id.slice(0, 8)} · running · ${shortTask(run.task)}${model}`,
      );
    }),
  ];
  const signature = lines.join("\n");
  if (signature === renderedPanel) return;
  ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
  renderedPanel = signature;
}

export function startPanel(ctx: ExtensionContext): void {
  renderPanel(ctx);
}

export function stopPanel(ctx?: ExtensionContext): void {
  panelCtx = undefined;
  if (ctx?.hasUI && renderedPanel !== undefined) ctx.ui.setWidget(WIDGET_KEY, undefined);
  renderedPanel = undefined;
  publishDashboardSubagents([]);
}

function clearPanel(ctx: ExtensionContext): void {
  if (renderedPanel !== undefined) ctx.ui.setWidget(WIDGET_KEY, undefined);
  renderedPanel = undefined;
}

function publishDashboardSubagents(runs: ActiveRun[]): void {
  const snapshot = JSON.stringify(
    runs.map((run) => ({
      id: run.id,
      task: run.task,
      model: run.model,
      startedAt: run.startedAt,
      status: run.status,
    })),
  );
  if (snapshot === publishedSnapshot) return;
  publishedSnapshot = snapshot;
  publishSubagentSnapshot(runs);
}
