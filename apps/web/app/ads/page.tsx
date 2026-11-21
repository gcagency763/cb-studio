"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, usd, type Voice } from "@/lib/api";
import { useModels } from "@/lib/models";
import { useConfirm, useToast } from "@/components/Toasts";

/**
 * Anúncios em escala: produto + ganchos → uma campanha com N quadrinhos (um por gancho),
 * roteiros escritos em lote e produção em lote com os modelos grátis.
 */
type Hook = { angle?: string; hook: string; why?: string; on: boolean };
type CampaignProject = { id: string; title: string; hook: string | null; status: string; scenes: number; ready: number; coverUrl: string | null; renderUrl: string | null };
type Campaign = { id: string; name: string; count: number; writing: number; rendered: number; ready: number; scenes: number; updatedAt: string; projects: CampaignProject[] };
type Kind = "image" | "video" | "audio";

const STYLES = [
  { id: "epic", label: "Épico ilustrado" },
  { id: "comic", label: "Quadrinhos" },
  { id: "anime", label: "Anime" },
  { id: "cinematic", label: "Cinemático" },
  { id: "flat", label: "Flat / Motion" },
];
const KIND_LABEL: Record<Kind, string> = { image: "imagens", audio: "vozes", video: "vídeos" };

export default function AdsPage() {
  const toast = useToast();
  const ask = useConfirm();
  const videoModels = useModels("video");
  const [campaign, setCampaign] = useState("");
  const [product, setProduct] = useState("");
  const [offer, setOffer] = useState("");
  const [audience, setAudience] = useState("");
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [style, setStyle] = useState("epic");
  const [voiceId, setVoiceId] = useState("");
  const [scenes, setScenes] = useState(8);
  const [videoModel, setVideoModel] = useState("seedance-1-0-pro-fast-251015:720p");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api<{ voices: Voice[] }>("/voices").then((r) => setVoices(r.voices)).catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ campaigns: Campaign[] }>("/ads").then((r) => alive && setCampaigns(r.campaigns)).catch(() => alive && setCampaigns([]));
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);

  const suggest = async () => {
    if (product.trim().length < 3) return toast("Descreva o produto/tema primeiro", "bad");
    setBusy("hooks");
    try {
      const r = await api<{ hooks: { angle: string; hook: string; why: string }[] }>("/ads/hooks", { method: "POST", body: JSON.stringify({ product, offer: offer || undefined, audience: audience || undefined, count: 6 }) });
      setHooks(r.hooks.map((h) => ({ ...h, on: true })));
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    const chosen = hooks.filter((h) => h.on && h.hook.trim().length >= 3);
    if (!chosen.length) return toast("Escolha ao menos um gancho", "bad");
    if (!campaign.trim()) return toast("Dê um nome pra campanha", "bad");
    setBusy("create");
    try {
      await api("/ads", { method: "POST", body: JSON.stringify({ campaign: campaign.trim(), product, offer: offer || undefined, audience: audience || undefined, hooks: chosen.map((h) => ({ angle: h.angle, hook: h.hook.trim() })), style, voiceId: voiceId || null, videoModel, scenes }) });
      toast(`${chosen.length} anúncios criados — escrevendo os roteiros (≈1 min cada)`, "ok");
      setHooks([]);
      setTick((t) => t + 1);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const produce = async (c: Campaign, kind: Kind) => {
    setBusy(`${c.id}:${kind}`);
    try {
      const est = await api<{ projects: number; scenes: number; totalUsd: number; paid: boolean; model: string }>(`/ads/${c.id}/estimate`, { method: "POST", body: JSON.stringify({ kind }) });
      if (!est.scenes) return toast(`Nada pendente de ${KIND_LABEL[kind]} (vídeo precisa das imagens prontas antes)`, "bad");
      if (!await ask(`Gerar ${est.scenes} ${KIND_LABEL[kind]} em ${est.projects} anúncios com ${est.model}?\nCusto ${usd(est.totalUsd)} — ${est.paid ? "COBRADO no cartão" : "sai da cota grátis (cartão US$ 0)"}.`, est.paid ? "Gerar e cobrar" : "Gerar")) return;
      const r = await api<{ projects: { projectId: string; queued: number; error?: string }[] }>(`/ads/${c.id}/produce`, { method: "POST", body: JSON.stringify({ kind, allowPaid: est.paid }) });
      const n = r.projects.reduce((a, p) => a + p.queued, 0);
      const errs = r.projects.filter((p) => p.error);
      toast(`${n} ${KIND_LABEL[kind]} na fila${errs.length ? ` · ${errs.length} anúncio(s) travado(s): ${errs[0].error}` : ""}`, errs.length ? "bad" : "ok");
      setTick((t) => t + 1);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) toast(`Trava de custo: ${usd(e.body?.estimatedCostUsd)} iria pro cartão`, "bad");
      else toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const render = async (c: Campaign) => {
    setBusy(`${c.id}:render`);
    try {
      const r = await api<{ renders: { projectId: string; ready?: number; error?: string }[] }>(`/ads/${c.id}/render`, { method: "POST", body: "{}" });
      const ok = r.renders.filter((x) => !x.error).length;
      toast(`${ok} vídeo(s) montando — ~1 min cada`, "ok");
      setTick((t) => t + 1);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const chosen = hooks.filter((h) => h.on).length;

  return (
    <div className="create">
      <aside className="panel" aria-label="Nova campanha">
        <div className="panel-tabs">
          <button className="panel-tab active">Nova campanha</button>
        </div>
        <div className="field">
          <label htmlFor="cn">Nome da campanha</label>
          <input id="cn" className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)} maxLength={120} placeholder="Ex.: MVS · novembro · Shopee sem estoque" />
        </div>
        <div className="field">
          <label htmlFor="pr">Produto / tema</label>
          <textarea id="pr" className="textarea" rows={3} value={product} onChange={(e) => setProduct(e.target.value)} maxLength={600} placeholder="Ex.: curso MVS do Guilherme Cirilo — vender na Shopee sem estoque, do zero, com a planilha de precificação" />
        </div>
        <div className="field">
          <label htmlFor="of">Oferta / CTA final</label>
          <input id="of" className="input" value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={300} placeholder="Ex.: aula gratuita hoje às 20h — clique e garanta a vaga" />
        </div>
        <div className="field">
          <label htmlFor="au">Público</label>
          <input id="au" className="input" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={300} placeholder="Ex.: mulheres 25–45 que querem renda extra em casa" />
        </div>

        <div className="field">
          <label>Ganchos (um anúncio por gancho)</label>
          <button className="btn sm" disabled={busy === "hooks"} onClick={suggest} style={{ justifySelf: "start" }}>
            {busy === "hooks" ? "Pensando…" : hooks.length ? "Sugerir outros 6 ✦" : "Sugerir 6 ganchos ✦"} <span className="cost">US$ 0</span>
          </button>
          <div className="hooks">
            {hooks.map((h, i) => (
              <label key={i} className={`hook ${h.on ? "on" : ""}`}>
                <input type="checkbox" checked={h.on} onChange={(e) => setHooks(hooks.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} />
                <div>
                  {h.angle && <span className="angle">{h.angle}</span>}
                  <input className="hook-text" value={h.hook} onChange={(e) => setHooks(hooks.map((x, k) => (k === i ? { ...x, hook: e.target.value } : x)))} />
                  {h.why && <small>{h.why}</small>}
                </div>
              </label>
            ))}
            <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setHooks([...hooks, { hook: "", on: true, angle: "meu" }])}>
              + escrever um gancho
            </button>
          </div>
        </div>

        <div className="opts">
          <div className="opt">
            <label>Estilo</label>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div className="opt">
            <label>Cenas</label>
            <select value={scenes} onChange={(e) => setScenes(+e.target.value)}>
              {[6, 8, 10, 12].map((n) => (
                <option key={n} value={n}>
                  {n} (~{Math.round(n * 6.5)} s)
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="opts">
          <div className="opt">
            <label>Voz</label>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              <option value="">padrão</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div className="opt">
            <label>Motor de vídeo</label>
            <select value={videoModel} onChange={(e) => setVideoModel(e.target.value)}>
              {videoModels.flatMap((m) =>
                (m.resolutions ?? ["720p"]).map((r) => (
                  <option key={`${m.id}:${r}`} value={`${m.id}:${r}`} disabled={!!m.locked}>
                    {m.name} {r} {m.locked ? "🔒" : m.free ? "· grátis" : "· pago"}
                  </option>
                )),
              )}
            </select>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
          💡 Cada gancho vira um quadrinho completo com a mesma ficha de personagem. Roteiros ≈ US$ 0,005 cada (cota grátis). Depois: Produzir imagens → vozes → vídeos → Montar, tudo na cota grátis com o motor padrão.
        </div>
        <button className="btn primary gen" disabled={busy === "create" || !chosen} onClick={create}>
          {busy === "create" ? "Criando…" : `Criar ${chosen || ""} anúncio${chosen === 1 ? "" : "s"}`} <span className="cost">≈ {usd(0.005 * chosen)}</span>
        </button>
      </aside>

      <section className="area">
        <div className="hero-strip">
          <img src="/art/tile-produza.jpg" alt="" />
          <div className="txt">
            <div className="display">
              Um produto, <em>dez anúncios</em>
            </div>
            <p>Descreva o produto e a oferta; o estúdio sugere ganchos com ângulos diferentes e escreve um quadrinho por gancho. Produza tudo em lote e teste no Meta Ads qual gancho vende.</p>
            <div className="chips">
              <span>Seed 2.1 escreve</span>
              <span>mesma ficha em todos</span>
              <span>lote na cota grátis</span>
            </div>
          </div>
        </div>

        <div className="area-head">
          <h2>Campanhas</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            {campaigns?.length ?? 0} campanha(s)
          </span>
        </div>
        {campaigns === null ? (
          <div className="muted">Carregando…</div>
        ) : campaigns.length === 0 ? (
          <div className="empty">
            <b>Nenhuma campanha ainda</b>
            Descreva o produto ao lado, peça os ganchos e crie os anúncios. Cada um vira um quadrinho que você pode abrir e ajustar.
          </div>
        ) : (
          campaigns.map((c) => (
            <article key={c.id} className="camp">
              <div className="camp-head">
                <div>
                  <h3>{c.name}</h3>
                  <span className="muted">
                    {c.count} anúncios · {c.writing ? `${c.writing} roteiro(s) sendo escrito(s) · ` : ""}
                    {c.ready}/{c.scenes} cenas com vídeo · {c.rendered} final(is)
                  </span>
                </div>
                <div className="camp-actions">
                  {(["image", "audio", "video"] as Kind[]).map((k) => (
                    <button key={k} className="btn sm" disabled={!!busy || c.writing > 0} onClick={() => produce(c, k)} title={`gera ${KIND_LABEL[k]} que faltam em todos os anúncios`}>
                      {busy === `${c.id}:${k}` ? "…" : KIND_LABEL[k]}
                    </button>
                  ))}
                  <button className="btn primary sm" disabled={!!busy || c.ready === 0} onClick={() => render(c)}>
                    {busy === `${c.id}:render` ? "…" : "Montar todos"}
                  </button>
                </div>
              </div>
              <div className="camp-grid">
                {c.projects.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="camp-item">
                    <div className="frame-box small">
                      {p.renderUrl ? <video src={p.renderUrl} muted playsInline preload="metadata" poster={p.coverUrl ?? undefined} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} /> : p.coverUrl ? <img src={p.coverUrl} alt="" /> : <div className="frame-empty">{p.status === "writing" ? "escrevendo…" : "sem imagens"}</div>}
                    </div>
                    <b>{p.hook ?? p.title}</b>
                    <span className="muted">{p.renderUrl ? "✦ vídeo final" : p.status === "writing" ? "roteiro…" : `${p.ready}/${p.scenes} cenas`}</span>
                  </Link>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
