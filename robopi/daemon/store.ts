import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { dataDir } from "../config.ts";
import type { NormalizedGitHubEvent } from "../types.ts";
import type { QueuedJob } from "./triggers.ts";

export type RoboPiStore = ReturnType<typeof openStore>;

export function openStore(cwd = process.cwd()) {
  const path = join(dataDir(cwd), "robopi.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    create table if not exists github_events (
      delivery_id text primary key,
      event_json text not null,
      received_at text not null
    );
    create table if not exists jobs (
      id integer primary key autoincrement,
      kind text not null,
      delivery_id text not null,
      reason text not null,
      status text not null default 'queued',
      created_at text not null
    );
  `);

  return {
    seen(deliveryId: string): boolean {
      return Boolean(
        db.prepare("select 1 from github_events where delivery_id = ?").get(deliveryId),
      );
    },
    saveEvent(event: NormalizedGitHubEvent): void {
      db.prepare("insert or ignore into github_events values (?, ?, ?)").run(
        event.deliveryId,
        JSON.stringify(event),
        event.receivedAt,
      );
    },
    enqueue(job: QueuedJob): void {
      db.prepare("insert into jobs(kind, delivery_id, reason, created_at) values (?, ?, ?, ?)").run(
        job.kind,
        job.deliveryId,
        job.reason,
        new Date().toISOString(),
      );
    },
    listJobs(): unknown[] {
      return db.prepare("select * from jobs order by id desc limit 20").all();
    },
    close(): void {
      db.close();
    },
  };
}
