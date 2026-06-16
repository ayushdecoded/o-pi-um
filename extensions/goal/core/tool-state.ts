import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const GOAL_TOOL = "goal";

export function setGoalToolActive(pi: ExtensionAPI, enabled: boolean): void {
  const active = pi.getActiveTools();
  const hasGoal = active.includes(GOAL_TOOL);
  if (enabled && !hasGoal) pi.setActiveTools([...active, GOAL_TOOL]);
  if (!enabled && hasGoal) pi.setActiveTools(active.filter((name) => name !== GOAL_TOOL));
}
