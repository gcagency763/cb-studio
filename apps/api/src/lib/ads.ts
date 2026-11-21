import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createProject, getProject, listProjects, replaceScenes, sql, updateProject, type ProjectRow } from "./db.js";
import { GenError } from "./generate.js";
import { chatJson } from "./llm.js";
import { estimateBatch, generateBatch, startRender, status as projectStatus, type Kind } from "./pipeline.js";
import { generateScript } from "./script.js";

/**
 * Anúncios em escala: produto/oferta + N ganchos → N quadrinhos (um por gancho) numa campanha,
 * produzidos em lote com os modelos grátis. O jeito Ads Studio / Arcads, sem avatar pago.
 */

export interface Hook { angle: string; hook: string; why: string }

const hooksSchema = z.object({ hooks: z.array(z.object({ angle: z.string(), hook: z.string(), why: z.string().optional().default("") })).min(1) });

/** Seed 2.1 propõe N ganchos (ângulos diferentes) pro mesmo produto. Grátis. */
export async function proposeHooks(input: { product: string; offer?: string; audience?: string; count?: number; context?: string }): Promise<Hook[]> {
  const n = input.count ?? 6;
  const system = `Você é estrategista de criativos da G2 Educação (educação em e-commerce/Shopee, Brasil). Para o produto/oferta abaixo, proponha ${n} GANCHOS com ângulos diferentes entre si (dor, história real, mito/fábula, número/prova, curiosidade, contraintuitivo, objeção, antes/depois). Cada gancho é a primeira frase do vídeo (até 14 palavras, em português, direta, sem clichê, números por extenso).
Responda SÓ em JSON: {"hooks":[{"angle":"<nome do ângulo>","hook":"<frase>","why":"<por que esse ângulo vende, 1 frase>"}]}`;
  const user = [`Produto/tema: ${input.product}`, input.offer ? `Oferta/CTA: ${input.offer}` : "", input.audience ? `Público: ${input.audience}` : "", input.context ? `Contexto: ${input.context}` : ""].filter(Boolean).join("\n");
  const { json } = await chatJson(system, user, { temperature: 0.9, maxTokens: 2000 });
  return hooksSchema.parse(json).hooks.slice(0, n);
}

export interface BatchInput {
  campaign: string;
  product: string;
  offer?: string;
  audience?: string;
  hooks: { angle?: string; hook: string }[];
  style?: string;
  voiceId?: string | null;
  videoModel?: string | null;
  scenes?: number;
  tone?: string;
}

/** cria os projetos da campanha (um por gancho) — os roteiros são escritos depois pela fila */
export async function createCampaign(input: BatchInput) {
  const campaignId = randomUUID();
  const projects: ProjectRow[] = [];
  for (const h of input.hooks) {
    const p = await createProject({
      title: h.hook.slice(0, 80),
      kind: "comic",
      theme: themeFor(input, h),
      style: input.style ?? "epic",
      campaign_id: campaignId,
      campaign: input.campaign,
      hook: h.hook,
      voice_id: input.voiceId ?? null,
      video_model: input.videoModel ?? null,
      status: "writing",
    });
    projects.push(p);
  }
  return { campaignId, projects };
}

function themeFor(input: BatchInput, h: { angle?: string; hook: string }) {
  return [`Produto/tema: ${input.product}`, input.offer ? `Oferta/CTA final: ${input.offer}` : "", input.audience ? `Público: ${input.audience}` : "", `GANCHO OBRIGATÓRIO (primeira frase do vídeo, use exatamente): "${h.hook}"`, h.angle ? `Ângulo: ${h.angle}` : ""].filter(Boolean).join("\n");
}

/** escreve o roteiro de cada projeto da campanha (sequencial; ~1 min cada, cota grátis de texto) */
export async function writeCampaignScripts(campaignId: string, input: Pick<BatchInput, "scenes" | "style" | "audience" | "tone">, onProgress?: (p: { step: string; done: number; total: number }) => void) {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY ausente");
  const rows = await sql<ProjectRow[]>`select * from projects where campaign_id = ${campaignId} order by created_at`;
  let done = 0;
  const results: { projectId: string; title: string; ok: boolean; error?: string }[] = [];
  // mesma ficha de personagem em toda a campanha (consistência entre os anúncios)
  let characterSheet: string | undefined;
  for (const p of rows) {
    onProgress?.({ step: `roteiro ${done + 1}/${rows.length}`, done, total: rows.length });
    try {
      const out = await generateScript({ theme: p.theme ?? p.title, scenes: input.scenes ?? 8, style: input.style ?? p.style ?? "epic", audience: input.audience, tone: input.tone, characterSheet }, { apiKey, baseUrl: process.env.ARK_BASE_URL, model: process.env.ARK_TEXT_MODEL });
      characterSheet ??= out.character_sheet;
      await updateProject(p.id, { title: out.title, character_sheet: out.character_sheet, status: "draft" });
      await replaceScenes(p.id, out.scenes.map((s) => ({ ...s, card: s.card ?? null })));
      results.push({ projectId: p.id, title: out.title, ok: true });
    } catch (e: any) {
      await updateProject(p.id, { status: "draft" });
      results.push({ projectId: p.id, title: p.title, ok: false, error: e.message });
    }
    done++;
  }
  return results;
}

