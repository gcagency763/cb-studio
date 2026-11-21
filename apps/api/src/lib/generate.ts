import { findModel, providersFromEnv, zeroCost } from "@g2/providers";
import { createJob, voiceMinutesUsed } from "./db.js";
import { env } from "./env.js";
import { generationQueue } from "./queue.js";

/** provedores configurados pelo .env — único por processo */
export const providers = providersFromEnv();

export type Kind = "image" | "video" | "audio" | "avatar" | "upscale" | "lipsync" | "sfx";

/** erro com status HTTP + corpo (402 = guarda de custo / cota de voz; 400 = provedor) */
export class GenError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(String(body.error ?? "erro"));
  }
}

const PROVIDER_HINT: Record<string, string> = {
  fal: "esse modelo roda na fal.ai (Kling, Nano Banana, GPT Image, upscale, avatar) — precisa de FAL_KEY no .env (conta pré-paga, mínimo US$ 10)",
  google: "Veo / Nano Banana precisam de GOOGLE_API_KEY (fase 2)",
  elevenlabs: "ElevenLabs (narração v4, clonar voz, efeitos sonoros) precisa de ELEVENLABS_API_KEY no .env — plano Starter US$ 5/mês libera clonagem",
};

/** 1) modelo do catálogo decide o provedor; 2) nome explícito; 3) padrão por tipo */
export function pickProvider(name: string | undefined, kind: Kind, model?: string) {
  const m = findModel(model);
  if (m) return providers[m.provider];
  if (name) return providers[name];
  if (kind === "audio") return providers.seedaudio;
  if (kind === "sfx") return providers.seedaudio ?? providers.elevenlabs;
  if (kind === "avatar") return providers.fal ?? providers.byteplus;
  if (kind === "upscale" || kind === "lipsync") return providers.fal;
  return providers.byteplus;
}

export function hintFor(name: string | undefined, kind: Kind, model?: string) {
  const m = findModel(model);
  if (m?.gate === "fal" || (!m && (name === "fal" || kind === "avatar" || kind === "upscale"))) return PROVIDER_HINT.fal;
  if (m?.gate === "reserve") return "Seedance 2.x exige fundo de reserva (US$ 30) na BytePlus → ARK_ALLOW_SEEDANCE_2=true";
  if (m?.gate === "elevenlabs") return PROVIDER_HINT.elevenlabs;
  if (m?.gate === "gpu") return "GPU própria não ligada: deploy de infra/gpu/g2_video.py no Modal + G2_GPU_URL e G2_GPU_TOKEN no .env";
  return PROVIDER_HINT[name ?? ""] ?? `provedor para ${kind} não configurado`;
}

export type GenRequest = { kind: Kind; model?: string; text?: string } & Record<string, unknown>;

/** Resolve provedor + custo sem gastar nada. */
export function plan(request: GenRequest, providerName?: string) {
  const p = pickProvider(providerName, request.kind, request.model);
  if (!p) throw new GenError(400, { error: hintFor(providerName, request.kind, request.model) });
  if (!p.supports(request.kind)) throw new GenError(400, { error: `${p.name} não gera ${request.kind}` });
  const cost = p.estimateCost(request as any);
  // o que vai pro cartão: fal.ai, ElevenLabs e Seedance 2.x (reserva da BytePlus); o resto sai da cota grátis
  // GPU própria: sai do crédito grátis do Modal, mas o Modal tem cartão — pede confirmação igual aos pagos
  const paid = p.name === "fal" || p.name === "elevenlabs" || p.name === "gpu" || findModel(request.model)?.gate === "reserve";
  return { provider: p, cost, paid };
}

/**
 * Guardas (mesmas da UI): cota de voz grátis do Seed Speech e custo máximo por job.
 * `extraVoiceSec` soma segundos já planejados no mesmo lote (geração em massa).
 */
export async function guard(request: GenRequest, provider: { name: string }, cost: number, allowPaid: boolean, extraVoiceSec = 0) {
  // modo custo zero: recusa tudo que cobraria no cartão, mesmo com allowPaid
  const m = findModel((request as { model?: string }).model);
  const billed = provider.name === "fal" || provider.name === "elevenlabs" || provider.name === "gpu" || m?.gate === "reserve";
  if (billed && zeroCost()) {
    throw new GenError(402, {
      error: "modo custo zero: isso cobraria no cartão. Use um modelo grátis (Seedance 1.0, Seedream, plano parado) ou aprove o gasto e ponha ZERO_COST=false no .env",
      zeroCost: true,
      estimatedCostUsd: cost,
    });
  }
  if ((request.kind === "audio" || request.kind === "sfx") && provider.name === "seedaudio") {
    const used = await voiceMinutesUsed();
    const sfxSec = Number((request as { durationSec?: number }).durationSec ?? 5);
    const extra = ((request.kind === "sfx" ? sfxSec : Math.max(2, String((request as { text?: string }).text ?? "").length / 15)) + extraVoiceSec) / 60;
    // custo zero: nunca passa dos 60 min grátis do Seed Audio, mesmo que VOICE_FREE_MINUTES esteja maior
    const freeMin = zeroCost() ? Math.min(env.VOICE_FREE_MINUTES, 60) : env.VOICE_FREE_MINUTES;
    if (used + extra > freeMin) {
      throw new GenError(402, {
        error: `limite de voz grátis: ${used.toFixed(1)} de ${env.VOICE_FREE_MINUTES} min usados — suba VOICE_FREE_MINUTES no .env pra liberar (cobra US$ 0,15/min)`,
        voiceMinutesUsed: used,
        voiceFreeMinutes: env.VOICE_FREE_MINUTES,
      });
    }
  }
  if (cost > env.MAX_JOB_COST_USD && !allowPaid) {
    throw new GenError(402, { error: "custo acima do limite — confirme com allowPaid:true", estimatedCostUsd: cost, maxJobCostUsd: env.MAX_JOB_COST_USD });
  }
}

/** Cria o job e enfileira. Chame `plan` + `guard` antes. */
export async function enqueue(request: GenRequest, providerName: string, cost: number, ids: { projectId?: string | null; sceneId?: string | null } = {}) {
  const job = await createJob({
    kind: request.kind,
    provider: providerName,
    request,
    estimated_cost_usd: cost,
    project_id: ids.projectId ?? null,
    scene_id: ids.sceneId ?? null,
  });
  await generationQueue.add("generate", { jobId: job.id, provider: providerName, request: request as any }, { jobId: job.id });
  return job;
}

/** Atalho: plano + guarda + fila em uma chamada (um job). */
export async function generateOne(request: GenRequest, opts: { provider?: string; allowPaid?: boolean; projectId?: string | null; sceneId?: string | null } = {}) {
  const { provider, cost } = plan(request, opts.provider);
  await guard(request, provider, cost, !!opts.allowPaid);
  const job = await enqueue(request, provider.name, cost, opts);
  return { job, cost };
}
