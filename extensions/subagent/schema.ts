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

const SubagentTask = Type.Object({
  task: Type.String({ description: "Instruction." }),
  model: Type.Optional(Type.String({ description: "Model/route." })),
  reasoning: Type.Optional(ThinkingLevel),
});

const SubagentOptions = Type.Object({
  model: Type.Optional(Type.String({ description: "Default model/route." })),
  reasoning: Type.Optional(ThinkingLevel),
});

// Model-facing API stays intentionally small: solo task, parallel tasks, or follow-up by sessionFile.
export const SubagentParams = Type.Object({
  task: Type.Optional(
    Type.String({
      description: "Solo instruction. With sessionFile, this is the follow-up instruction.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(SubagentTask, { minItems: 1, maxItems: MAX_ACTIVE, description: "Parallel jobs." }),
  ),
  sessionFile: Type.Optional(
    Type.String({ description: "Existing child session file for a follow-up. Use with task." }),
  ),
  options: Type.Optional(SubagentOptions),
});
