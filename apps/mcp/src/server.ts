#!/usr/bin/env node
/**
 * CB Studio MCP — controla o estúdio pelo Claude (Desktop, Code, Cowork) ou por qualquer cliente MCP.
 *
 *   stdio (padrão):  cb-studio-mcp
 *   HTTP:            cb-studio-mcp --http 4100   → POST http://localhost:4100/mcp
 *
 * Regra de ouro (a mesma do app): nada vai pro cartão sem o usuário confirmar o valor.
 * Toda ferramenta que gera estima antes; se o custo é cobrado, ela só executa com confirmPaid:true,
 * que o Claude deve passar APENAS depois de o usuário autorizar explicitamente aquele valor.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";

const API = (process.env.G2_API_URL ?? "http://localhost:4000/v1").replace(/\/$/, "");
// app na nuvem com login ligado: o MCP entra com o token de máquina (API_TOKEN do servidor)
const AUTH: Record<string, string> = process.env.G2_API_TOKEN ? { authorization: `Bearer ${process.env.G2_API_TOKEN}` } : {};
const API_ORIGIN = API.replace(/\/v1$/, "");
const WEB = (process.env.G2_STUDIO_URL ?? "http://localhost:3000").replace(/\/$/, "");

/* ───────────────────────── cliente da API ───────────────────────── */

class ApiError extends Error {
  constructor(
    public status: number,
    public body: any,
  ) {
    super(body?.error ?? body?.message ?? `HTTP ${status}`);
  }
}

async function api<T = any>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...AUTH, ...(init.headers ?? {}) }, signal: ctl.signal });
    const text = await r.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* texto */
    }
    if (!r.ok) throw new ApiError(r.status, body);
    return body as T;
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`a API não respondeu em ${timeoutMs / 1000}s (${path}) — o CB Studio está rodando? (Iniciar CB Studio.command)`);
    if (e?.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(String(e?.message))) throw new Error(`não conectou em ${API} — abra o CB Studio (duplo clique em "Iniciar CB Studio.command")`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const abs = (u: string | null | undefined) => (u && u.startsWith("/") ? `${API_ORIGIN}${u}` : u ?? null);
const usd = (n: number | string | null | undefined) => `US$ ${(+(n ?? 0)).toFixed(+(n ?? 0) < 0.1 ? 3 : 2)}`;
const brl = (n: number) => `≈ R$ ${(n * 5.6).toFixed(2)}`;

type Out = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: unknown): Out => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (msg: string, extra?: unknown): Out => ({ content: [{ type: "text", text: extra ? `${msg}\n${JSON.stringify(extra, null, 2)}` : msg }], isError: true });

/** envolve o handler: erros da API viram texto legível (402 = precisa confirmar custo) */
const guarded =
  <A>(fn: (a: A) => Promise<Out>) =>
  async (a: A): Promise<Out> => {
    try {
      return await fn(a);
    } catch (e: any) {
      if (e instanceof ApiError) {
        if (e.status === 402) return fail(`BLOQUEADO PELA TRAVA DE CUSTO: ${e.body?.error}. Pergunte ao usuário se autoriza ${e.body?.estimatedCostUsd != null ? usd(e.body.estimatedCostUsd) + " " + brl(e.body.estimatedCostUsd) : "o custo"} e, só com o sim dele, chame de novo com confirmPaid: true.`, e.body);
        return fail(`API ${e.status}: ${e.message}`, e.body);
      }
      return fail(e?.message ?? String(e));
    }
  };

/** regra do cartão: executa só se não cobra, ou se o usuário confirmou */
async function checkCost(request: Record<string, unknown>, confirmPaid: boolean | undefined, label: string): Promise<{ cost: number; paid: boolean } | Out> {
  const est = await api<{ estimatedCostUsd: number; paid: boolean; provider: string; maxJobCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request }) });
  if (est.paid && !confirmPaid) {
    return fail(
      `${label}: custo estimado ${usd(est.estimatedCostUsd)} (${brl(est.estimatedCostUsd)}) — VAI PRO CARTÃO (${est.provider}). Não executei. Pergunte ao usuário se autoriza esse valor e, só com o sim explícito dele, chame de novo com confirmPaid: true.`,
      { estimatedCostUsd: est.estimatedCostUsd, provider: est.provider, request },
    );
  }
  return { cost: est.estimatedCostUsd, paid: est.paid };
}

async function pollJob(id: string, timeoutSec: number) {
  const until = Date.now() + timeoutSec * 1000;
  let job: any = await api(`/jobs/${id}`);
  while ((job.status === "queued" || job.status === "running") && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 3000));
    job = await api(`/jobs/${id}`);
  }
  return job;
}

const jobView = (j: any) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  url: abs(j.output_url),
  error: j.error,
  estimatedCostUsd: +j.estimated_cost_usd,
  provider: j.provider,
  model: j.request?.model,
  createdAt: j.created_at,
  ...(j.usage?.seconds ? { seconds: j.usage.seconds } : {}),
  ...(j.usage?.clips ? { clips: j.usage.clips.map((c: any) => ({ ...c, url: abs(c.url) })) } : {}),
  ...(j.usage?.transcriptUrl ? { transcriptUrl: abs(j.usage.transcriptUrl) } : {}),
});

/* ───────────────────────── servidor ───────────────────────── */

const server = new McpServer({ name: "cb-studio", version: "0.1.0" }, { instructions: INSTRUCTIONS() });

function INSTRUCTIONS() {
  return [
    "CB Studio — estúdio de vídeo IA da G2 Educação (app local em " + WEB + ", API em " + API + ").",
    "Fluxo principal (Quadrinhos): create_project(tema) → revisar cenas (get_project / edit_scene) → produce(image) → produce(audio) → produce(video) → render_project → wait_project.",
    "Clone de pessoa: create_voice (com autorização) → clone_person(foto + texto ou áudio).",
    "Vídeo gravado (aula, live): upload_file → make_cuts (cortes virais), caption_video (só legenda) ou dub_video (outra língua com a mesma voz) — local e grátis.",
    "Referência que performou: recreate_from_video(videoUrl, theme) escreve um quadrinho novo na mesma estrutura. review_virality dá nota e melhorias a qualquer roteiro.",
    "Anúncios em escala: ads_hooks → ads_create (um quadrinho por gancho) → ads_produce(image, audio, video) → ads_render.",
    "Publicar: publish_instagram (Reels), publish_youtube (Shorts) e publish_meta_ads (vídeo na conta) — Meta precisa de token no .env, YouTube de canal conectado em Provedores; confirme legenda/título com o usuário antes, é publicação pública.",
    "REGRA DO CARTÃO: nada é cobrado sem o usuário autorizar o valor. Ferramentas que custam estimam antes; se 'paid', só executam com confirmPaid:true — passe isso APENAS depois de o usuário dizer sim para aquele valor. Modelos grátis (Seedream 4.5, Seedance 1.0 fast, Seed Audio dentro dos 60 min) não cobram nada.",
    "Use studio_status pra ver cotas e gastos, list_models pra escolher modelo (locked = precisa de chave/crédito), capabilities pra saber tudo que o estúdio faz e o que está no roadmap.",
    "Sempre responda em português e mostre custos em US$ e R$.",
  ].join("\n");
}

/* ───── status, modelos, capacidades ───── */

server.registerTool(
  "studio_status",
  {
    title: "Status do estúdio",
    description: "Provedores ligados, cotas grátis (imagens, tokens de vídeo, minutos de voz), gasto de hoje/mês, o que foi pro cartão e o que está na fila. Comece por aqui.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  guarded(async () => {
    const [stats, usage] = await Promise.all([api("/stats"), api("/usage")]);
    return ok({
      app: WEB,
      providers: usage.providers,
      queue: { queued: stats.queued, running: stats.running },
      todayNominalUsd: stats.todayCostUsd,
      monthNominalUsd: usage.nominalMonthUsd,
      billedToCardUsd: usage.billedUsd,
      billedToCardMonthUsd: usage.billedMonthUsd,
      maxJobCostUsd: usage.maxJobCostUsd,
      voiceFreeMinutes: usage.voiceFreeMinutes,
      quotas: usage.quotas.map((q: any) => ({ name: q.name, used: q.used, free: q.free, unit: q.unit, pctUsed: Math.round(q.pctUsed) })),
      topModels: usage.byModel.slice(0, 8).map((m: any) => ({ name: m.name, jobs: m.jobs, usd: m.usd, billed: m.billed })),
      note: "nominal = preço de tabela; billedToCard = o que sai do cartão de verdade (BytePlus em modo só-grátis e Seed Audio até 60 min contam 0).",
    });
  }),
);

