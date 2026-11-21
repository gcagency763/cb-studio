import { config } from "dotenv";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
// .env fica na raiz do monorepo (este script roda em packages/db)
for (const p of [resolve(here, "../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
}
const sql = postgres(process.env.DATABASE_URL ?? "postgres://g2:g2@localhost:5432/g2studio");

await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz default now())`;
const applied = new Set((await sql`select name from _migrations`).map((r) => r.name));
const files = (await readdir(join(here, "migrations"))).filter((f) => f.endsWith(".sql")).sort();

for (const f of files) {
  if (applied.has(f)) continue;
  const body = await readFile(join(here, "migrations", f), "utf8");
  await sql.begin(async (tx) => {
    await tx.unsafe(body);
    await tx`insert into _migrations (name) values (${f})`;
  });
  console.log(`✔ ${f}`);
}
console.log("migrações em dia");
await sql.end();
