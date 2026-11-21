import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./db.js";

/** Aplica packages/db/migrations/*.sql que ainda não rodaram (chamado no boot da API). */
export async function runMigrations() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = resolve(here, "../../../../packages/db/migrations");
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`;
  const applied = new Set((await sql`select name from _migrations`).map((r) => r.name as string));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const body = await readFile(join(dir, f), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into _migrations (name) values (${f})`;
    });
    ran.push(f);
  }
  return ran;
}
