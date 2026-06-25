import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { captureScreenshot, runBrowserAction } from "./actions.ts";
import { DEFAULT_BROWSER_URL, DEFAULT_ZEN_BROWSER_URL } from "./constants.ts";
import {
  bidiEndpointReachable,
  ensureChromeRunning,
  ensureZenRunning,
  zenProcessRunning,
} from "./launch.ts";
import { BrowserParamsSchema } from "./schema.ts";
import type { BrowserParams } from "./types.ts";
import { browserKind, browserUrl, contentText, setBrowserOverride } from "./utils.ts";

function latestUserMentionsZen(ctx: { sessionManager: { getEntries(): unknown[] } }): boolean {
  // Only inspect the latest user turn so older mentions of "zen" do not stick forever.
  const entries = ctx.sessionManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i--) {
    const message = (entries[i] as { message?: { role?: string; content?: unknown } })?.message;
    if (message?.role !== "user") continue;
    return /\bzen\b/i.test(contentText(message.content));
  }
  return false;
}

async function applyDeterministicBrowserChoice(
  params: BrowserParams,
  ctx: { sessionManager: { getEntries(): unknown[] } },
): Promise<BrowserParams> {
  // Browser choice stays hidden from the tool schema. Env wins; otherwise prefer
  // Zen when the user explicitly says it or already has Zen open.
  if (process.env.PI_BROWSER) setBrowserOverride(undefined);
  else if (
    latestUserMentionsZen(ctx) ||
    (await bidiEndpointReachable(browserUrl("zen"))) ||
    zenProcessRunning()
  )
    setBrowserOverride("zen");
  else setBrowserOverride(undefined);
  return params;
}

export default function browserBridgeExtension(pi: ExtensionAPI): void {
  pi.registerCommand("browser-start", {
    description: "Start Pi's dedicated Chrome automation profile",
    handler: async (_args, ctx) => {
      try {
        await ensureChromeRunning(DEFAULT_BROWSER_URL);
        ctx.ui.notify(`Chrome automation is ready at ${DEFAULT_BROWSER_URL}`, "info");
      } catch (error) {
        ctx.ui.notify(
          `Failed to start Chrome automation: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });

  pi.registerCommand("zen-start", {
    description: "Start Zen/Firefox automation using the default browser profile",
    handler: async (_args, ctx) => {
      try {
        await ensureZenRunning(DEFAULT_ZEN_BROWSER_URL);
        ctx.ui.notify(`Zen/Firefox automation is ready at ${DEFAULT_ZEN_BROWSER_URL}`, "info");
      } catch (error) {
        ctx.ui.notify(
          `Failed to start Zen/Firefox automation: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  });

  pi.on("session_shutdown", () => setBrowserOverride(undefined));

  pi.registerTool({
    name: "browser",
    label: "Browser",
    description:
      "Control a local browser with compact snapshots and element refs. Params: action, target, text.",
    promptSnippet:
      "Use browser with only action/target/text. First call snapshot, then interact by target ref like e12. For open target is URL; press target is key; wait target is text; type target is ref and text is value.",
    promptGuidelines: [
      "Use action='snapshot' to inspect the page; it returns concise page state and element refs like [e12].",
      "For click/type, prefer target='e12' from snapshot over visible text. CSS escape hatch: target='css:button.submit'.",
      "For open, target is the URL. For press, target is the key. For wait, target is text. For scroll, target can be up/down.",
      "Browser uses a dedicated Chrome profile by default; Zen/Firefox real-profile writes require confirmation or PI_BROWSER_REAL_PROFILE_WRITE=1.",
      "Set PI_BROWSER=chrome|zen|firefox to force a browser backend.",
      "Do not use for sensitive account/payment/personal-data/destructive actions unless user explicitly confirms.",
    ],
    parameters: BrowserParamsSchema,
    prepareArguments(args): BrowserParams {
      if (!args || typeof args !== "object" || Array.isArray(args)) return {};
      const input = args as Record<string, unknown>;
      const action = typeof input.action === "string" ? input.action : undefined;
      const target = typeof input.target === "string" ? input.target : undefined;
      const text = typeof input.text === "string" ? input.text : undefined;
      return {
        ...(action ? { action: action as BrowserParams["action"] } : {}),
        ...(target ? { target } : {}),
        ...(text ? { text } : {}),
      };
    },
    async execute(_toolCallId, params: BrowserParams, _signal, _onUpdate, ctx) {
      params = await applyDeterministicBrowserChoice(params, ctx);
      await guardRealProfileMutation(params, ctx);
      try {
        // Screenshots need a multimodal result; all other actions return plain text.
        if ((params.action ?? "").toLowerCase() === "screenshot") {
          const shot = await captureScreenshot(params);
          return {
            content: [
              { type: "text", text: shot.text },
              { type: "image" as const, data: shot.data, mimeType: "image/png" },
            ],
            details: { action: params.action ?? "screenshot" },
          };
        }
        const text = await runBrowserAction(params);
        return { content: [{ type: "text", text }], details: { action: params.action ?? "state" } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`browser failed: ${message}`);
      }
    },
  });
}

async function guardRealProfileMutation(
  params: BrowserParams,
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
): Promise<void> {
  const action = (params.action ?? "state").toLowerCase();
  if (browserKind() === "chrome" || !["open", "click", "type", "press"].includes(action)) return;
  if (/^(1|true|yes|on)$/i.test(process.env.PI_BROWSER_REAL_PROFILE_WRITE ?? "")) return;
  if (!ctx.hasUI)
    throw new Error(
      `browser ${action} uses the real ${browserKind()} profile; set PI_BROWSER_REAL_PROFILE_WRITE=1 or use Chrome's isolated profile.`,
    );
  const ok = await ctx.ui.confirm(
    `Allow browser ${action} in real ${browserKind()} profile?`,
    "This may affect logged-in tabs/accounts. Prefer PI_BROWSER=chrome for isolated automation.",
  );
  if (!ok) throw new Error(`browser ${action} cancelled for real ${browserKind()} profile.`);
}
