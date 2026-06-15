// The public model-facing contract is intentionally tiny: one tool with three params.
// Everything else below describes internal protocol/snapshot data.
export type BrowserAction =
  | "state"
  | "tabs"
  | "open"
  | "snapshot"
  | "read"
  | "click"
  | "type"
  | "press"
  | "scroll"
  | "wait"
  | "screenshot";

export type BrowserParams = {
  action?: BrowserAction;
  target?: string;
  text?: string;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// A snapshot element is what the model sees and later references as target="e12".
export type BrowserElement = {
  ref: string;
  role: string;
  name: string;
  tag?: string;
  value?: string;
  href?: string;
  selector?: string;
  disabled?: boolean;
  selected?: boolean;
  bounds?: { x: number; y: number; w: number; h: number };
};

export type BrowserSnapshot = {
  title: string;
  url: string;
  text: string;
  headings?: { level: number; text: string }[];
  elements: BrowserElement[];
  focused?: string;
};

// ChromeTab is also used as the generic tab/context shape for BiDi to avoid adapters.
export type ChromeTab = {
  id: string;
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

export type CdpResponse = {
  id?: number;
  result?: any;
  error?: { message?: string; data?: string };
};

export type BidiResponse = {
  id?: number;
  type?: "success" | "error" | "event";
  result?: any;
  error?: string;
  message?: string;
  stacktrace?: string;
};

export type LaunchSpec = { command: string; argsPrefix?: string[] };
