import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { sql } from "../lib/db.js";
import { authOn, clearCookie, createSession, endSession, hashPassword, readCookie, sessionCookie, userForToken, verifyPassword, type User } from "../lib/auth.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: User | null;
  }
}

const isAdmin = (req: FastifyRequest) => !authOn() || req.user?.role === "admin";

/** login, sessão e equipe (admin cria e desativa editores) */
export async function authRoutes(app: FastifyInstance) {
  app.get("/auth/me", async (req) => ({ authRequired: authOn(), user: req.user ?? null }));

  app.post("/auth/login", async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body ?? {});
    const [row] = await sql<(User & { password_hash: string })[]>`select * from users where email = ${body.email.trim().toLowerCase()}`;
    // mesma resposta pra e-mail errado e senha errada (não entrega quem tem conta)
    if (!row || row.disabled || !(await verifyPassword(body.password, row.password_hash))) {
      await new Promise((r) => setTimeout(r, 400));
      return reply.code(401).send({ error: "e-mail ou senha incorretos" });
    }
    const { token, expires } = await createSession(row.id);
    reply.header("set-cookie", sessionCookie(token, expires));
    return { user: { id: row.id, email: row.email, name: row.name, role: row.role } };
  });

  app.post("/auth/logout", async (req, reply) => {
    const t = readCookie(req.headers.cookie);
    if (t) await endSession(t);
    reply.header("set-cookie", clearCookie());
    return { ok: true };
  });

  app.post("/auth/password", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "entre primeiro" });
    const body = z.object({ current: z.string().min(1), next: z.string().min(8, "a senha nova precisa de 8+ caracteres") }).parse(req.body ?? {});
    const [row] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${req.user.id}`;
    if (!row || !(await verifyPassword(body.current, row.password_hash))) return reply.code(400).send({ error: "senha atual incorreta" });
    await sql`update users set password_hash = ${await hashPassword(body.next)} where id = ${req.user.id}`;
    // derruba as outras sessões
    const t = readCookie(req.headers.cookie);
    await sql`delete from sessions where user_id = ${req.user.id} and token_hash <> ${t ? (await import("node:crypto")).createHash("sha256").update(t).digest("hex") : ""}`;
    return { ok: true };
  });

  // ── equipe (só admin) ──
  app.get("/auth/users", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: "só admin" });
    const users = await sql`
      select u.id, u.email, u.name, u.role, u.disabled, u.created_at, u.last_login_at,
        coalesce((select sum(estimated_cost_usd) from jobs j where j.created_by = u.id and j.status = 'succeeded' and j.created_at >= date_trunc('month', now())), 0)::float as month_usd,
        (select count(*) from jobs j where j.created_by = u.id and j.created_at >= date_trunc('month', now()))::int as month_jobs
      from users u order by u.created_at`;
    return { users };
  });

  app.post("/auth/users", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: "só admin" });
    const body = z
      .object({ email: z.string().email(), name: z.string().min(1).max(80), role: z.enum(["admin", "editor"]).default("editor"), password: z.string().min(8, "senha inicial com 8+ caracteres") })
      .parse(req.body ?? {});
    const email = body.email.trim().toLowerCase();
    const [exists] = await sql`select 1 from users where email = ${email}`;
    if (exists) return reply.code(409).send({ error: "já existe alguém com esse e-mail" });
    const [u] = await sql`insert into users (email, name, role, password_hash) values (${email}, ${body.name}, ${body.role}, ${await hashPassword(body.password)})
      returning id, email, name, role, disabled, created_at`;
    return reply.code(201).send({ user: u });
  });

  app.patch("/auth/users/:id", async (req, reply) => {
    if (!isAdmin(req)) return reply.code(403).send({ error: "só admin" });
    const { id } = req.params as { id: string };
    const body = z.object({ disabled: z.boolean().optional(), role: z.enum(["admin", "editor"]).optional(), name: z.string().min(1).max(80).optional(), password: z.string().min(8).optional() }).parse(req.body ?? {});
    if (req.user?.id === id && (body.disabled || body.role === "editor")) return reply.code(400).send({ error: "você não pode tirar o próprio acesso de admin" });
    const patch: Record<string, unknown> = {};
    if (body.disabled != null) patch.disabled = body.disabled;
    if (body.role) patch.role = body.role;
    if (body.name) patch.name = body.name;
    if (body.password) patch.password_hash = await hashPassword(body.password);
    if (!Object.keys(patch).length) return { ok: true };
    const [u] = await sql`update users set ${sql(patch as any)} where id = ${id} returning id, email, name, role, disabled`;
    if (body.disabled || body.password) await sql`delete from sessions where user_id = ${id}`;
    return { user: u };
  });
}
