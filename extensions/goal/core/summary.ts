import {
  convertToLlm,
  prepareBranchEntries,
  serializeConversation,
  type ExtensionContext,
  type SessionBeforeTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { completeSimple } from "@earendil-works/pi-ai";

import { getCompactionModel } from "../../compaction/model.ts";
import { readGoalState } from "../domain/state.ts";

const SUMMARY_SYSTEM_PROMPT =
  "You compact work segments for continuation. Do not continue the conversation. Output only the requested summary.";

const SUMMARY_PROMPT = `Compact this work segment for continuation.

Keep only durable facts:
- agreed requirements/constraints that still matter
- completed work and evidence
- validation commands/results
- important files/APIs/commands changed or read
- decisions made
- remaining work or blockers

Omit dialogue, tool chatter, transient plans, repeated instructions, and controller/meta wording. Do not mention Goal, slice, branch, controller, or work-order.

Output exactly:
Done:
- ...
Validation:
- ...
Files:
- ...
Decisions:
- ...
Next:
- ...
Blockers:
- ...

Use "- (none)" for empty sections. No preamble.`;

export async function summarizeGoalTreeRollup(
  event: SessionBeforeTreeEvent,
  ctx: ExtensionContext,
): Promise<{ summary: { summary: string; details?: unknown } } | undefined> {
  const goal = readGoalState(ctx);
  if (!event.preparation.userWantsSummary) return undefined;
  if (!goal?.currentSlice?.startEntryId) return undefined;
  if (event.preparation.targetId !== goal.currentSlice.startEntryId) return undefined;

  const routed = await getCompactionModel(ctx);
  if (!routed) return undefined;

  const contextWindow = routed.model.contextWindow || 128_000;
  const { messages, fileOps } = prepareBranchEntries(
    event.preparation.entriesToSummarize,
    Math.max(0, contextWindow - 16_384),
  );
  const conversation = serializeConversation(convertToLlm(messages));
  const response = await completeSimple(
    routed.model,
    {
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `<segment_state>\n${segmentState(goal)}\n</segment_state>\n\n<conversation>\n${conversation}\n</conversation>\n\n${SUMMARY_PROMPT}`,
            },
          ],
          timestamp: Date.now(),
        },
      ],
    },
    {
      apiKey: routed.apiKey,
      headers: routed.headers,
      signal: event.signal,
      maxTokens: 1200,
      reasoning: routed.reasoning === "off" ? undefined : routed.reasoning,
    },
  );

  const summary = response.content
    .filter((item) => item.type === "text")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!summary || response.stopReason === "aborted" || response.stopReason === "error") {
    return undefined;
  }

  return {
    summary: {
      summary,
      details: fileDetails(fileOps),
    },
  };
}

function segmentState(goal: NonNullable<ReturnType<typeof readGoalState>>): string {
  const slice = goal.currentSlice;
  if (!slice) return "";
  return [
    `Segment: ${slice.name}`,
    `Objective: ${slice.objective}`,
    "Tasks:",
    ...slice.tasks.map(
      (task) =>
        `- ${task.completed ? "[x]" : "[ ]"} ${task.name}${task.evidence ? ` — ${task.evidence}` : ""}`,
    ),
    "Next:",
    ...(goal.plannedSlices.length
      ? goal.plannedSlices.map(
          (plan) => `- ${plan.name}${plan.objective ? `: ${plan.objective}` : ""}`,
        )
      : ["- (none recorded)"]),
  ].join("\n");
}

function fileDetails(fileOps: { read: Set<string>; written: Set<string>; edited: Set<string> }) {
  const modified = new Set([...fileOps.written, ...fileOps.edited]);
  return {
    readFiles: [...fileOps.read].filter((file) => !modified.has(file)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}
