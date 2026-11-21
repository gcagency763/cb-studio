import type { FastifyInstance } from "fastify";
import { findModel, zeroCost } from "@g2/providers";
import { sql, voiceMinutesUsed } from "../lib/db.js";
import { env } from "../lib/env.js";
import { capabilities, capabilitiesMarkdown } from "../lib/capabilities.js";

/** Resumo de custo/uso para a sidebar. Valores nominais (cota grátis cobre em dev). */
export async function statsRoutes(app: FastifyInstance) {
  /** mapa de capacidades: pronto, em breve, planejado, ideia (+ referência de onde veio) */
  app.get("/capabilities", async (req, reply) => {
    const { format } = (req.query ?? {}) as { format?: string };
    if (format === "md") return reply.type("text/markdown; charset=utf-8").send(capabilitiesMarkdown());
    return capabilities();
  });

  app.get("/stats", async () => {
    const [row] = await sql<{ today: string; total: string; queued: number; running: number; images: number; videos: number }[]>`
      select
        coalesce(sum(estimated_cost_usd) filter (where created_at >= date_trunc('day', now()) and status = 'succeeded'), 0)::text as today,
        coalesce(sum(estimated_cost_usd) filter (where status = 'succeeded'), 0)::text as total,
        count(*) filter (where status = 'queued')::int as queued,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where kind = 'image' and status = 'succeeded')::int as images,
        count(*) filter (where kind = 'video' and status = 'succeeded')::int as videos
      from jobs`;
    // o que foi pro cartão hoje: fal, ElevenLabs, GPU própria e Seedance 2.x (o resto é cota grátis da BytePlus)
    const paidRows = await sql<{ provider: string; model: string | null; usd: string }[]>`
      select provider, request->>'model' as model, coalesce(sum(estimated_cost_usd), 0)::text as usd
      from jobs where created_at >= date_trunc('day', now()) and status = 'succeeded'
      group by 1, 2`;
    const billedToday = paidRows.reduce((acc, r) => acc + (["fal", "elevenlabs", "gpu"].includes(r.provider) || findModel(r.model ?? undefined)?.gate === "reserve" ? +r.usd : 0), 0);
    return {
      todayCostUsd: +row.today,
      todayBilledUsd: +billedToday.toFixed(2),
      todayFreeUsd: +Math.max(0, +row.today - billedToday).toFixed(2),
      totalCostUsd: +row.total,
      queued: row.queued,
      running: row.running,
      images: row.images,
      videos: row.videos,
      maxJobCostUsd: env.MAX_JOB_COST_USD,
      freeCreditsOnly: true,
      zeroCost: zeroCost(),
    };
  });

  /**
   * Página "Gastos": custo por dia (30 d), por mês, por modelo/provedor, cotas grátis.
   * estimated_cost_usd é o preço de tabela; "cobrado" = o que sai do cartão de fato
   * (BytePlus em modo só-grátis e Seed Audio dentro dos 60 min contam como 0).
   */
  app.get("/usage", async () => {
    const days = await sql<{ day: string; usd: string; jobs: number }[]>`
      select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
             coalesce(sum(estimated_cost_usd), 0)::text as usd, count(*)::int as jobs
      from jobs where status = 'succeeded' and created_at >= now() - interval '30 days'
      group by 1 order by 1`;
    const months = await sql<{ month: string; usd: string; jobs: number }[]>`
      select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
             coalesce(sum(estimated_cost_usd), 0)::text as usd, count(*)::int as jobs
      from jobs where status = 'succeeded' group by 1 order by 1 desc limit 12`;
    const byModel = await sql<{ provider: string; kind: string; model: string | null; jobs: number; usd: string; secs: string; month_usd: string; month_jobs: number }[]>`
      select provider, kind, request->>'model' as model, count(*)::int as jobs,
             coalesce(sum(estimated_cost_usd), 0)::text as usd,
             coalesce(sum((usage->>'seconds')::numeric), 0)::text as secs,
             coalesce(sum(estimated_cost_usd) filter (where created_at >= date_trunc('month', now())), 0)::text as month_usd,
             count(*) filter (where created_at >= date_trunc('month', now()))::int as month_jobs
      from jobs where status = 'succeeded' and kind <> 'render'
      group by 1, 2, 3 order by usd desc`;
    const recent = await sql<{ id: string; kind: string; provider: string; model: string | null; usd: string; created_at: Date; project_id: string | null }[]>`
      select id, kind, provider, request->>'model' as model, estimated_cost_usd::text as usd, created_at, project_id
      from jobs where status = 'succeeded' and kind <> 'render' order by created_at desc limit 40`;

    // tokens de vídeo consumidos por modelo BytePlus (pra cota grátis de 2M por modelo)
    const videoTokens = await sql<{ model: string; tokens: string }[]>`
      select request->>'model' as model, coalesce(sum((usage->>'total_tokens')::numeric), 0)::text as tokens
      from jobs where status = 'succeeded' and kind = 'video' and provider = 'byteplus' group by 1`;
    const imagesByModel = await sql<{ model: string; n: number }[]>`
      select coalesce(request->>'model', 'seedream-4-5-251128') as model, count(*)::int as n
      from jobs where status = 'succeeded' and kind = 'image' and provider = 'byteplus' group by 1`;

    const voiceMin = await voiceMinutesUsed();
    const freeTokens = 2_000_000;
    const quotas = [
      ...videoTokens
        .filter((v) => v.model)
        .map((v) => ({ id: v.model, name: findModel(v.model)?.name ?? v.model, unit: "tokens", used: +v.tokens, free: freeTokens, pctUsed: Math.min(100, (+v.tokens / freeTokens) * 100) })),
      ...imagesByModel.map((i) => ({ id: i.model, name: findModel(i.model)?.name ?? i.model, unit: "imagens", used: i.n, free: 200, pctUsed: Math.min(100, (i.n / 200) * 100) })),
      { id: "seed-audio-1.0", name: "Seed Audio 1.0 (voz)", unit: "min", used: +voiceMin.toFixed(2), free: 60, pctUsed: Math.min(100, (voiceMin / 60) * 100), lockAt: env.VOICE_FREE_MINUTES },
    ];

    /** o que de fato sai do cartão: só provedores pagos (fal) e Seed Audio além do grátis */
    const billed = byModel.reduce((acc, r) => acc + (r.provider === "fal" ? +r.usd : 0), 0) + Math.max(0, voiceMin - 60) * 0.15;
    const billedMonth = byModel.reduce((acc, r) => acc + (r.provider === "fal" ? +r.month_usd : 0), 0);

    return {
      days: days.map((d) => ({ day: d.day, usd: +d.usd, jobs: d.jobs })),
      months: months.map((m) => ({ month: m.month, usd: +m.usd, jobs: m.jobs })),
      byModel: byModel.map((r) => ({
        provider: r.provider,
        kind: r.kind,
        model: r.model,
        name: findModel(r.model)?.name ?? r.model ?? `${r.provider} (${r.kind})`,
        jobs: r.jobs,
        usd: +r.usd,
        seconds: +r.secs,
        monthUsd: +r.month_usd,
        monthJobs: r.month_jobs,
        billed: r.provider === "fal",
      })),
      recent: recent.map((r) => ({ ...r, name: findModel(r.model)?.name ?? r.model ?? r.provider, usd: +r.usd })),
      quotas,
      billedUsd: +billed.toFixed(2),
      billedMonthUsd: +billedMonth.toFixed(2),
      nominalMonthUsd: +months.find((m) => m.month === new Date().toISOString().slice(0, 7))?.usd! || 0,
      voiceFreeMinutes: env.VOICE_FREE_MINUTES,
      maxJobCostUsd: env.MAX_JOB_COST_USD,
      providers: {
        byteplus: !!process.env.ARK_API_KEY,
        seedaudio: !!(process.env.SEED_SPEECH_API_KEY || process.env.ARK_API_KEY),
        fal: !!process.env.FAL_KEY,
        seedance2: process.env.ARK_ALLOW_SEEDANCE_2 === "true",
        elevenlabs: !!process.env.ELEVENLABS_API_KEY,
        gpu: !!(process.env.G2_GPU_URL && process.env.G2_GPU_TOKEN),
        instagram: !!(process.env.IG_USER_ID && process.env.META_ACCESS_TOKEN),
        metaAds: !!(process.env.META_AD_ACCOUNT_ID && process.env.META_ACCESS_TOKEN),
        youtube: !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      },
    };
  });
}
