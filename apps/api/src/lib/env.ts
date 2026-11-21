import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Carrega o .env da RAIZ do monorepo (os scripts rodam dentro de apps/api)
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(here, "../../../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(p)) {
    config({ path: p });
    break;
  }
}

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://g2:g2@localhost:5433/g2studio"),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  MAX_JOB_COST_USD: z.coerce.number().default(0.5),
  /** trava de minutos de narração (Seed Speech: 60 min grátis, depois US$ 0,15/min) */
  VOICE_FREE_MINUTES: z.coerce.number().default(55),
  // pasta absoluta na raiz do monorepo — API e worker precisam ver o mesmo lugar
  STORAGE_DIR: z.string().default(resolve(here, "../../../../storage")),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.string().optional(),
  // com bucket ligado, quanto do disco local usar como cache antes de limpar os mais antigos
  STORAGE_CACHE_GB: z.coerce.number().positive().optional(),
  /** login obrigatório (servidor na nuvem). No Mac fica false e o app abre direto, como sempre */
  AUTH_REQUIRED: z.enum(["true", "false"]).default("false"),
  /** primeiro admin, criado no boot se ainda não houver ninguém */
  ADMIN_EMAIL: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_NAME: z.string().optional(),
  /** token de máquina (MCP do Claude, scripts): Authorization: Bearer <API_TOKEN> */
  API_TOKEN: z.string().optional(),
  SESSION_DAYS: z.coerce.number().default(30),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export const env = schema.parse(process.env);
