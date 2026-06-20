import { compact, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import { resolveModelRoute } from "../subagent/models.ts";

const COMPACTION_ROUTE = "Compaction";
const TURN_END_COMPACTION_THRESHOLD_PERCENT = 80;

export default function registerCompactionExtension(pi: ExtensionAPI): void {
  let turnEndCompactionInFlight = false;

  // Task-boundary compaction policy: native threshold auto-compaction can stay
  // disabled, while Opium still checkpoints after a completed agent turn once
  // the active context is large enough.
  pi.on("agent_end", async (_event, ctx) => {
    if (turnEndCompactionInFlight || !ctx.isIdle()) return;
    const usage = ctx.getContextUsage();
    if (usage?.percent === null || usage?.percent === undefined) return;
    if (usage.percent < TURN_END_COMPACTION_THRESHOLD_PERCENT) return;

    turnEndCompactionInFlight = true;
    ctx.compact({
      customInstructions: `This is an automatic turn-boundary checkpoint because context reached ${usage.percent.toFixed(1)}%. Preserve current task state, completed changes, changed files, validation results, blockers, next steps, and explicit user constraints. Keep it concise and continuation-oriented.`,
      onComplete: () => {
        turnEndCompactionInFlight = false;
        ctx.ui.notify("Turn-boundary checkpoint compacted", "info");
      },
      onError: (error: Error) => {
        turnEndCompactionInFlight = false;
        if (/Already compacted|Nothing to compact/i.test(error.message)) return;
        ctx.ui.notify(`Turn-boundary compaction failed: ${error.message}`, "warning");
      },
    });
  });

  // Pi owns how compaction is written. This hook only swaps the summarizer model
  // to the project-local `.pi/MODELS.md` `## Compaction` route.
  pi.on("session_before_compact", async (event, ctx) => {
    const route = resolveModelRoute(ctx, COMPACTION_ROUTE);
    const model = route.model ? findModel(ctx, route.model) : undefined;
    if (!model) {
      ctx.ui.notify("Compaction route unavailable; using current model.", "warning");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      ctx.ui.notify(`Compaction model auth failed: ${auth.error}`, "warning");
      return;
    }

    ctx.ui.notify(`Compacting with ${model.provider}/${model.id}...`, "info");
    return {
      compaction: await compact(
        event.preparation,
        model,
        auth.apiKey,
        auth.headers,
        event.customInstructions,
        event.signal,
        route.reasoning,
      ),
    };
  });
}

function findModel(ctx: ExtensionContext, fullName: string): Model<any> | undefined {
  const [provider, ...idParts] = fullName.split("/");
  const id = idParts.join("/");
  return provider && id ? ctx.modelRegistry.find(provider, id) : undefined;
}
