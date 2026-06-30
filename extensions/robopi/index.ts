import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerRunner } from "../runner-core/index.ts";
import { robopiRunner } from "./definition.ts";

export { robopiRunner } from "./definition.ts";

export default function robopiExtension(pi: ExtensionAPI): void {
  registerRunner(pi, robopiRunner);
}
