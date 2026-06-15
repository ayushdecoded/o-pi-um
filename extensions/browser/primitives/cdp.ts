import type { CdpResponse, JsonValue } from "../types.ts";

// Minimal Chrome DevTools Protocol client: request/response IDs over a tab websocket.
export class CdpClient {
  private ws?: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: CdpResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly wsUrl: string,
    private readonly defaultTimeout: number,
  ) {}

  async connect(): Promise<void> {
    // A CDP websocket is scoped to one tab, not the whole browser.
    this.ws = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out connecting to browser tab")),
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
          reject(new Error("Failed to connect to browser tab websocket"));
        },
        { once: true },
      );
    });
    this.ws.addEventListener("message", (event) => {
      let msg: CdpResponse;
      try {
        msg = JSON.parse(String(event.data)) as CdpResponse;
      } catch {
        return;
      }
      // Ignore event-only CDP messages; command responses always carry the request id.
      if (typeof msg.id !== "number") return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(msg.id);
      waiter.resolve(msg);
    });
  }

  async send(
    method: string,
    params: Record<string, JsonValue> = {},
    timeout = this.defaultTimeout,
  ): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN)
      throw new Error("Browser tab websocket is not open");
    // Pair each command with a timeout so a hung browser cannot stall the tool forever.
    const id = this.nextId++;
    const response = await new Promise<CdpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
    if (response.error)
      throw new Error(
        `${method}: ${response.error.message ?? "CDP error"}${response.error.data ? `: ${response.error.data}` : ""}`,
      );
    return response.result;
  }

  close(): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Browser connection closed"));
      this.pending.delete(id);
    }
    try {
      this.ws?.close();
    } catch {}
  }
}

// Evaluate page JavaScript and return JSON-serializable values to the action layer.
export async function evalPage<T>(
  cdp: CdpClient,
  expression: string,
  timeout?: number,
): Promise<T> {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
    timeout,
  );
  if (result.exceptionDetails)
    throw new Error(result.exceptionDetails.text ?? "Page evaluation failed");
  return result.result?.value as T;
}
