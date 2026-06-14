import * as os from "node:os";
import * as path from "node:path";

export const MAX_ACTIVE = 10;
export const MAX_DEPTH = 2;
export const SESSION_ROOT = path.join(os.homedir(), ".pi", "agent", "subagent-sessions");
export const WIDGET_KEY = "subagent-panel";
export const PER_TASK_OUTPUT_CAP = 50 * 1024;