/** campanhas = projetos agrupados por campaign_id, com o status de cada um */
export async function listCampaigns() {
  const all = await listProjects();
  type P = (typeof all)[number];
  const groups = new Map<string, { id: string; name: string; projects: P[] }>();
  for (const p of all) {
    if (!p.campaign_id) continue;
    const g = groups.get(p.campaign_id) ?? { id: p.campaign_id, name: p.campaign ?? "Campanha", projects: [] as P[] };
    g.projects.push(p);
    groups.set(p.campaign_id, g);
  }
  return Array.from(groups.values()).map((g) => ({
    id: g.id,
    name: g.name,
    count: g.projects.length,
    writing: g.projects.filter((p) => p.status === "writing").length,
    rendered: g.projects.filter((p) => p.render_url).length,
    ready: g.projects.reduce((a, p) => a + p.ready_count, 0),
    scenes: g.projects.reduce((a, p) => a + p.scene_count, 0),
    updatedAt: g.projects.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), g.projects[0].updated_at),
    projects: g.projects.map((p) => ({ id: p.id, title: p.title, hook: p.hook, status: p.status, scenes: p.scene_count, ready: p.ready_count, coverUrl: p.cover_url, renderUrl: p.render_url })),
  }));
}

/** estima o lote de um tipo em todos os projetos da campanha (não gasta nada) */
export async function estimateCampaign(campaignId: string, kind: Kind) {
  const rows = await sql<Pick<ProjectRow, "id">[]>`select id from projects where campaign_id = ${campaignId}`;
  let totalUsd = 0;
  let scenes = 0;
  let paid = false;
  let model = "";
  for (const r of rows) {
    const p = await getProject(r.id);
    if (!p) continue;
    const e = estimateBatch(p, kind);
    totalUsd += e.totalUsd;
    scenes += e.items.length;
    paid ||= e.paid;
    model = e.model;
  }
  return { projects: rows.length, scenes, totalUsd, paid, model };
}

/** produz um tipo em todos os projetos — tudo ou nada por projeto; lote pago exige allowPaid */
export async function produceCampaign(campaignId: string, kind: Kind, allowPaid: boolean) {
  const est = await estimateCampaign(campaignId, kind);
  if (est.paid && !allowPaid) throw new GenError(402, { error: "lote vai pro cartão — confirme com allowPaid:true", estimatedCostUsd: est.totalUsd, paid: true, scenes: est.scenes });
  const rows = await sql<Pick<ProjectRow, "id">[]>`select id from projects where campaign_id = ${campaignId}`;
  const out = [];
  for (const r of rows) {
    const p = await getProject(r.id);
    if (!p) continue;
    try {
      const g = await generateBatch(p, kind, { allowPaid });
      out.push({ projectId: p.id, queued: g.queued.length, usd: g.totalUsd });
    } catch (e: any) {
      out.push({ projectId: p.id, queued: 0, usd: 0, error: e instanceof GenError ? String(e.body.error) : e.message });
    }
  }
  return { kind, model: est.model, projects: out, totalUsd: out.reduce((a, x) => a + x.usd, 0) };
}

export async function renderCampaign(campaignId: string) {
  const rows = await sql<Pick<ProjectRow, "id">[]>`select id from projects where campaign_id = ${campaignId}`;
  const out = [];
  for (const r of rows) {
    const p = await getProject(r.id);
    if (!p) continue;
    try {
      out.push({ projectId: p.id, ...(await startRender(p)) });
    } catch (e: any) {
      out.push({ projectId: p.id, error: e instanceof GenError ? String(e.body.error) : e.message });
    }
  }
  return out;
}

export async function campaignStatus(campaignId: string) {
  const rows = await sql<Pick<ProjectRow, "id">[]>`select id from projects where campaign_id = ${campaignId} order by created_at`;
  const projects = [];
  for (const r of rows) {
    const p = await getProject(r.id);
    if (p) projects.push({ ...projectStatus(p), hook: p.hook, status: p.status });
  }
  return { id: campaignId, name: projects.length ? (await sql<Pick<ProjectRow, "campaign">[]>`select campaign from projects where id = ${projects[0].id}`)[0]?.campaign : null, projects };
}
