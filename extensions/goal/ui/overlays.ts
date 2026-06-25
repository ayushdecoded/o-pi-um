import { HEADLESS_AUTO_APPROVE_ENV } from "../domain/constants.ts";

export function goalHelpText(): string {
  return [
    "/goal <intent>",
    "/goal status",
    "/goal pause",
    "/goal resume",
    "/goal clear",
    "",
    "/goal starts with contract setup. After approval, Goal auto-runs visible work slices and rolls each completed segment into a compact summary.",
    `Headless tests: set ${HEADLESS_AUTO_APPROVE_ENV}=1 to allow contract activation without UI.`,
  ].join("\n");
}
