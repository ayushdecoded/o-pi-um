import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { REQUIRED_MODEL_SECTIONS, validateModelsMd } from "./models.ts";

export function registerModelCommands(pi: ExtensionAPI): void {
  pi.registerCommand("models", {
    description: "Inspect or bootstrap project model routes in .pi/MODELS.md",
    getArgumentCompletions: completeModelsArgs,
    handler: async (args, ctx) =>
      withCommandErrors(ctx, async () => {
        const action = args.trim().toLowerCase();
        if (action === "setup" || action === "bootstrap") {
          await bootstrapModels(pi, ctx);
          return;
        }
        showModelsStatus(ctx);
      }),
  });
}

function completeModelsArgs(prefix: string): AutocompleteItem[] | null {
  const actions = ["status", "setup", "bootstrap"];
  const items = actions
    .filter((action) => action.startsWith(prefix.trim().toLowerCase()))
    .map((action) => ({ value: action, label: action }));
  return items.length ? items : null;
}

function showModelsStatus(ctx: ExtensionContext): void {
  const check = validateModelsMd(ctx.cwd);
  if (!check.exists) {
    ctx.ui.notify("No .pi/MODELS.md found. Run /models setup to draft one.", "warning");
    return;
  }
  if (!check.ok) {
    ctx.ui.notify(`Invalid .pi/MODELS.md:\n${check.errors.join("\n")}`, "error");
    return;
  }
  ctx.ui.notify(".pi/MODELS.md is valid.", "info");
}

async function bootstrapModels(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const modelsFile = path.join(ctx.cwd, ".pi", "MODELS.md");
  if (fs.existsSync(modelsFile)) {
    if (!ctx.hasUI) {
      ctx.ui.notify(
        ".pi/MODELS.md already exists; edit it directly or rerun in the UI to confirm overwrite.",
        "warning",
      );
      return;
    }
    const ok = await ctx.ui.confirm("Overwrite existing .pi/MODELS.md?", "");
    if (!ok) return;
  }
  const available = ctx.modelRegistry.getAvailable();
  const modelList = (available.length > 0 ? available : ctx.modelRegistry.getAll())
    .map((m) => `${m.provider}/${m.id}`)
    .sort()
    .join("\n");
  ctx.ui.notify("Model route setup started — the agent will draft .pi/MODELS.md", "info");
  pi.sendUserMessage(modelsBootstrapPrompt(modelList), { deliverAs: "followUp" });
}

function modelsBootstrapPrompt(modelList: string): string {
  return `Bootstrap this project's .pi/MODELS.md model routing file.

Requirements:
- Analyze the project and authenticated model list.
- Create exactly these sections: ${REQUIRED_MODEL_SECTIONS.join(", ")}.
- Each section must include \`model: provider/id\` and \`thinking: off|minimal|low|medium|high|xhigh\`.
- Optional fallback fields are \`secondary_model:\` and \`secondary_thinking:\`.
- Confirm the draft with me before writing the file.

Currently authenticated models:
${modelList || "(none reported)"}`;
}

async function withCommandErrors(ctx: ExtensionContext, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    ctx.ui.notify(
      `Models command failed: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
}
