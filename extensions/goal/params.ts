import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const GoalToolParamsSchema = Type.Object({
  action: Type.Optional(
    StringEnum(["complete", "tasks", "pause"] as const, {
      description: "Durable goal state action.",
    }),
  ),
  contract: Type.Optional(
    Type.String({
      description: "Approved setup contract. Use only while setup is pending, with no action.",
    }),
  ),
  slice: Type.Optional(
    Type.Object({
      name: Type.Optional(Type.String({ description: "Short current-slice name." })),
      objective: Type.Optional(Type.String({ description: "Current-slice objective." })),
    }),
  ),
  slices: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: "Short future-slice name." }),
        objective: Type.String({ description: "What this future slice should accomplish." }),
      }),
      { description: "Future slice plans to append/update in bulk." },
    ),
  ),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: "Short task name." }),
        objective: Type.Optional(Type.String({ description: "What this task produces." })),
        verification: Type.Optional(Type.String({ description: "How to verify this task." })),
        completed: Type.Optional(Type.Boolean({ description: "Done?" })),
        evidence: Type.Optional(Type.String({ description: "Proof/evidence when done." })),
      }),
      { description: "Current-slice task updates. New tasks need objective and verification." },
    ),
  ),
});
