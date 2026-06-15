import { compact, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { resolveModelRoute } from "../subagent/models.ts";

// Reuse the project model-routing file owned by subagent:
// `.pi/MODELS.md` -> `## Compaction`.
const COMPACTION_ROUTE = "Compaction";

// Pi's built-in auto-compaction is reserve-token based. This extension adds the
// simpler policy we want: compact once the active context reaches 80%.
const COMPACTION_THRESHOLD = 80;

// Process-local guard flags. `requested` covers the gap between ctx.compact()
// scheduling and the compaction hook firing; `running` covers the hook itself.
let requested = false;
let running = false;

export default function registerCompactionExtension(pi: ExtensionAPI): void {
  // Check after each agent loop, when the model is idle and context usage has
  // been updated from the latest provider response.
  pi.on("agent_end", (_event, ctx) => {
    maybeCompact(ctx);
  });

  // Any compaction path, manual or automatic, comes through this hook. We let Pi
  // prepare the cut point/messages, then run Pi's stock summarizer with the
  // routed compaction model instead of the current chat model.
  pi.on("session_before_compact", async (event, ctx) => {
    running = true;

    const route = resolveModelRoute(ctx, COMPACTION_ROUTE);
    const model = route.model ? findModel(ctx, route.model) : undefined;
    if (!model) {
      // Returning nothing means "use Pi's default compaction behavior".
      ctx.ui.notify(`Compaction route unavailable; using current model.`, "warning");
      return;
    }

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      // Auth failure should not block compaction; fall back to the default path.
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

  // Reset guards after successful compaction, and also on teardown/reload.
  pi.on("session_compact", () => {
    requested = false;
    running = false;
  });

  pi.on("session_shutdown", () => {
    requested = false;
    running = false;
  });
}

function maybeCompact(ctx: ExtensionContext): void {
  if (requested || running || !ctx.isIdle()) return;

  const usage = ctx.getContextUsage();
  if (!usage?.percent || usage.percent < COMPACTION_THRESHOLD) return;

  requested = true;
  ctx.ui.notify(
    `Context at ${Math.round(usage.percent)}%; compacting with ${COMPACTION_ROUTE} route.`,
    "info",
  );

  // ctx.compact() is fire-and-forget, so callbacks are the only place to clear
  // guard state if compaction fails before `session_compact` fires.
  ctx.compact({
    onComplete: () => {
      requested = false;
      running = false;
    },
    onError: (error) => {
      requested = false;
      running = false;
      ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
    },
  });
}

function findModel(ctx: ExtensionContext, fullName: string): Model<any> | undefined {
  // modelRegistry.find() wants provider and id separately; model ids can contain
  // slashes, so only split off the provider prefix.
  const [provider, ...idParts] = fullName.split("/");
  const id = idParts.join("/");
  return provider && id ? ctx.modelRegistry.find(provider, id) : undefined;
}
