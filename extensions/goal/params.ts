import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const GoalToolParamsSchema = Type.Object({
  action: Type.Optional(
    StringEnum(["complete", "subtask", "expand", "pause"] as const, {
      description: "Durable goal state action.",
    }),
  ),
  contract: Type.Optional(
    Type.String({
      description: "Approved setup contract. Use only while setup is pending, with no action.",
    }),
  ),
  subtasks: Type.Optional(
    Type.Array(
      Type.Object({
        subtask: Type.String({ description: "Title." }),
        completed: Type.Optional(Type.Boolean({ description: "Done?" })),
      }),
      { description: "Batch subtask updates." },
    ),
  ),
  expansions: Type.Optional(
    Type.Object({
      add: Type.Optional(Type.Array(Type.String({ description: "Add objective." }))),
      drop: Type.Optional(Type.Number({ description: "Drop objective index." })),
    }),
  ),
});
