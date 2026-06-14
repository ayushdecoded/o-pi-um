import type { Message } from "@earendil-works/pi-ai";
import { safeRead } from "./system.ts";

export function readJsonMessages(stdoutFile: string): Message[] {
  const messages: Message[] = [];
  for (const line of safeRead(stdoutFile).split("\n")) collectJsonMessage(line, messages);
  return messages;
}

function collectJsonMessage(line: string, messages: Message[]): void {
  if (!line.trim()) return;
  try {
    const event = JSON.parse(line) as { type?: string; message?: Message };
    if (event.type === "message_end" && event.message) messages.push(event.message);
  } catch {}
}
