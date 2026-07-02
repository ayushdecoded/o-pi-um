import { Type } from "typebox";
import { MAX_ACTIVE } from "./constants.ts";

const ThinkingLevel = Type.Union([
  Type.Literal("off"),
  Type.Literal("minimal"),
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("xhigh"),
]);

const TimeoutOption = Type.Number({ description: "Timeout minutes; -1 disables." });

const SubagentOptions = Type.Object({
  model: Type.Optional(Type.String({ description: "Default model/route." })),
  reasoning: Type.Optional(ThinkingLevel),
  timeout: Type.Optional(TimeoutOption),
});

// One task list covers solo, parallel fan-out, and follow-ups.
export const SubagentParams = Type.Object({
  tasks: Type.Optional(
    Type.Array(Type.String({ description: "Instruction." }), {
      minItems: 1,
      maxItems: MAX_ACTIVE,
      description:
        "One task for solo/follow-up, multiple for parallel jobs or per-session follow-ups.",
    }),
  ),
  sessionFiles: Type.Optional(
    Type.Array(Type.String({ description: "Existing child session file." }), {
      minItems: 1,
      maxItems: MAX_ACTIVE,
      description:
        "Existing child sessions to follow up in parallel. Use one task for all sessions or one task per session.",
    }),
  ),
  options: Type.Optional(SubagentOptions),
});
