import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// Keep the schema small so models do not spend tokens choosing between aliases.
// Semantics are action-dependent and documented in the tool prompt.
export const BrowserParamsSchema = Type.Object(
  {
    action: Type.Optional(
      StringEnum(
        [
          "state",
          "tabs",
          "open",
          "snapshot",
          "read",
          "click",
          "type",
          "press",
          "scroll",
          "wait",
          "screenshot",
        ] as const,
        { description: "Browser action." },
      ),
    ),
    target: Type.Optional(
      Type.String({
        description:
          "URL/ref/query/key depending on action: open URL, click/type ref, press key, wait text, scroll up/down.",
      }),
    ),
    text: Type.Optional(Type.String({ description: "Text to type." })),
  },
  { additionalProperties: false },
);
