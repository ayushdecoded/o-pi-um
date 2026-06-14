import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MAX_ACTIVE, MAX_DEPTH } from "./constants.ts";
import { parseModelsMd } from "./models.ts";

export function formatSubagentPrompt(ctx: ExtensionContext): string {
  const routes = parseModelsMd(ctx.cwd).map((route) => route.name);
  // Keep guidance dynamic: route names come from the current project, not hardcoded docs.
  const routeText = routes.length
    ? `Use .pi/MODELS.md section names for subagent model routing when available: ${routes.join(", ")}.`
    : "Use explicit provider/model ids when selecting subagent models.";
  return `Subagents: use subagent for targeted parallel work; pass sessionFile to subagent for follow-ups on an existing child session instead of spawning a new related child. Never read child JSONL unless asked. ${routeText} Keep subagent tasks narrow so cheaper/faster routes can be used. Max ${MAX_ACTIVE} active, depth ${MAX_DEPTH}.`;
}
