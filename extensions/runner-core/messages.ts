import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Sends one visible setup/work packet. Continuation is event-driven: after the
// model/tool turn completes, Pi emits lifecycle events that wake the controller.
export function sendTurn(
  pi: ExtensionAPI,
  customType: string,
  content: string,
  details: Record<string, unknown>,
): void {
  pi.sendMessage(
    { customType, content, display: true, details },
    { triggerTurn: true, deliverAs: "followUp" },
  );
}
