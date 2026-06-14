import type { ThinkingLevel } from "./types.ts";

export const GOAL_FILE_VERSION = 1;
export const MAX_OBJECTIVE_CHARS = 18_000;
export const GOAL_STATUS_KEY = "goal"; // UI status/widget key only
export const GOAL_SETUP_MESSAGE_TYPE = "pi-goal-setup"; // internal queued-message discriminator
export const GOAL_CONTINUATION_MESSAGE_TYPE = "pi-goal-continuation"; // internal queued-message discriminator
export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];
export const HEADLESS_AUTO_APPROVE_ENV = "PI_GOAL_HEADLESS_AUTO_APPROVE";
