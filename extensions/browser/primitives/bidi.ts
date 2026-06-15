import type { BidiResponse } from "../types.ts";

function bidiWsUrl(baseUrl: string): string {
  // Firefox Remote Agent exposes WebDriver BiDi at /session over ws/wss.
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  url.pathname = `${path}/session`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

// Minimal WebDriver BiDi client for Zen/Firefox.
export class BidiClient {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: BidiResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  capabilities?: any;

  constructor(
    private readonly baseUrl: string,
    private readonly defaultTimeout: number,
  ) {}

  async connect(): Promise<void> {
    this.ws = new WebSocket(bidiWsUrl(this.baseUrl));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out connecting to Zen/Firefox WebDriver BiDi")),
        this.defaultTimeout,
      );
      this.ws!.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      this.ws!.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Failed to connect to Zen/Firefox WebDriver BiDi websocket"));
        },
        { once: true },
      );
    });
    this.ws.addEventListener("message", (event) => {
      // BiDi can emit events too; only messages with ids resolve pending commands.
      let msg: BidiResponse;
      try {
        msg = JSON.parse(String(event.data)) as BidiResponse;
      } catch {
        return;
      }
      if (typeof msg.id !== "number") return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(msg.id);
      waiter.resolve(msg);
    });
    // A BiDi websocket needs an explicit session before browser commands are legal.
    const session = await this.send("session.new", {
      capabilities: { alwaysMatch: { acceptInsecureCerts: true } },
    });
    this.capabilities = session.capabilities;
  }

  async send(
    method: string,
    params: Record<string, any> = {},
    timeout = this.defaultTimeout,
  ): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      throw new Error("Zen/Firefox WebDriver BiDi websocket is not open");
    // Same request-id pattern as CDP, but with BiDi's error envelope.
    const id = this.nextId++;
    const response = await new Promise<BidiResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`BiDi command timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
    if (response.type === "error" || response.error)
      throw new Error(
        `${method}: ${response.error ?? "BiDi error"}${response.message ? `: ${response.message}` : ""}`,
      );
    return response.result;
  }

  async close(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        await this.send("session.end", {}, Math.min(2500, this.defaultTimeout));
      } catch {}
    }
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Zen/Firefox BiDi connection closed"));
      this.pending.delete(id);
    }
    try {
      this.ws?.close();
    } catch {}
  }
}

// Evaluate JavaScript in one browsing context and unwrap BiDi's remote-value response.
export async function bidiEvalValue<T>(
  bidi: BidiClient,
  context: string,
  expression: string,
  timeout?: number,
): Promise<T> {
  const result = await bidi.send(
    "script.evaluate",
    {
      expression,
      target: { context },
      awaitPromise: true,
    },
    timeout,
  );
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception;
    throw new Error(
      result.exceptionDetails.text ??
        exception?.value ??
        exception?.description ??
        "Page evaluation failed",
    );
  }
  return result.result?.value as T;
}

// Use JSON.stringify for structured DOM data because BiDi remote values are shallow.
export async function bidiEvalJson<T>(
  bidi: BidiClient,
  context: string,
  expression: string,
  timeout?: number,
): Promise<T> {
  const json = await bidiEvalValue<string>(bidi, context, `JSON.stringify(${expression})`, timeout);
  if (typeof json !== "string") return json as T;
  return JSON.parse(json) as T;
}
