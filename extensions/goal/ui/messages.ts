import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

import {
  GOAL_ROLLUP_MESSAGE_TYPE,
  GOAL_SETUP_MESSAGE_TYPE,
  GOAL_WORK_ORDER_MESSAGE_TYPE,
} from "../domain/constants.ts";
import { truncate } from "./format.ts";

type GoalMessageDetails = {
  title?: string;
  detail?: string;
  phase?: string;
};

export function registerGoalMessageRenderers(pi: ExtensionAPI): void {
  for (const type of [
    GOAL_SETUP_MESSAGE_TYPE,
    GOAL_WORK_ORDER_MESSAGE_TYPE,
    GOAL_ROLLUP_MESSAGE_TYPE,
  ]) {
    pi.registerMessageRenderer(type, (message, { expanded }, theme) => {
      const details = message.details as GoalMessageDetails | undefined;
      const title = details?.title ?? (details?.phase === "setup" ? "◇ Setup" : "● Slice");
      const detail = details?.detail ? truncate(details.detail, 140) : undefined;
      const lines = [theme.fg("accent", theme.bold("Goal")), theme.fg("accent", title)];
      if (detail) lines.push(theme.fg("text", `↳ ${detail}`));
      if (expanded) lines.push("", theme.fg("dim", contentText(message.content)));

      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(new Text(lines.join("\n"), 0, 0));
      return box;
    });
  }
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : ""))
    .filter(Boolean)
    .join("\n");
}
