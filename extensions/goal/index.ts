import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerRunner } from "../runner-core/index.ts";
import { goalRunner } from "./definition.ts";

export { goalRunner } from "./definition.ts";

export default function goalExtension(pi: ExtensionAPI): void {
  registerRunner(pi, goalRunner);
}
