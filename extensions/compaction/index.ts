import { compact, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";

import { resolveModelRoute } from "../subagent/models.ts";

const COMPACTION_ROUTE = "Compaction";

export default function registerCompactionExtension(pi: ExtensionAPI): void {
  // Pi owns when compaction runs. This hook only swaps the summarizer model to
  // the project-local `.pi/MODELS.md` `## Compaction` route.
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
