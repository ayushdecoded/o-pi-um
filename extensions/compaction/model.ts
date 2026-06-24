import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

import { resolveModelRoute } from "../subagent/models.ts";
import type { ThinkingLevelType } from "../subagent/types.ts";

export const COMPACTION_ROUTE = "Compaction";

export type RoutedCompactionModel = {
  model: Model<Api>;
  apiKey?: string;
  headers?: Record<string, string>;
  reasoning?: ThinkingLevelType;
};

export async function getCompactionModel(
  ctx: ExtensionContext,
): Promise<RoutedCompactionModel | undefined> {
  const route = resolveModelRoute(ctx, COMPACTION_ROUTE);
  const model = route.model ? findModel(ctx, route.model) : undefined;
  if (!model) return undefined;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) return undefined;

  return {
    model,
    apiKey: auth.apiKey,
    headers: auth.headers,
    reasoning: route.reasoning,
  };
}

export function modelName(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function findModel(ctx: ExtensionContext, fullName: string): Model<Api> | undefined {
  const [provider, ...idParts] = fullName.split("/");
  const id = idParts.join("/");
  return provider && id ? ctx.modelRegistry.find(provider, id) : undefined;
}