server.registerTool(
  "list_models",
  {
    title: "Modelos disponíveis",
    description: "Catálogo com preço, resoluções, durações, dicas de uso e o motivo de cada modelo travado (precisa de FAL_KEY, reserva na BytePlus, ElevenLabs). Filtre por tipo.",
    inputSchema: { kind: z.enum(["image", "video", "audio", "avatar", "upscale", "lipsync", "sfx"]).optional().describe("tipo de modelo") },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ kind }) => {
    const { models } = await api<{ models: any[] }>("/models");
    const list = models.filter((m) => !kind || m.kind === kind);
    return ok(
      list.map((m) => ({
        id: m.id,
        name: m.name,
        kind: m.kind,
        provider: m.provider,
        price: m.price,
        resolutions: m.resolutions,
        durations: m.durations,
        nativeAudio: m.nativeAudio,
        endFrame: m.endFrame,
        audioRef: m.audioRef,
        free: !!m.free,
        locked: m.locked ?? null,
        note: m.note,
        tip: m.tip,
      })),
    );
  }),
);

server.registerTool(
  "capabilities",
  {
    title: "Tudo que dá pra fazer",
    description: "Mapa de capacidades do CB Studio: pronto, em breve, planejado e ideias — com rota no app, ferramenta do MCP, como é feito e de qual plataforma veio (Higgsfield, Runway, Pika, HeyGen, OpusClip…).",
    inputSchema: { status: z.enum(["pronto", "em-breve", "planejado", "ideia"]).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ status }) => {
    const c = await api("/capabilities");
    return ok({ counts: c.counts, items: c.items.filter((i: any) => !status || i.status === status) });
  }),
);

server.registerTool(
  "estimate_cost",
  {
    title: "Estimar custo",
    description: "Quanto custa uma geração antes de pedir (não gasta nada). Diz se sai da cota grátis ou vai pro cartão.",
    inputSchema: { request: z.record(z.any()).describe("o mesmo objeto request de generate_*: { kind, model, prompt, durationSec, resolution, text, ... }") },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ request }) => {
    const est = await api("/estimate", { method: "POST", body: JSON.stringify({ request }) });
    return ok({ ...est, brl: brl(est.estimatedCostUsd), goesToCard: est.paid });
  }),
);

/* ───── gerações avulsas ───── */

const paidDoc = "true SOMENTE depois que o usuário autorizou explicitamente o valor estimado; modelos grátis não precisam";

server.registerTool(
  "generate_image",
  {
    title: "Gerar imagem",
    description: "Cria uma imagem. Grátis com Seedream 4.5 (padrão). GPT Image 2.5/2.6 e Nano Banana 2.1 (com até 14 referências pra manter a pessoa) cobram e precisam de FAL_KEY.",
    inputSchema: {
      prompt: z.string().min(3).describe("em inglês fica melhor; descreva sujeito, cenário, luz, estilo"),
      model: z.string().optional().describe("id de list_models(kind=image); padrão Seedream 4.5"),
      size: z.string().optional().describe("ex.: 1440x2560 (9:16, padrão dos quadrinhos), 2560x1440, 2048x2048"),
      referenceImages: z.array(z.string()).max(14).optional().describe("URLs ou /storage/... de referências (Nano Banana 2.1 / GPT Image edit)"),
      wait: z.boolean().optional().describe("esperar ficar pronta (até 3 min)"),
      confirmPaid: z.boolean().optional().describe(paidDoc),
    },
  },
  guarded(async ({ prompt, model, size, referenceImages, wait, confirmPaid }) => {
    const request = { kind: "image", prompt, model, size: size ?? "1440x2560", referenceImages };
    const c = await checkCost(request, confirmPaid, "Imagem");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, estimatedCostUsd: r.estimatedCostUsd, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 180)));
  }),
);

server.registerTool(
  "generate_video",
  {
    title: "Gerar vídeo",
    description: "Anima uma imagem (ou cria do texto). Grátis com Seedance 1.0 fast (imagem→vídeo, 5–10 s). Seedance 2.5 (fala + áudio nativo, 30 s), Kling 2.5/2.6/3.0/4.0 e Grok 1.5 cobram. Kling 3.0 Pro aceita lastFrame; Seedance 2.5 aceita audioRef (fala sincronizada).",
    inputSchema: {
      prompt: z.string().min(3).describe("o movimento: uma ação por cena, câmera, ritmo"),
      model: z.string().optional().describe("id de list_models(kind=video); padrão Seedance 1.0 fast"),
      firstFrame: z.string().optional().describe("URL ou /storage/... da imagem inicial"),
      lastFrame: z.string().optional().describe("frame final (Kling 3.0 Pro)"),
      durationSec: z.number().int().min(2).max(30).optional(),
      resolution: z.enum(["480p", "720p", "1080p"]).optional(),
      ratio: z.enum(["9:16", "16:9", "1:1", "4:3", "3:4", "21:9"]).optional(),
      audio: z.boolean().optional().describe("áudio nativo (modelos que têm)"),
      audioRef: z.string().optional().describe("áudio de referência pra fala sincronizada (Seedance 2.5)"),
      referenceImages: z.array(z.string()).max(30).optional(),
      wait: z.boolean().optional().describe("esperar ficar pronto (até 4 min)"),
      confirmPaid: z.boolean().optional().describe(paidDoc),
    },
  },
  guarded(async ({ wait, confirmPaid, ...rest }) => {
    const request = { kind: "video", ...rest, ratio: rest.ratio ?? "9:16", resolution: rest.resolution ?? "720p", durationSec: rest.durationSec ?? 5 };
    const c = await checkCost(request, confirmPaid, "Vídeo");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, estimatedCostUsd: r.estimatedCostUsd, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

server.registerTool(
  "generate_narration",
  {
    title: "Gerar narração",
    description: "Texto → fala em português com timestamps por palavra (legenda karaokê). Seed Audio: 60 min grátis, trava em VOICE_FREE_MINUTES. Use voiceId de list_voices pra falar com a voz clonada.",
    inputSchema: {
      text: z.string().min(1).max(3000),
      voiceId: z.string().uuid().optional().describe("voz clonada (list_voices)"),
      style: z.string().max(300).optional().describe("ex.: narrador calmo, ritmo de documentário"),
      speechRate: z.number().int().min(-50).max(100).optional(),
      model: z.string().optional().describe("id de list_models(kind=audio); padrão Seed Audio 1.0"),
      wait: z.boolean().optional().describe("esperar (até 2 min)"),
      confirmPaid: z.boolean().optional().describe(paidDoc),
    },
  },
  guarded(async ({ text, voiceId, style, speechRate, model, wait, confirmPaid }) => {
    let voiceRef: any;
    if (voiceId) {
      const v = await api(`/voices/${voiceId}`);
      voiceRef = { audioUrl: v.reference_url };
    }
    const request = { kind: "audio", text, voiceRef, style, speechRate, model, format: "wav", subtitles: true };
    const c = await checkCost(request, confirmPaid, "Narração");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, estimatedCostUsd: r.estimatedCostUsd, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 120)));
  }),
);

server.registerTool(
  "generate_sfx",
  {
    title: "Efeito sonoro ou trilha instrumental",
    description: "Som de cena por texto ('porta batendo', 'caixa registradora') ou, com 'music'/'trilha' no prompt, música instrumental de até 120 s (experimental) — pelo Seed Audio, na cota grátis de voz. model='elevenlabs-sfx' usa o ElevenLabs (pago).",
    inputSchema: { prompt: z.string().min(2).max(400), durationSec: z.number().min(0.5).max(120).optional(), model: z.enum(["seed-audio-sfx", "elevenlabs-sfx"]).optional(), wait: z.boolean().optional(), confirmPaid: z.boolean().optional().describe(paidDoc) },
  },
  guarded(async ({ prompt, durationSec, model, wait, confirmPaid }) => {
    const request = { kind: "sfx", prompt, durationSec, model };
    const c = await checkCost(request, confirmPaid, "Efeito sonoro");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 120)));
  }),
);

server.registerTool(
  "upscale_image",
  {
    title: "Melhorar imagem (upscale)",
    description: "Upscale criativo estilo Magnific (fal.ai Clarity, US$ 0,03/MP — cobra, precisa de FAL_KEY).",
    inputSchema: {
      imageUrl: z.string(),
      factor: z.number().min(1).max(4).optional(),
      creativity: z.number().min(0).max(1).optional(),
      resemblance: z.number().min(0).max(1).optional(),
      prompt: z.string().max(500).optional(),
      wait: z.boolean().optional(),
      confirmPaid: z.boolean().optional().describe(paidDoc),
    },
  },
  guarded(async ({ wait, confirmPaid, ...rest }) => {
    const request = { kind: "upscale", ...rest };
    const c = await checkCost(request, confirmPaid, "Upscale");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 180)));
  }),
);

/* ───── clone de pessoa ───── */

