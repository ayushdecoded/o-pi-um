import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// Model-facing goal API: small lifecycle surface. Setup is inferred by objective while no objective is approved.
export const GoalToolParamsSchema = Type.Object({
  action: Type.Optional(
    StringEnum(["complete", "subtask", "expand", "pause", "continue"] as const, {
      description: "Goal action.",
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
      { description: "Batch subtask updates for current objective." },
    ),
  ),
  expansions: Type.Optional(
    Type.Object({
      add: Type.Optional(Type.Array(Type.String({ description: "Add objective." }))),
      drop: Type.Optional(Type.Number({ description: "Drop objective index." })),
    }),
  ),
});

export function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|1|done|complete|completed)$/i.test(value.trim())) return true;
    if (/^(false|no|0|open|todo|incomplete)$/i.test(value.trim())) return false;
  }
  return Boolean(value);
}
