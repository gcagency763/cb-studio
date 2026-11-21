import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import { mkdirSync } from "node:fs";
import { env } from "./lib/env.js";
import { generateRoutes } from "./routes/generate.js";
import { renderRoutes } from "./routes/render.js";
import { projectRoutes } from "./routes/projects.js";
import { scriptRoutes } from "./routes/script.js";
import { statsRoutes } from "./routes/stats.js";
import { libraryRoutes } from "./routes/library.js";
import { editRoutes } from "./routes/edit.js";
import { adsRoutes } from "./routes/ads.js";
import { publishRoutes } from "./routes/publish.js";
import { ensureWhisper } from "./lib/edit.js";
import { runMigrations } from "./lib/migrate.js";
import { ensureLocal, keyOf, s3On } from "./lib/storage.js";
import { authRoutes } from "./routes/auth.js";
import { authOn, bootstrapAdmin, currentUser, machineToken, readCookie, userForToken } from "./lib/auth.js";

// migrações automáticas — sem passo manual ao atualizar o código
try {
  const ran = await runMigrations();
  if (ran.length) console.log(`[migrate] aplicadas: ${ran.join(", ")}`);
} catch (e: any) {
  console.error("[migrate] falhou:", e.message);
}

try {
  if (await bootstrapAdmin()) console.log("[auth] primeiro admin criado a partir de ADMIN_EMAIL");
} catch (e: any) {
  console.error("[auth] não criou o admin:", e.message);
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true, credentials: true });

// login: com AUTH_REQUIRED=true, tudo pede sessão (cookie) ou o token de máquina — menos /health e o próprio login
const OPEN = new Set(["/health", "/v1/auth/login", "/v1/auth/me", "/v1/auth/logout"]);
app.addHook("onRequest", (req, reply, done) => {
  userForToken(readCookie(req.headers.cookie))
    .catch(() => null)
    .then((user) => {
      req.user = user;
      if (authOn()) {
        const path = req.url.split("?")[0];
        // YouTube volta do login do Google com um GET direto
        const open = OPEN.has(path) || path.startsWith("/v1/publish/youtube/callback");
        if (!open && !user && !machineToken(req.headers.authorization)) {
          reply.code(401).send({ error: "entre com seu e-mail e senha", login: true });
          return;
        }
      }
      // quem está pedindo fica disponível pro resto do pedido (createJob grava created_by)
      currentUser.run({ id: user?.id ?? null }, done);
    });
});
await app.register(multipart);

// Serve os arquivos gerados (imagens/vídeos) em /storage/*
mkdirSync(env.STORAGE_DIR, { recursive: true });
// nuvem: o disco é cache do bucket — se o arquivo pedido não está aqui, baixa antes de servir
if (s3On()) {
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/storage/")) return;
    try {
      await ensureLocal(keyOf(req.url));
    } catch {
      /* chave inválida → o static responde 404 */
    }
  });
}
await app.register(fastifyStatic, { root: env.STORAGE_DIR, prefix: "/storage/", decorateReply: false });

app.get("/health", async () => ({ ok: true, ts: Date.now(), storage: s3On() ? "bucket + cache local" : "disco local" }));
await app.register(authRoutes, { prefix: "/v1" });
await app.register(generateRoutes, { prefix: "/v1" });
await app.register(renderRoutes, { prefix: "/v1" });
await app.register(projectRoutes, { prefix: "/v1" });
await app.register(scriptRoutes, { prefix: "/v1" });
await app.register(statsRoutes, { prefix: "/v1" });
await app.register(libraryRoutes, { prefix: "/v1" });
await app.register(editRoutes, { prefix: "/v1" });
await app.register(adsRoutes, { prefix: "/v1" });
await app.register(publishRoutes, { prefix: "/v1" });
// transcrição local (Cortes): sobe o container sozinho, sem travar o boot
ensureWhisper().catch(() => {});

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