server.registerTool(
  "clone_person",
  {
    title: "Pessoa falando (clone)",
    description: "Foto da pessoa + fala → vídeo dela falando com a boca sincronizada. A fala vem de um áudio pronto (audioUrl) ou de text + voiceId (gera a narração com a voz clonada antes, grátis). Modelos: OmniHuman 1.5 (padrão), Kling Avatar, Seedance 2.5 — todos cobram. SÓ com autorização da pessoa.",
    inputSchema: {
      imageUrl: z.string().describe("foto de frente, bem iluminada (URL ou /storage/...)"),
      audioUrl: z.string().optional().describe("narração pronta"),
      text: z.string().max(1500).optional().describe("o que ela vai dizer (gera com voiceId)"),
      voiceId: z.string().uuid().optional(),
      model: z.string().optional().describe("id de list_models(kind=avatar) ou seedance-2.5"),
      prompt: z.string().max(500).optional().describe("direção: olhar pra câmera, sorrir no fim…"),
      resolution: z.enum(["720p", "1080p"]).optional(),
      wait: z.boolean().optional(),
      confirmPaid: z.boolean().optional().describe(paidDoc),
    },
  },
  guarded(async ({ imageUrl, audioUrl, text, voiceId, model, prompt, resolution, wait, confirmPaid }) => {
    let audio = audioUrl;
    let audioSec = 10;
    if (!audio) {
      if (!text || !voiceId) return fail("Passe audioUrl, ou text + voiceId (voz clonada de list_voices).");
      const v = await api(`/voices/${voiceId}`);
      const req = { kind: "audio", text, voiceRef: { audioUrl: v.reference_url }, format: "wav", subtitles: true };
      const r = await api("/generate", { method: "POST", body: JSON.stringify({ request: req }) });
      const j = await pollJob(r.jobId, 120);
      if (j.status !== "succeeded") return fail(`a narração falhou: ${j.error ?? j.status}`);
      audio = j.output_url;
      audioSec = Math.ceil(j.usage?.seconds ?? Math.max(3, text.length / 15));
    }
    const request = { kind: "avatar", model: model ?? "omnihuman-1.5", imageUrl, audioUrl: audio, prompt, resolution: resolution ?? "1080p", audioSec };
    const c = await checkCost(request, confirmPaid, "Pessoa falando");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, estimatedCostUsd: r.estimatedCostUsd, audioUrl: abs(audio), next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

server.registerTool(
  "lipsync",
  {
    title: "Arrumar a boca",
    description: "Troca a fala de um vídeo pronto por outra narração mantendo o rosto (Sync Lipsync 2, US$ 3/min; pro US$ 5/min — cobra, precisa de FAL_KEY).",
    inputSchema: { videoUrl: z.string(), audioUrl: z.string(), pro: z.boolean().optional(), videoSec: z.number().positive().optional(), wait: z.boolean().optional(), confirmPaid: z.boolean().optional().describe(paidDoc) },
  },
  guarded(async ({ wait, confirmPaid, ...rest }) => {
    const request = { kind: "lipsync", ...rest };
    const c = await checkCost(request, confirmPaid, "Lipsync");
    if ("content" in c) return c;
    const r = await api("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

/* ───── edição de vídeo gravado (local, grátis) ───── */

server.registerTool(
  "transcribe",
  {
    title: "Transcrever vídeo",
    description: "Vídeo ou áudio (upload_file antes, ou URL da biblioteca) → transcrição em português com tempo por palavra. Local (Whisper no Docker), grátis. ~1 min por 5 min de vídeo; a primeira vez baixa o modelo.",
    inputSchema: { videoUrl: z.string().describe("/storage/uploads/... ou URL"), wait: z.boolean().optional().describe("esperar (até 4 min; depois use wait_job)") },
  },
  guarded(async ({ videoUrl, wait }) => {
    const r = await api("/transcribe", { method: "POST", body: JSON.stringify({ videoUrl }) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId) → url do JSON da transcrição" });
    const j = await pollJob(r.jobId, 240);
    return ok({ ...jobView(j), transcriptUrl: abs(j.output_url), words: j.usage?.words, minutes: j.usage?.durationSec ? Math.round(j.usage.durationSec / 60) : undefined });
  }),
);

server.registerTool(
  "get_transcript",
  {
    title: "Ler transcrição",
    description: "Texto (com tempos) de uma transcrição já feita — de um job transcribe, caption, cuts ou recreate. Use pra escrever posts, resumos, cortes manuais. format=srt/vtt devolve a legenda pronta pra YouTube.",
    inputSchema: { jobId: z.string().uuid(), format: z.enum(["json", "txt", "srt", "vtt"]).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ jobId, format }) => {
    if (format && format !== "json") {
      const r = await fetch(`${API}/transcripts/${jobId}/export?format=${format}`, { headers: AUTH });
      if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
      return ok(await r.text());
    }
    const t = await api(`/transcripts/${jobId}`);
    return ok({ jobId: t.jobId, durationSec: t.durationSec, language: t.language, model: t.model, text: t.text, segments: t.segments });
  }),
);

server.registerTool(
  "caption_video",
  {
    title: "Legendar vídeo (karaokê)",
    description: "Vídeo gravado → MP4 com a legenda karaokê da G2 (frases curtas, palavra atual em dourado, caixa alta), reenquadrado em 9:16 se pedir. Transcreve sozinho se ainda não tiver transcrição. Local, grátis.",
    inputSchema: {
      videoUrl: z.string(),
      format: z.enum(["9:16", "original", "1:1", "16:9"]).optional().describe("padrão 9:16 (o recorte segue quem fala)"),
      reframe: z.enum(["face", "center"]).optional().describe("padrão face: o recorte segue o rosto de quem fala (detector local, grátis); center = corte central fixo"),
      logo: z.boolean().optional().describe("logo da marca no canto (se houver em set_brand_logo); padrão true"),
      title: z.string().max(80).optional().describe("gancho escrito no topo nos 3 primeiros segundos"),
      uppercase: z.boolean().optional(),
      fontSize: z.number().int().min(24).max(140).optional(),
      cutSilence: z.boolean().optional().describe("edição automática: tira pausas/silêncios"),
      cutFillers: z.boolean().optional().describe("tira 'ééé', 'hum', 'né' de muleta e repetições (marcados na revisão da transcrição); padrão = cutSilence"),
      zooms: z.boolean().optional().describe("edição automática: zoom suave nas frases fortes"),
      broll: z.number().int().min(0).max(12).optional().describe("b-roll gerado: até N imagens (Seedream, cota grátis) nas frases com objeto/lugar/número"),
      brollStyle: z.enum(["cinematic", "epic", "comic", "anime", "flat"]).optional(),
      context: z.string().max(600).optional(),
      wait: z.boolean().optional(),
    },
  },
  guarded(async ({ wait, ...rest }) => {
    const r = await api("/caption", { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, reusedTranscript: r.reusedTranscript, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

server.registerTool(
  "rerender_cut",
  {
    title: "Refazer um corte com outros limites",
    description: "Ajusta começo/fim (segundos do vídeo original) e o gancho de um corte já feito (job kind 'cut' de make_cuts) e gera um clipe novo com as mesmas opções. Grátis. Use get_transcript pra achar os tempos certos.",
    inputSchema: {
      cutJobId: z.string().uuid().describe("id do corte (usage.clips[].jobId de make_cuts)"),
      start: z.number().min(0),
      end: z.number().min(1),
      title: z.string().max(80).optional(),
      format: z.enum(["9:16", "original", "1:1", "16:9"]).optional(),
      cutSilence: z.boolean().optional(),
      cutFillers: z.boolean().optional(),
      zooms: z.boolean().optional(),
      reframe: z.enum(["face", "center"]).optional(),
      wait: z.boolean().optional(),
    },
  },
  guarded(async ({ cutJobId, wait, ...rest }) => {
    const r = await api(`/cuts/${cutJobId}/rerender`, { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

server.registerTool(
  "dub_video",
  {
    title: "Dublar vídeo (inglês, espanhol…) com a voz de quem fala",
    description: "O mesmo vídeo em outra língua, grátis: Whisper transcreve, Seed 2.1 traduz no tempo da fala, Seed Audio fala com a voz clonada do próprio vídeo e o FFmpeg troca o áudio (legenda traduzida queimada por padrão). Usa a cota grátis de voz (~1 min por minuto de fala). Sem boca refeita (isso é o lipsync, pago). ATENÇÃO: clonar a voz exige autorização de quem aparece — só passe consent:true depois que o usuário confirmar que é ele ou que tem autorização.",
    inputSchema: {
      videoUrl: z.string(),
      language: z.enum(["pt-BR", "en", "es", "it", "fr", "de", "ja"]).optional().describe("padrão en; pt-BR = regrava a narração limpa (sem vícios) na mesma língua"),
      voice: z.string().optional().describe("same (voz do vídeo, padrão) · default (voz padrão) · id de voz cadastrada (list_voices)"),
      consent: z.boolean().optional().describe("obrigatório com voice=same: a pessoa do vídeo autorizou"),
      captions: z.boolean().optional().describe("padrão true: legenda traduzida karaokê"),
      format: z.enum(["9:16", "original", "1:1", "16:9"]).optional().describe("padrão original"),
      context: z.string().max(600).optional().describe("sobre o vídeo, termos que não traduzir"),
      bedVolume: z.number().min(0).max(0.5).optional().describe("áudio original por baixo (0 = troca completa)"),
      wait: z.boolean().optional().describe("esperar (até 4 min; depois wait_job)"),
    },
  },
  guarded(async ({ wait, ...rest }) => {
    const r = await api("/dub", { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, reusedTranscript: r.reusedTranscript, next: "wait_job(jobId) → MP4 em outputUrl, tradução em usage.translation" });
    const j = await pollJob(r.jobId, 240);
    return ok({ ...jobView(j), translation: j.usage?.translation, stillRunning: j.status === "queued" || j.status === "running" });
  }),
);

server.registerTool(
  "make_cuts",
  {
    title: "Cortes virais de vídeo longo",
    description: "Aula/live → N cortes autocontidos (gancho na tela, legenda karaokê, 9:16) escolhidos pelo Seed 2.1 com nota de viralidade. Local, grátis. Uma aula de 1 h leva ~10–15 min. O resultado lista os clipes (cada um vira um item da biblioteca 'cuts').",
    inputSchema: {
      videoUrl: z.string(),
      count: z.number().int().min(1).max(20).optional().describe("padrão 6"),
      minSec: z.number().int().min(10).max(120).optional().describe("padrão 25"),
      maxSec: z.number().int().min(15).max(180).optional().describe("padrão 70"),
      context: z.string().max(600).optional().describe("sobre o vídeo / o que destacar"),
      format: z.enum(["9:16", "original", "1:1", "16:9"]).optional(),
      cutSilence: z.boolean().optional().describe("padrão true: tira pausas"),
      cutFillers: z.boolean().optional().describe("padrão true: tira 'ééé', 'hum', 'né' de muleta e repetições"),
      zooms: z.boolean().optional().describe("padrão true: zoom nas frases fortes"),
      broll: z.number().int().min(0).max(4).optional().describe("b-roll gerado por corte (0–4; Seedream, cota grátis)"),
      brollStyle: z.enum(["cinematic", "epic", "comic", "anime", "flat"]).optional(),
      reframe: z.enum(["face", "center"]).optional().describe("padrão face: o recorte 9:16 segue o rosto de quem fala (detector local); center = corte central fixo"),
      logo: z.boolean().optional().describe("logo da marca no canto (se houver); padrão true"),
      wait: z.boolean().optional().describe("esperar (até 4 min; depois use wait_job no jobId — os clipes ficam em usage.clips)"),
    },
  },
  guarded(async ({ wait, ...rest }) => {
    const r = await api("/cuts", { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, reusedTranscript: r.reusedTranscript, next: "wait_job(jobId) → clipes em usage.clips" });
    const j = await pollJob(r.jobId, 240);
    return ok({ ...jobView(j), clips: (j.usage?.clips ?? []).map((c: any) => ({ ...c, url: abs(c.url) })), stillRunning: j.status === "queued" || j.status === "running" });
  }),
);

server.registerTool(
  "recreate_from_video",
  {
    title: "Recriar um vídeo que performou",
    description: "Anúncio/vídeo de referência (seu ou de concorrente) + o seu tema → o estúdio transcreve, entende gancho/batidas/CTA e escreve um roteiro novo na mesma estrutura, já como projeto Quadrinhos. Grátis (texto na cota). Leva 2–4 min.",
    inputSchema: {
      videoUrl: z.string().describe("/storage/uploads/... (upload_file) ou URL da biblioteca"),
      theme: z.string().min(3).max(600).describe("o tema/oferta do vídeo novo"),
      style: z.enum(["epic", "comic", "anime", "cinematic", "flat"]).optional(),
      scenes: z.number().int().min(1).max(20).optional().describe("padrão: o que a referência sugerir"),
      voiceId: z.string().uuid().optional(),
      context: z.string().max(600).optional().describe("o que é a referência / o que copiar dela"),
      projectId: z.string().uuid().optional().describe("reescrever um projeto existente em vez de criar"),
      wait: z.boolean().optional().describe("esperar (até 4 min; depois wait_job — projectId fica em usage.projectId)"),
    },
  },
  guarded(async ({ wait, ...rest }) => {
    const r = await api("/script/from-video", { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId) → usage.projectId" });
    const j = await pollJob(r.jobId, 240);
    return ok({ ...jobView(j), projectId: j.usage?.projectId, title: j.usage?.title, scenes: j.usage?.scenes, analysis: j.usage?.analysis, open: j.usage?.projectId ? `${WEB}/projects/${j.usage.projectId}` : undefined, next: j.usage?.projectId ? "get_project → produce(image)" : undefined });
  }),
);

server.registerTool(
  "review_virality",
  {
    title: "Nota de viralidade",
    description: "Avalia um roteiro (projectId), uma transcrição (transcriptUrl) ou um texto: nota 0–10 de gancho, ritmo, clareza da oferta e CTA, com melhorias concretas e o gancho reescrito. Grátis, ~15 s.",
    inputSchema: { projectId: z.string().uuid().optional(), transcriptUrl: z.string().optional(), text: z.string().max(40000).optional(), context: z.string().max(600).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async (a) => ok(await api("/review", { method: "POST", body: JSON.stringify(a) }, 120_000))),
);

/* ───── anúncios em escala ───── */

server.registerTool(
  "ads_hooks",
  {
    title: "Sugerir ganchos",
    description: "Produto/oferta → N ganchos com ângulos diferentes (dor, história, mito, número, contraintuitivo…), cada um a primeira frase de um anúncio. Grátis.",
    inputSchema: { product: z.string().min(3).max(600), offer: z.string().max(300).optional(), audience: z.string().max(300).optional(), count: z.number().int().min(1).max(12).optional(), context: z.string().max(600).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async (a) => ok(await api("/ads/hooks", { method: "POST", body: JSON.stringify(a) }, 120_000))),
);

server.registerTool(
  "ads_create",
  {
    title: "Criar campanha de anúncios",
    description: "Cria uma campanha com um quadrinho por gancho (mesma ficha de personagem) e escreve os roteiros em lote (~1 min cada, grátis). Depois: ads_status, ads_produce(image → audio → video), ads_render.",
    inputSchema: {
      campaign: z.string().min(1).max(120).describe("nome da campanha"),
      product: z.string().min(3).max(600),
      offer: z.string().max(300).optional(),
      audience: z.string().max(300).optional(),
      hooks: z.array(z.object({ angle: z.string().optional(), hook: z.string().min(3).max(200) })).min(1).max(12).describe("de ads_hooks ou escritos pelo usuário"),
      style: z.enum(["epic", "comic", "anime", "cinematic", "flat"]).optional(),
      voiceId: z.string().uuid().optional(),
      videoModel: z.string().optional().describe("'modelo:resolução' — padrão Seedance 1.0 fast 720p (grátis)"),
      scenes: z.number().int().min(3).max(14).optional(),
      tone: z.string().optional(),
    },
  },
  guarded(async (a) => {
    const r = await api("/ads", { method: "POST", body: JSON.stringify(a) });
    return ok({ ...r, open: `${WEB}/ads`, next: "wait_job(jobId) até os roteiros ficarem prontos (usage.ok) → ads_produce(campaignId, image)" });
  }),
);

server.registerTool(
  "ads_status",
  { title: "Status da campanha", description: "Cada anúncio da campanha com o que está pronto e o que falta.", inputSchema: { campaignId: z.string().uuid().optional().describe("sem id: lista todas as campanhas") }, annotations: { readOnlyHint: true } },
  guarded(async ({ campaignId }) => {
    if (!campaignId) return ok((await api("/ads")).campaigns);
    const st = await api(`/ads/${campaignId}`);
    return ok({ ...st, projects: st.projects.map((p: any) => ({ ...p, renderUrl: abs(p.renderUrl), open: `${WEB}/projects/${p.id}` })) });
  }),
);

server.registerTool(
  "ads_produce",
  {
    title: "Produzir a campanha",
    description: "Gera um tipo (image, audio ou video) em todos os anúncios da campanha, tudo-ou-nada por projeto. Estima antes; se for pro cartão, só executa com confirmPaid:true (depois do sim do usuário). Ordem: image → audio → video.",
    inputSchema: { campaignId: z.string().uuid(), kind: z.enum(["image", "audio", "video"]), confirmPaid: z.boolean().optional().describe(paidDoc) },
  },
  guarded(async ({ campaignId, kind, confirmPaid }) => {
    const e = await api(`/ads/${campaignId}/estimate`, { method: "POST", body: JSON.stringify({ kind }) });
    if (!e.scenes) return ok({ queued: 0, note: `nada pendente de ${kind}` });
    if (e.paid && !confirmPaid) return fail(`Campanha: ${e.scenes} ${kind} em ${e.projects} anúncios com ${e.model} = ${usd(e.totalUsd)} (${brl(e.totalUsd)}) — VAI PRO CARTÃO. Não executei. Pergunte ao usuário e, só com o sim, chame de novo com confirmPaid: true.`, e);
    const r = await api(`/ads/${campaignId}/produce`, { method: "POST", body: JSON.stringify({ kind, allowPaid: !!confirmPaid }) });
    return ok({ ...r, brl: brl(r.totalUsd), next: "ads_status(campaignId) pra acompanhar" });
  }),
);

server.registerTool(
  "ads_render",
  { title: "Montar todos os anúncios", description: "Monta o MP4 final de cada anúncio da campanha que tiver cenas prontas (FFmpeg local, grátis).", inputSchema: { campaignId: z.string().uuid() } },
  guarded(async ({ campaignId }) => ok(await api(`/ads/${campaignId}/render`, { method: "POST", body: "{}" }))),
);

/* ───── publicar ───── */

server.registerTool(
  "publish_instagram",
  {
    title: "Publicar Reels no Instagram",
    description: "Posta um MP4 do estúdio como Reels na conta do Instagram configurada no .env (IG_USER_ID + META_ACCESS_TOKEN). Não custa nada. Confirme a legenda com o usuário antes — é uma publicação pública.",
    inputSchema: { videoUrl: z.string(), caption: z.string().max(2200), shareToFeed: z.boolean().optional() },
  },
  guarded(async (a) => ok(await api("/publish/instagram", { method: "POST", body: JSON.stringify(a) }, 600_000))),
);

server.registerTool(
  "publish_meta_ads",
  {
    title: "Subir vídeo no Meta Ads",
    description: "Envia o MP4 pra conta de anúncios (META_AD_ACCOUNT_ID) — vira um vídeo disponível pra montar o criativo no Gerenciador ou pelo MCP do Meta Ads. Não custa nada.",
    inputSchema: { videoUrl: z.string(), name: z.string().min(1).max(120) },
  },
  guarded(async (a) => ok(await api("/publish/meta-ads", { method: "POST", body: JSON.stringify(a) }, 600_000))),
);

server.registerTool(
  "extend_video",
  {
    title: "Estender um vídeo (+5 s ou +10 s)",
    description: "Continua um vídeo gerado: tira o último frame, o Seedance 1.0 (cota grátis) gera a sequência com o mesmo prompt de movimento e o FFmpeg emenda. Passe o jobId do vídeo (video, cut, render…). Grátis com o modelo padrão; outro modelo pago exige allowPaid.",
    inputSchema: { jobId: z.string().uuid(), prompt: z.string().max(800).optional().describe("movimento da continuação (padrão: o do vídeo original)"), durationSec: z.union([z.literal(5), z.literal(10)]).optional(), resolution: z.enum(["480p", "720p", "1080p"]).optional(), wait: z.boolean().optional() },
  },
  guarded(async ({ jobId, wait, ...rest }) => {
    const r = await api(`/videos/${jobId}/extend`, { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

server.registerTool(
  "upscale_video",
  {
    title: "Ampliar vídeo pra 1080p/4K (sem IA, grátis)",
    description: "Lanczos + nitidez leve, e 60 fps por interpolação se pedir (lento). Local e grátis — pra YouTube/TV. O upscale com IA (Topaz/FLUX na fal) é pago e recupera detalhe de verdade.",
    inputSchema: { jobId: z.string().uuid(), to: z.enum(["1080p", "4k"]).optional(), fps60: z.boolean().optional(), wait: z.boolean().optional() },
  },
  guarded(async ({ jobId, wait, ...rest }) => {
    const r = await api(`/videos/${jobId}/upscale`, { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId)" });
    return ok(jobView(await pollJob(r.jobId, 240)));
  }),
);

server.registerTool(
  "make_carousel",
  {
    title: "Carrossel pro Instagram",
    description: "Tema → carrossel pronto: Seed 2.1 escreve capa com gancho, um ponto por slide e CTA (+ legenda e hashtags), Seedream gera a arte de cada slide (cota grátis, ~US$ 0,04 nominal por slide) e o FFmpeg compõe o texto. Sai PNG por slide (1080×1350) e um zip. Leva ~2 min; use wait_job. Instagram não aceita carrossel por API sem URL pública — o usuário posta o zip pelo app.",
    inputSchema: {
      theme: z.string().min(3).max(600),
      slides: z.number().int().min(3).max(10).optional().describe("padrão 7"),
      style: z.enum(["flat", "epic", "comic", "anime", "cinematic"]).optional().describe("arte dos fundos; padrão flat"),
      format: z.enum(["4:5", "1:1"]).optional(),
      audience: z.string().max(200).optional(),
      tone: z.string().max(200).optional(),
      context: z.string().max(600).optional(),
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("cor de destaque, padrão #F5C04A"),
      logo: z.boolean().optional(),
      wait: z.boolean().optional(),
    },
  },
  guarded(async ({ wait, ...rest }) => {
    const r = await api("/carousel", { method: "POST", body: JSON.stringify(rest) });
    if (!wait) return ok({ jobId: r.jobId, status: r.status, next: "wait_job(jobId) → slides em usage.slides, zip em usage.zipUrl, legenda em usage.caption" });
    const j = await pollJob(r.jobId, 240);
    return ok({ ...jobView(j), slides: (j.usage?.slides ?? []).map((s: any) => ({ ...s, url: abs(s.url) })), zipUrl: j.usage?.zipUrl ? abs(j.usage.zipUrl) : null, caption: j.usage?.caption, hashtags: j.usage?.hashtags, stillRunning: j.status === "queued" || j.status === "running" });
  }),
);

server.registerTool(
  "set_brand_logo",
  {
    title: "Logo da marca nos vídeos",
    description: "Define (ou remove, com url=null) o PNG que entra no canto dos cortes, legendas e dublagens. Suba o PNG com upload_file antes e passe a url. Grátis.",
    inputSchema: { url: z.string().nullable(), position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(), size: z.number().min(0.05).max(0.4).optional().describe("fração da largura, padrão 0.14"), opacity: z.number().min(0.1).max(1).optional() },
  },
  guarded(async ({ url, ...rest }) => ok(await api("/brand", { method: "PUT", body: JSON.stringify({ logo: url ? { url, ...rest } : null }) }))),
);

server.registerTool(
  "write_copy",
  {
    title: "Escrever legenda/título/hashtags do post",
    description: "Seed 2.1 escreve gancho, legenda, CTA e hashtags (Instagram, TikTok, YouTube ou texto de anúncio) a partir do que o vídeo diz: passe o jobId de um corte, legenda, dublagem ou render, ou um projectId, ou o texto. Grátis (cota de texto). Use antes de publish_instagram / publish_youtube.",
    inputSchema: { jobId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), text: z.string().max(20_000).optional(), platform: z.enum(["instagram", "youtube", "tiktok", "ads"]).optional(), context: z.string().max(600).optional(), language: z.string().optional().describe("pt-BR (padrão), en, es…") },
    annotations: { readOnlyHint: true },
  },
  guarded(async (a) => ok(await api("/copy", { method: "POST", body: JSON.stringify(a) }, 120_000))),
);

server.registerTool(
  "publish_youtube",
  {
    title: "Publicar no YouTube Shorts",
    description: "Sobe um MP4 do estúdio no canal do YouTube conectado em Provedores → Publicar (vertical curto vira Short). Não custa nada. Confirme título, descrição e visibilidade com o usuário antes — 'public' publica na hora; 'unlisted' é o jeito seguro de revisar primeiro.",
    inputSchema: { videoUrl: z.string(), title: z.string().min(1).max(100), description: z.string().max(5000).optional(), tags: z.array(z.string()).max(30).optional(), privacy: z.enum(["public", "unlisted", "private"]).optional().describe("padrão: public"), shorts: z.boolean().optional().describe("acrescenta #Shorts no título (padrão true)"), captionsJobId: z.string().uuid().optional().describe("job de corte/legenda/dublagem/transcrição: sobe a legenda .srt junto (CC)") },
  },
  guarded(async (a) => ok(await api("/publish/youtube", { method: "POST", body: JSON.stringify(a) }, 900_000))),
);

/* ───── vozes ───── */

server.registerTool(
  "list_voices",
  { title: "Vozes clonadas", description: "Vozes cadastradas com quem autorizou.", inputSchema: {}, annotations: { readOnlyHint: true } },
  guarded(async () => {
    const { voices } = await api("/voices");
    return ok(voices.map((v: any) => ({ id: v.id, name: v.name, description: v.description, consentName: v.consent_name, consentAt: v.consent_at, referenceUrl: abs(v.reference_url) })));
  }),
);

server.registerTool(
  "create_voice",
  {
    title: "Clonar uma voz",
    description: "Cadastra uma voz a partir de 10–30 s de áudio limpo (upload_file antes). Exige o nome de quem autorizou — nunca cadastre voz de terceiros sem autorização.",
    inputSchema: {
      name: z.string().min(1).max(80),
      referenceUrl: z.string().describe("/storage/uploads/... (use upload_file)"),
      consentName: z.string().min(2).max(120).describe("nome completo da pessoa dona da voz, que autorizou"),
      consentNote: z.string().max(500).optional(),
      description: z.string().max(300).optional(),
    },
  },
  guarded(async (a) => {
    const v = await api("/voices", { method: "POST", body: JSON.stringify({ ...a, consentNote: a.consentNote ?? "Autorização confirmada via MCP" }) });
    return ok({ id: v.id, name: v.name, consentName: v.consent_name });
  }),
);

/* ───── biblioteca, jobs, upload ───── */

server.registerTool(
  "list_library",
  {
    title: "Biblioteca",
    description: "Gerações concluídas e uploads por tipo (image, video, clone = pessoas, cuts = cortes e vídeos legendados, audio, render = vídeos finais, transcribe = transcrições).",
    inputSchema: { kind: z.enum(["image", "video", "clone", "cuts", "audio", "render", "transcribe"]).optional(), limit: z.number().int().min(1).max(100).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ kind, limit }) => {
    const r = await api(`/library${kind ? `?kind=${kind}` : ""}`);
    const n = limit ?? 30;
    return ok({
      generated: r.generated.slice(0, n).map((j: any) => ({ id: j.id, kind: j.kind, url: abs(j.output_url), model: j.request?.model, prompt: (j.request?.prompt ?? j.request?.text ?? "").slice(0, 120), createdAt: j.created_at })),
      uploads: r.uploads.slice(0, n).map((u: any) => ({ id: u.id, kind: u.kind, name: u.name, url: abs(u.url), createdAt: u.created_at })),
    });
  }),
);

server.registerTool(
  "get_job",
  { title: "Ver geração", description: "Status, arquivo e erro de uma geração.", inputSchema: { jobId: z.string().uuid() }, annotations: { readOnlyHint: true } },
  guarded(async ({ jobId }) => ok(jobView(await api(`/jobs/${jobId}`)))),
);

server.registerTool(
  "wait_job",
  {
    title: "Esperar geração",
    description: "Espera uma geração terminar (até timeoutSec, máx. 240). Se ainda estiver rodando, chame de novo.",
    inputSchema: { jobId: z.string().uuid(), timeoutSec: z.number().int().min(5).max(240).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ jobId, timeoutSec }) => ok(jobView(await pollJob(jobId, timeoutSec ?? 180)))),
);

server.registerTool(
  "upload_file",
  {
    title: "Enviar arquivo",
    description: "Sobe um arquivo local (foto, vídeo, áudio) pra biblioteca e devolve a URL pra usar como referência, foto do clone ou áudio da voz.",
    inputSchema: { path: z.string().describe("caminho absoluto no computador onde o MCP roda") },
  },
  guarded(async ({ path }) => {
    const bytes = await readFile(path);
    const ext = extname(path).toLowerCase();
    const mime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg" };
    const fd = new FormData();
    fd.append("file", new Blob([bytes as BlobPart], { type: mime[ext] ?? "application/octet-stream" }), basename(path));
    const r = await fetch(`${API}/uploads`, { method: "POST", body: fd, headers: AUTH });
    const body: any = await r.json();
    if (!r.ok) throw new ApiError(r.status, body);
    return ok({ id: body.id, kind: body.kind, url: body.url, absoluteUrl: abs(body.url), bytes: body.bytes });
  }),
);

/* ───── quadrinhos: projetos ───── */

const sceneView = (s: any) => ({
  id: s.id,
  position: s.position,
  type: s.type,
  script: s.script,
  imagePrompt: s.image_prompt,
  motionPrompt: s.motion_prompt,
  durationSec: s.duration_sec,
  card: s.card,
  image: s.image_job ? { status: s.image_job.status, url: abs(s.image_job.output_url), error: s.image_job.error } : null,
  video: s.video_job ? { status: s.video_job.status, url: abs(s.video_job.output_url), error: s.video_job.error } : null,
  audio: s.audio_job ? { status: s.audio_job.status, url: abs(s.audio_job.output_url), seconds: s.audio_job.usage?.seconds } : null,
});

server.registerTool(
  "list_projects",
  { title: "Projetos (quadrinhos)", description: "Lista os projetos com cenas prontas e vídeo final.", inputSchema: {}, annotations: { readOnlyHint: true } },
  guarded(async () => {
    const { projects } = await api("/projects");
    return ok(projects.map((p: any) => ({ id: p.id, title: p.title, style: p.style, scenes: p.scene_count, ready: p.ready_count, renderUrl: abs(p.render_url), updatedAt: p.updated_at, open: `${WEB}/projects/${p.id}` })));
  }),
);

server.registerTool(
  "get_project",
  {
    title: "Ver projeto",
    description: "Status do projeto (o que está pronto e o que falta) e as cenas com roteiro, prompts e arquivos.",
    inputSchema: { projectId: z.string().uuid(), scenes: z.boolean().optional().describe("incluir as cenas (padrão true)") },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ projectId, scenes }) => {
    const [p, st] = await Promise.all([api(`/projects/${projectId}`), api(`/projects/${projectId}/status`)]);
    return ok({ ...st, renderUrl: abs(st.renderUrl), characterSheet: p.character_sheet, captionStyle: p.caption_style, open: `${WEB}/projects/${projectId}`, scenes: scenes === false ? undefined : p.scenes.map(sceneView) });
  }),
);

server.registerTool(
  "create_project",
  {
    title: "Novo quadrinho (tema → roteiro)",
    description: "Cria o projeto e escreve o roteiro com as regras da G2 (ficha de personagem, cenas de 4–5 s, cards de abertura e CTA). Custo ~US$ 0,005 (cota grátis). Leva 1–2 min. Depois: get_project pra revisar, produce pra gerar.",
    inputSchema: {
      theme: z.string().min(3).max(600).describe("tema / história / oferta do vídeo"),
      title: z.string().max(120).optional(),
      style: z.enum(["epic", "comic", "anime", "cinematic", "flat"]).optional().describe("padrão epic (o que mais vendeu)"),
      scenes: z.number().int().min(1).max(20).optional().describe("quantidade de cenas (padrão 8)"),
      voiceId: z.string().uuid().optional().describe("voz clonada pra narração"),
      videoModel: z.string().optional().describe("motor de vídeo 'modelo:resolução', ex.: seedance-1-0-pro-fast-251015:720p (grátis) ou kling-3.0:1080p"),
      audience: z.string().optional(),
      tone: z.string().optional(),
      writeScript: z.boolean().optional().describe("escrever o roteiro já (padrão true)"),
    },
  },
  guarded(async ({ theme, title, style, scenes, voiceId, videoModel, audience, tone, writeScript }) => {
    const p = await api("/projects", { method: "POST", body: JSON.stringify({ title: title ?? theme.slice(0, 80), theme, style: style ?? "epic" }) });
    if (voiceId || videoModel) await api(`/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ voice_id: voiceId, video_model: videoModel }) });
    if (writeScript === false) return ok({ projectId: p.id, open: `${WEB}/projects/${p.id}`, next: "write_script(projectId)" });
    const out = await api("/script", { method: "POST", body: JSON.stringify({ projectId: p.id, theme, scenes: scenes ?? 8, style: style ?? "epic", audience, tone }) }, 240_000);
    return ok({ projectId: p.id, title: out.title, characterSheet: out.character_sheet, scenes: out.scenes.map(sceneView), open: `${WEB}/projects/${p.id}`, next: "revise as cenas (edit_scene) e depois produce(kind=image)" });
  }),
);

server.registerTool(
  "write_script",
  {
    title: "Reescrever o roteiro",
    description: "Escreve (ou reescreve) todas as cenas de um projeto a partir do tema. Substitui as cenas atuais.",
    inputSchema: { projectId: z.string().uuid(), theme: z.string().min(3).max(600), scenes: z.number().int().min(1).max(20).optional(), style: z.string().optional(), audience: z.string().optional(), tone: z.string().optional(), characterSheet: z.string().optional() },
  },
  guarded(async ({ projectId, ...rest }) => {
    const out = await api("/script", { method: "POST", body: JSON.stringify({ projectId, ...rest, scenes: rest.scenes ?? 8, style: rest.style ?? "epic" }) }, 240_000);
    return ok({ title: out.title, characterSheet: out.character_sheet, scenes: out.scenes.map(sceneView) });
  }),
);

server.registerTool(
  "update_project",
  {
    title: "Ajustar projeto",
    description: "Título, estilo, ficha do personagem, voz, direção e ritmo da narração, motor de vídeo, estilo de legenda, trilha.",
    inputSchema: {
      projectId: z.string().uuid(),
      title: z.string().max(120).optional(),
      style: z.string().optional(),
      characterSheet: z.string().optional(),
      voiceId: z.string().uuid().nullable().optional(),
      videoModel: z.string().optional().describe("'modelo:resolução'"),
      captionStyle: z.enum(["karaoke", "sentence"]).optional(),
      captionUppercase: z.boolean().optional(),
      musicUrl: z.string().nullable().optional(),
      musicVolume: z.number().min(0).max(1).optional(),
      narrationStyle: z.string().max(300).nullable().optional().describe("direção da voz pra todas as cenas, ex.: 'narrador de Reels, suspense, ritmo ágil'"),
      speechRate: z.number().int().min(-50).max(100).nullable().optional().describe("ritmo da fala: 0 normal, 12 ágil, 25 bem rápido"),
    },
  },
  guarded(async ({ projectId, title, style, characterSheet, voiceId, videoModel, captionStyle, captionUppercase, musicUrl, musicVolume, narrationStyle, speechRate }) => {
    const p = await api(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ title, style, character_sheet: characterSheet, voice_id: voiceId, video_model: videoModel, caption_style: captionStyle, caption_uppercase: captionUppercase, music_url: musicUrl, music_volume: musicVolume, narration_style: narrationStyle, speech_rate: speechRate }) });
    return ok({ id: p.id, title: p.title, style: p.style, voiceId: p.voice_id, videoModel: p.video_model, captionStyle: p.caption_style });
  }),
);

server.registerTool(
  "edit_scene",
  {
    title: "Editar cena",
    description: "Muda roteiro, prompt de imagem, prompt de movimento, duração ou card de uma cena (pela posição, começando em 1, ou pelo id). Mudar o prompt não regera nada — chame produce depois.",
    inputSchema: {
      projectId: z.string().uuid(),
      scene: z.union([z.number().int().min(1), z.string().uuid()]).describe("posição (1 = primeira) ou id da cena"),
      script: z.string().optional(),
      imagePrompt: z.string().optional(),
      motionPrompt: z.string().optional(),
      durationSec: z.number().int().min(1).max(12).optional(),
      card: z.object({ text: z.string().optional(), subtext: z.string().optional(), button: z.string().optional() }).optional(),
    },
  },
  guarded(async ({ projectId, scene, script, imagePrompt, motionPrompt, durationSec, card }) => {
    const p = await api(`/projects/${projectId}`);
    const target = typeof scene === "number" ? p.scenes[scene - 1] : p.scenes.find((s: any) => s.id === scene);
    if (!target) return fail(`cena ${scene} não existe (o projeto tem ${p.scenes.length})`);
    const scenes = p.scenes.map((s: any) => ({
      id: s.id,
      script: s.id === target.id && script !== undefined ? script : s.script ?? "",
      image_prompt: s.id === target.id && imagePrompt !== undefined ? imagePrompt : s.image_prompt,
      motion_prompt: s.id === target.id && motionPrompt !== undefined ? motionPrompt : s.motion_prompt,
      duration_sec: s.id === target.id && durationSec !== undefined ? durationSec : s.duration_sec,
      type: s.type,
      card: s.id === target.id && card ? { ...(s.card ?? {}), ...card } : s.card,
    }));
    const out = await api(`/projects/${projectId}/scenes`, { method: "PUT", body: JSON.stringify({ scenes }) });
    return ok(sceneView(out.scenes.find((s: any) => s.id === target.id)));
  }),
);

server.registerTool(
  "narrate_project",
  {
    title: "Narração contínua",
    description: "Gera a narração do projeto inteiro numa tomada só (todas as falas, sem emenda entre cenas — entonação natural, sem microcortes). O render passa a cortar as cenas em cima dela. Grátis (cota de voz). Gere de novo se mudar alguma fala.",
    inputSchema: { projectId: z.string().uuid() },
  },
  guarded(async ({ projectId }) => {
    const r = await api(`/projects/${projectId}/narration`, { method: "POST", body: "{}" });
    const job = await pollJob(r.jobId, 150);
    const check = job?.usage?.check;
    return ok({ jobId: r.jobId, status: job?.status, seconds: job?.usage?.seconds, url: abs(job?.output_url), chars: r.chars, check, next: check && !check.ok ? "a voz pulou palavras — chame narrate_project de novo" : "render_project" });
  }),
);

server.registerTool(
  "still_scene",
  {
    title: "Plano parado (imagem com zoom)",
    description:
      "Troca o vídeo de IA de uma cena por um plano parado: a imagem da cena com zoom de aproximação (local, grátis, pronto em segundos). Use em gráfico, tela, documento e texto — o modelo de vídeo redesenha esses elementos no meio do plano — ou pra poupar a cota de vídeo. Dura a fala da cena; depois chame render_project.",
    inputSchema: {
      projectId: z.string().uuid(),
      scene: z.union([z.number().int().min(1), z.string().uuid()]).describe("posição (1 = primeira) ou id da cena"),
      zoom: z.number().min(1).max(1.6).optional().describe("zoom final; padrão 1.18 (aproxima 18%)"),
      focusX: z.number().min(0).max(1).optional().describe("ponto que fica no lugar enquanto aproxima, 0 = esquerda, 1 = direita (padrão 0.5)"),
      focusY: z.number().min(0).max(1).optional().describe("0 = topo, 1 = base (padrão 0.45)"),
      durationSec: z.number().min(1.5).max(15).optional().describe("padrão: a duração da fala da cena"),
    },
  },
  guarded(async ({ projectId, scene, zoom, focusX, focusY, durationSec }) => {
    const p = await api(`/projects/${projectId}`);
    const target = typeof scene === "number" ? p.scenes[scene - 1] : p.scenes.find((s: any) => s.id === scene);
    if (!target) return fail(`cena ${scene} não existe (o projeto tem ${p.scenes.length})`);
    const r = await api(`/projects/${projectId}/scenes/${target.id}/still`, { method: "POST", body: JSON.stringify({ zoom, focusX, focusY, durationSec }) });
    const job = await pollJob(r.jobId, 90);
    return ok({ scene: target.position + 1, jobId: r.jobId, status: job?.status ?? r.status, durationSec: r.durationSec, costUsd: 0, next: "render_project pra montar de novo com o plano parado" });
  }),
);

server.registerTool(
  "add_scene",
  {
    title: "Adicionar cena",
    description: "Insere uma cena de vídeo ou um card numa posição (fim por padrão).",
    inputSchema: {
      projectId: z.string().uuid(),
      type: z.enum(["video", "card"]).optional(),
      script: z.string().optional(),
      imagePrompt: z.string().optional(),
      motionPrompt: z.string().optional(),
      durationSec: z.number().int().min(1).max(12).optional(),
      card: z.object({ text: z.string(), subtext: z.string().optional(), button: z.string().optional() }).optional(),
      position: z.number().int().min(1).optional().describe("1 = primeira; padrão = última"),
    },
  },
  guarded(async ({ projectId, type, script, imagePrompt, motionPrompt, durationSec, card, position }) => {
    const p = await api(`/projects/${projectId}`);
    const scenes = p.scenes.map((s: any) => ({ id: s.id, script: s.script ?? "", image_prompt: s.image_prompt, motion_prompt: s.motion_prompt, duration_sec: s.duration_sec, type: s.type, card: s.card }));
    const ns = { script: script ?? "", image_prompt: imagePrompt, motion_prompt: motionPrompt, duration_sec: durationSec ?? (type === "card" ? 2 : 5), type: type ?? (card ? "card" : "video"), card: card ?? null };
    scenes.splice(position ? position - 1 : scenes.length, 0, ns);
    const out = await api(`/projects/${projectId}/scenes`, { method: "PUT", body: JSON.stringify({ scenes }) });
    return ok({ scenes: out.scenes.map(sceneView) });
  }),
);

server.registerTool(
  "remove_scene",
  { title: "Remover cena", description: "Apaga uma cena pela posição (1 = primeira) ou id.", inputSchema: { projectId: z.string().uuid(), scene: z.union([z.number().int().min(1), z.string().uuid()]) }, annotations: { destructiveHint: true } },
  guarded(async ({ projectId, scene }) => {
    const p = await api(`/projects/${projectId}`);
    const target = typeof scene === "number" ? p.scenes[scene - 1] : p.scenes.find((s: any) => s.id === scene);
    if (!target) return fail(`cena ${scene} não existe`);
    const scenes = p.scenes.filter((s: any) => s.id !== target.id).map((s: any) => ({ id: s.id, script: s.script ?? "", image_prompt: s.image_prompt, motion_prompt: s.motion_prompt, duration_sec: s.duration_sec, type: s.type, card: s.card }));
    const out = await api(`/projects/${projectId}/scenes`, { method: "PUT", body: JSON.stringify({ scenes }) });
    return ok({ scenes: out.scenes.map(sceneView) });
  }),
);

server.registerTool(
  "estimate_project",
  {
    title: "Estimar lote do projeto",
    description: "Quanto custa gerar as imagens, vídeos ou narrações que faltam (não gasta nada). Diz se vai pro cartão.",
    inputSchema: { projectId: z.string().uuid(), kind: z.enum(["image", "video", "audio"]) },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ projectId, kind }) => {
    const e = await api(`/projects/${projectId}/estimate`, { method: "POST", body: JSON.stringify({ kind }) });
    return ok({ ...e, brl: brl(e.totalUsd), goesToCard: e.paid });
  }),
);

server.registerTool(
  "produce",
  {
    title: "Produzir (imagens, vídeos ou narrações)",
    description: "Gera em lote tudo o que falta de um tipo no projeto: image (Seedream, grátis), audio (Seed Audio, grátis até 60 min) ou video (Seedance 1.0 fast grátis; Kling/Seedance 2.5 cobram → confirmPaid). Ordem: image → audio → video. Tudo ou nada: se a trava barrar, nada é enfileirado.",
    inputSchema: {
      projectId: z.string().uuid(),
      kind: z.enum(["image", "video", "audio"]),
      sceneIds: z.array(z.string().uuid()).optional().describe("só essas cenas (padrão: todas as pendentes)"),
      mode: z.enum(["pending", "upgrade"]).optional().describe("upgrade (só vídeo): refaz os vídeos feitos em outro motor/resolução no motor atual do projeto (rascunho 480p → final)"),
      wait: z.boolean().optional().describe("esperar o lote terminar (até 4 min; chame wait_project pra continuar esperando)"),
      confirmPaid: z.boolean().optional().describe(paidDoc),
    },
  },
  guarded(async ({ projectId, kind, sceneIds, mode, wait, confirmPaid }) => {
    const e = await api(`/projects/${projectId}/estimate`, { method: "POST", body: JSON.stringify({ kind, sceneIds, mode }) });
    if (!e.scenes.length) return ok({ queued: [], note: `nada pendente de ${kind} — veja get_project (vídeo precisa da imagem pronta antes)` });
    if (e.paid && !confirmPaid) return fail(`Lote de ${e.scenes.length} ${kind} com ${e.model}: ${usd(e.totalUsd)} (${brl(e.totalUsd)}) — VAI PRO CARTÃO. Não executei. Pergunte ao usuário se autoriza esse valor e, só com o sim dele, chame de novo com confirmPaid: true.`, e);
    const r = await api(`/projects/${projectId}/generate`, { method: "POST", body: JSON.stringify({ kind, sceneIds, mode, allowPaid: !!confirmPaid }) });
    if (!wait) return ok({ ...r, model: e.model, brl: brl(r.totalUsd), next: `wait_project(projectId, "${kind}")` });
    return ok(await waitProject(projectId, kind, 240));
  }),
);

async function waitProject(projectId: string, what: "image" | "video" | "audio" | "render", timeoutSec: number) {
  const until = Date.now() + timeoutSec * 1000;
  let st: any = await api(`/projects/${projectId}/status`);
  const running = () => (what === "render" ? st.render?.status === "queued" || st.render?.status === "running" : st[what].running > 0);
  while (running() && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    st = await api(`/projects/${projectId}/status`);
  }
  return { ...st, renderUrl: abs(st.renderUrl), stillRunning: running(), open: `${WEB}/projects/${projectId}` };
}

server.registerTool(
  "wait_project",
  {
    title: "Esperar o projeto",
    description: "Espera as gerações de um tipo (ou o render) terminarem e devolve o status. Se stillRunning, chame de novo.",
    inputSchema: { projectId: z.string().uuid(), what: z.enum(["image", "video", "audio", "render"]), timeoutSec: z.number().int().min(5).max(240).optional() },
    annotations: { readOnlyHint: true },
  },
  guarded(async ({ projectId, what, timeoutSec }) => ok(await waitProject(projectId, what, timeoutSec ?? 180))),
);

server.registerTool(
  "render_project",
  {
    title: "Montar o vídeo final",
    description: "Junta as cenas prontas com narração, legenda karaokê, cards e trilha num MP4 9:16 (FFmpeg local, custo zero). Cenas sem vídeo ficam de fora.",
    inputSchema: { projectId: z.string().uuid(), wait: z.boolean().optional().describe("esperar o render (até 4 min)") },
  },
  guarded(async ({ projectId, wait }) => {
    const r = await api(`/projects/${projectId}/render`, { method: "POST", body: "{}" });
    if (!wait) return ok({ ...r, next: `wait_project(projectId, "render")` });
    return ok(await waitProject(projectId, "render", 240));
  }),
);

server.registerTool(
  "delete_project",
  { title: "Apagar projeto", description: "Apaga o projeto e as cenas (não tem volta). Confirme com o usuário antes.", inputSchema: { projectId: z.string().uuid(), confirm: z.literal(true) }, annotations: { destructiveHint: true } },
  guarded(async ({ projectId }) => {
    await api(`/projects/${projectId}`, { method: "DELETE" });
    return ok({ deleted: projectId });
  }),
);

/* ───── resources ───── */

server.registerResource("capabilities", "g2://capabilities", { title: "Tudo que o CB Studio faz", description: "Mapa de capacidades e roadmap em markdown", mimeType: "text/markdown" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: await api<string>("/capabilities?format=md") }],
}));

server.registerResource("models", "g2://models", { title: "Catálogo de modelos", mimeType: "application/json" }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify((await api("/models")).models, null, 2) }],
}));

server.registerResource("tips", "g2://tips", { title: "Regras de produção da G2", description: "O que aprendemos fazendo os anúncios no Higgsfield", mimeType: "text/markdown" }, async (uri) => {
  const { models } = await api<{ models: any[] }>("/models");
  const tips = models.filter((m) => m.tip).map((m) => `- **${m.name}**: ${m.tip}`);
  const text = [
    "# Regras de produção (do PDF 'Modelos de IA que usamos no HiggsField')",
    "",
    "- Roteiro: números por extenso (a voz lê errado), gancho nos 3 primeiros segundos, uma ação por cena, cenas de 4–5 s.",
    "- Imagem: repetir a ficha do personagem em TODO prompt; mão com objeto de perfil; evitar espelhos e reflexos; texto só nos cards.",
    "- Vídeo: nenhum plano acima de ~3 s de ação contínua; mão segurando objeto → frame inicial + final (Kling 3.0 Pro); fala → Seedance 2.5 com áudio de referência.",
    "- Voz: ElevenLabs v4 estabilidade 0,8 / similaridade 0,9; Seed Audio em WAV (MP3 sai mudo no FFmpeg do Mac).",
    "- Legenda: karaokê em caixa alta, palavra atual em dourado, contorno preto, 2 linhas no máximo.",
    "- Montagem: cards de abertura e CTA, trilha com ducking a 18%, cauda de 0,35 s por cena.",
    "",
    "## Dicas por modelo",
    ...tips,
  ].join("\n");
  return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
});

/* ───── prompts ───── */

server.registerPrompt(
  "quadrinho",
  { title: "Fazer um quadrinho do zero", description: "Tema → roteiro → imagens → narração → vídeos → MP4, confirmando custos", argsSchema: { tema: z.string(), estilo: z.string().optional() } },
  ({ tema, estilo }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Faça um vídeo quadrinho no CB Studio sobre: "${tema}"${estilo ? ` no estilo ${estilo}` : ""}.
1. studio_status — confira cotas e se o estúdio está no ar.
2. create_project(theme, style) — leia o roteiro e me mostre as cenas resumidas; ajuste com edit_scene se eu pedir.
3. produce(kind=image) → wait_project(image). Me mostre as URLs das imagens.
4. produce(kind=audio) → wait_project(audio).
5. produce(kind=video) — se for pro cartão, me pergunte o valor antes; senão siga → wait_project(video).
6. render_project(wait=true) e me passe o link do MP4 e o link do projeto no app.
Mostre custos em US$ e R$ a cada passo.`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "rotina",
  { title: "Rotina diária de conteúdo", description: "Texto pra agendar no Claude: todo dia escreve roteiros do tema da semana e deixa pra aprovar", argsSchema: { tema_da_semana: z.string(), quantos: z.string().optional() } },
  ({ tema_da_semana, quantos }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Rotina do CB Studio (use como tarefa agendada no Claude, todo dia de manhã):
1. studio_status — se o estúdio estiver fora do ar, pare e avise.
2. Tema da semana: "${tema_da_semana}". Crie ${quantos ?? "3"} quadrinhos com ângulos diferentes (create_project, estilo epic), um por vez.
3. Pra cada um: produce(image) e produce(audio) — só modelos grátis; NÃO gere vídeo nem nada pago sem o usuário autorizar.
4. review_virality em cada projeto e me mande um resumo: título, nota, link do projeto, o que melhorar.
5. Não publique nada. Eu aprovo e peço o vídeo depois.`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "clone",
  { title: "Pessoa falando (clone)", description: "Foto + voz clonada + texto → vídeo", argsSchema: { pessoa: z.string(), texto: z.string() } },
  ({ pessoa, texto }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Quero ${pessoa} falando este texto num vídeo 9:16: "${texto}". Use list_voices pra achar a voz (se não tiver, peça o áudio e cadastre com create_voice informando quem autorizou), use a foto da biblioteca ou peça o caminho pra upload_file, estime com estimate_cost e me pergunte antes de qualquer custo no cartão. Depois clone_person(wait=true) e me passe o link.` } }],
  }),
);

/* ───────────────────────── transporte ───────────────────────── */

async function main() {
  const i = process.argv.indexOf("--http");
  if (i >= 0) {
    const port = Number(process.argv[i + 1] ?? 4100);
    const http = createServer(async (req, res) => {
      if (!req.url?.startsWith("/mcp")) {
        res.writeHead(404).end();
        return;
      }
      // stateless: um transporte por requisição
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res);
    });
    http.listen(port, () => console.error(`CB Studio MCP (HTTP) → http://localhost:${port}/mcp  · API ${API}`));
    return;
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`CB Studio MCP (stdio) · API ${API}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
