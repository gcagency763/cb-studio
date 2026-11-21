import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { sql } from "./db.js";
import { env } from "./env.js";

/**
 * Login da equipe: e-mail + senha (scrypt), sessão em cookie httpOnly (o navegador fala com a API pelo
 * mesmo domínio do site — o Next repassa /api e /storage —, então o cookie vale pros arquivos também).
 * Sem dependências novas. Desligado quando AUTH_REQUIRED=false (o Mac continua abrindo direto).
 */
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "g2s";

export type User = { id: string; email: string; name: string; role: "admin" | "editor"; disabled: boolean; created_at: string; last_login_at: string | null };

/** quem fez o pedido atual (pros jobs saberem de quem é o gasto) */
export const currentUser: AsyncLocalStorage<{ id: string | null }> = ((globalThis as any).__g2CurrentUser ??= new AsyncLocalStorage<{ id: string | null }>());

export const authOn = () => env.AUTH_REQUIRED === "true";

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, saltHex, keyHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(keyHex, "hex");
  return want.length === key.length && timingSafeEqual(want, key);
}

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + env.SESSION_DAYS * 86_400_000);
  await sql`insert into sessions (token_hash, user_id, expires_at) values (${sha(token)}, ${userId}, ${expires})`;
  await sql`update users set last_login_at = now() where id = ${userId}`;
  return { token, expires };
}

export async function endSession(token: string) {
  await sql`delete from sessions where token_hash = ${sha(token)}`;
}

export async function userForToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const [u] = await sql<User[]>`
    select u.id, u.email, u.name, u.role, u.disabled, u.created_at, u.last_login_at
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${sha(token)} and s.expires_at > now() and not u.disabled`;
  return u ?? null;
}

export function readCookie(header: string | undefined, name = COOKIE) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function sessionCookie(token: string, expires: Date) {
  const secure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${secure ? "; Secure" : ""}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;

export function machineToken(authorization: string | undefined) {
  return !!env.API_TOKEN && authorization === `Bearer ${env.API_TOKEN}`;
}

/** cria o primeiro admin pelo .env (ADMIN_EMAIL/ADMIN_PASSWORD) quando a tabela está vazia */
export async function bootstrapAdmin() {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
  if (n > 0 || !env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return false;
  await sql`insert into users (email, name, role, password_hash)
    values (${env.ADMIN_EMAIL.trim().toLowerCase()}, ${env.ADMIN_NAME ?? "Admin"}, 'admin', ${await hashPassword(env.ADMIN_PASSWORD)})`;
  return true;
}
