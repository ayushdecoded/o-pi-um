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

// One task list covers solo, parallel fan-out, and single-message follow-ups.
export const SubagentParams = Type.Object({
  tasks: Type.Optional(
    Type.Array(Type.String({ description: "Instruction." }), {
      minItems: 1,
      maxItems: MAX_ACTIVE,
      description: "One task for solo/follow-up, multiple for parallel jobs.",
    }),
  ),
  sessionFile: Type.Optional(
    Type.String({ description: "Existing child session file for a single-task follow-up." }),
  ),
  options: Type.Optional(SubagentOptions),
});
