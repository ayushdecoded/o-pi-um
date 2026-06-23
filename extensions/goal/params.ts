import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const GoalToolParamsSchema = Type.Object({
  action: Type.Optional(
    StringEnum(["complete", "tasks", "pause"] as const, {
      description: "Work action: tasks, pause, or complete.",
    }),
  ),
  contract: Type.Optional(
    Type.String({
      description: "Approved setup contract; no action.",
    }),
  ),
  slice: Type.Optional(
    Type.Object({
      name: Type.Optional(Type.String({ description: "Current slice name." })),
      objective: Type.Optional(Type.String({ description: "Current slice objective." })),
    }),
  ),
  slices: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: "Future slice name." }),
        objective: Type.String({ description: "Future slice objective." }),
      }),
      { description: "Queued future slice plans." },
    ),
  ),
  tasks: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String({ description: "Task name." }),
        objective: Type.Optional(Type.String({ description: "Task output." })),
        verification: Type.Optional(Type.String({ description: "Done when..." })),
        completed: Type.Optional(Type.Boolean({ description: "Done?" })),
        evidence: Type.Optional(Type.String({ description: "Completion proof." })),
      }),
      { description: "Current-slice task updates; new tasks need objective+verification." },
    ),
  ),
});
