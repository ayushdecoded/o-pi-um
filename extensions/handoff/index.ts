import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const HANDOFF_PROMPT = `Write a compact, concise handoff that tells the whole story of this session in chronological order.

Cover the important events in the order they happened:
- Original goal and any changes in direction
- Key decisions, findings, and reasoning
- Files inspected or changed, with what changed and why
- Commands, validation, tests, and their results
- Problems, blockers, risks, and unresolved questions
- Current state and clear next steps

Use only the session context available to you. If important history is unavailable, say what is missing instead of guessing.

Do not mention a new agent. Do not do new work; only write the handoff.`;

export default function registerHandoffExtension(pi: ExtensionAPI): void {
  pi.registerCommand("handoff", {
    description: "Ask the agent to write a handoff summary",
    handler: async (args, _ctx) => {
      const focus = args.trim();
      const content = focus
        ? `${HANDOFF_PROMPT}\n\nAdditional focus from user:\n${focus}`
        : HANDOFF_PROMPT;

      pi.sendMessage(
        { customType: "handoff", content, display: true },
        { triggerTurn: true, deliverAs: "followUp" },
      );
    },
  });
}
