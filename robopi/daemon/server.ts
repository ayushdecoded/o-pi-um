import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

import { verify } from "@octokit/webhooks-methods";

import { dataDir, loadConfig } from "../config.ts";
import { normalizeGitHubEvent } from "./normalize.ts";
import { openStore } from "./store.ts";
import { jobsForEvent } from "./triggers.ts";

export async function startDaemon(options: { port: number; cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const secret = process.env.ROBOPI_WEBHOOK_SECRET;
  if (!secret) throw new Error("ROBOPI_WEBHOOK_SECRET is required for webhook verification.");

  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/webhook/github") {
        res.writeHead(404).end("not found");
        return;
      }
      const body = await readBody(req);
      const signature = String(req.headers["x-hub-signature-256"] ?? "");
      if (!(await verify(secret, body, signature))) {
        res.writeHead(401).end("bad signature");
        return;
      }
      const result = handleWebhook({
        cwd,
        body,
        event: header(req, "x-github-event"),
        deliveryId: header(req, "x-github-delivery"),
      });
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port, "127.0.0.1", resolve));
  console.log(`RoboPi daemon listening on http://127.0.0.1:${options.port}/webhook/github`);
}

export function handleWebhook(input: {
  cwd: string;
  body: string;
  event: string;
  deliveryId: string;
}) {
  const store = openStore(input.cwd);
  try {
    if (store.seen(input.deliveryId)) return { duplicate: true, jobs: [] };
    const rawPath = writeRawPayload(input.cwd, input.deliveryId, input.body);
    const normalized = normalizeGitHubEvent({
      event: input.event,
      deliveryId: input.deliveryId,
      payload: JSON.parse(input.body) as Record<string, unknown>,
      rawPath,
      config: loadConfig(input.cwd),
    });
    const jobs = jobsForEvent(normalized, loadConfig(input.cwd));
    store.saveEvent(normalized);
    for (const job of jobs) store.enqueue(job);
    return { duplicate: false, event: normalized, jobs };
  } finally {
    store.close();
  }
}

export async function daemonSelfTest(cwd = process.cwd()): Promise<void> {
  const secret = process.env.ROBOPI_WEBHOOK_SECRET ?? "self-test";
  const body = JSON.stringify({
    action: "created",
    repository: { name: "demo", owner: { login: "arayush" } },
    issue: { number: 1 },
    comment: { id: 99, body: "@robopi-bot please check" },
    sender: { login: "robopi-bot" },
  });
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  console.log(
    JSON.stringify(
      {
        signature,
        result: handleWebhook({ cwd, body, event: "issue_comment", deliveryId: randomUUID() }),
      },
      null,
      2,
    ),
  );
}

function writeRawPayload(cwd: string, deliveryId: string, body: string): string {
  const dir = join(dataDir(cwd), "payloads");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${deliveryId}.json`);
  writeFileSync(path, body);
  return path;
}

function header(
  req: { headers: Record<string, string | string[] | undefined> },
  name: string,
): string {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
