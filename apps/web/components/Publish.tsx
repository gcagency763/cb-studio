"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Modal } from "@/components/create";
import { useToast } from "@/components/Toasts";

type PubStatus = { instagram: boolean; metaAds: boolean; youtube?: { configured: boolean; connected: boolean; channel: { title: string } | null } };

/** Publicar um MP4 direto do estúdio: Reels no Instagram e vídeo na conta do Meta Ads. */
export function PublishButton({ videoUrl, caption: initialCaption, name, small, jobId, projectId }: { videoUrl: string; caption?: string; name?: string; small?: boolean; jobId?: string; projectId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`btn ${small ? "sm" : ""}`} onClick={() => setOpen(true)} title="Instagram Reels · YouTube Shorts · Meta Ads">
        Publicar ›
      </button>
      {open && <PublishModal videoUrl={videoUrl} caption={initialCaption} name={name} jobId={jobId} projectId={projectId} onClose={() => setOpen(false)} />}
    </>
  );
}

type PostCopy = { title: string; caption: string; hashtags: string[]; hook: string; cta: string };

export function PublishModal({ videoUrl, caption: initialCaption, name, jobId, projectId, onClose }: { videoUrl: string; caption?: string; name?: string; jobId?: string; projectId?: string; onClose: () => void }) {
  const toast = useToast();
  const [writing, setWriting] = useState(false);
  const writeCopy = async () => {
    setWriting(true);
    try {
      const r = await api<{ copy: PostCopy }>("/copy", { method: "POST", body: JSON.stringify({ jobId, projectId, platform: "instagram" }) });
      const c = r.copy;
      setCaption([c.hook, c.caption.includes(c.hook) ? c.caption.replace(c.hook, "").trim() : c.caption, c.cta && !c.caption.includes(c.cta) ? c.cta : "", c.hashtags.join(" ")].filter(Boolean).join("\n\n"));
      if (c.title) setYtTitle(c.title.slice(0, 90));
      toast("Legenda escrita — revise antes de publicar", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setWriting(false);
    }
  };
  const [st, setSt] = useState<PubStatus | null>(null);
  const [caption, setCaption] = useState(initialCaption ?? "");
  const [adName, setAdName] = useState(name ?? "CB Studio");
  const [ytTitle, setYtTitle] = useState((name ?? initialCaption ?? "").split("\n")[0].slice(0, 90));
  const [ytPrivacy, setYtPrivacy] = useState<"public" | "unlisted" | "private">("public");
  const [busy, setBusy] = useState<"ig" | "ads" | "yt" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    api<PubStatus>("/publish/status").then(setSt).catch(() => setSt({ instagram: false, metaAds: false }));
  }, []);

  const ig = async () => {
    setBusy("ig");
    try {
      const r = await api<{ permalink: string | null; mediaId: string }>("/publish/instagram", { method: "POST", body: JSON.stringify({ videoUrl, caption }) });
      setResult(r.permalink ? `Publicado: ${r.permalink}` : `Publicado (id ${r.mediaId})`);
      toast("Reels publicado", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const yt = async () => {
    setBusy("yt");
    try {
      const r = await api<{ url: string; title: string; captions?: { captionId?: string; error?: string } | null }>("/publish/youtube", { method: "POST", body: JSON.stringify({ videoUrl, title: ytTitle || "Short", description: caption, privacy: ytPrivacy, captionsJobId: jobId }) });
      setResult(`${ytPrivacy === "public" ? "Publicado" : ytPrivacy === "unlisted" ? "No ar (não listado)" : "Enviado (privado)"}: ${r.url}${r.captions && "captionId" in r.captions ? " · legenda .srt anexada" : ""}`);
      toast("Short enviado pro YouTube", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const ads = async () => {
    setBusy("ads");
    try {
      const r = await api<{ videoId: string }>("/publish/meta-ads", { method: "POST", body: JSON.stringify({ videoUrl, name: adName }) });
      setResult(`Vídeo na conta de anúncios: id ${r.videoId} — monte o criativo no Gerenciador (ou peça pro Claude pelo MCP do Meta Ads)`);
      toast("Enviado pro Meta Ads", "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Publicar" onClose={onClose}>
      <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
        <div className="field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label htmlFor="pcap">Legenda do post (Instagram · descrição no YouTube)</label>
            {(jobId || projectId) && (
              <button className="btn ghost sm" disabled={writing} onClick={writeCopy} title="Seed 2.1 escreve gancho, legenda, CTA e hashtags a partir do que o vídeo diz (grátis)">
                {writing ? "Escrevendo…" : "✨ Escrever com IA"}
              </button>
            )}
          </div>
          <textarea id="pcap" className="textarea" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} placeholder="Texto, hashtags e chamada — ou clique em Escrever com IA" />
        </div>
        <div className="pub-row">
          <div>
            <b>Instagram Reels</b>
            <span className="muted">{st === null ? "…" : st.instagram ? "conta conectada" : "não configurado"}</span>
          </div>
          {st?.instagram ? (
            <button className="btn primary sm" disabled={!!busy} onClick={ig}>
              {busy === "ig" ? "Publicando…" : "Publicar Reels"}
            </button>
          ) : (
            <Link href="/settings#publish" className="btn sm">
              Configurar ›
            </Link>
          )}
        </div>
        <div className="field">
          <label htmlFor="pyt">Título no YouTube</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input id="pyt" className="input" value={ytTitle} onChange={(e) => setYtTitle(e.target.value)} maxLength={90} placeholder="Título do Short (a legenda acima vira a descrição)" />
            <select className="select" value={ytPrivacy} onChange={(e) => setYtPrivacy(e.target.value as any)} aria-label="Visibilidade no YouTube" style={{ width: 150 }}>
              <option value="public">Público</option>
              <option value="unlisted">Não listado</option>
              <option value="private">Privado</option>
            </select>
          </div>
        </div>
        <div className="pub-row">
          <div>
            <b>YouTube Shorts</b>
            <span className="muted">{st === null ? "…" : st.youtube?.connected ? `canal: ${st.youtube.channel?.title ?? "conectado"}` : st.youtube?.configured ? "falta conectar o canal" : "não configurado"}</span>
          </div>
          {st?.youtube?.connected ? (
            <button className="btn primary sm" disabled={!!busy} onClick={yt}>
              {busy === "yt" ? "Enviando…" : "Publicar Short"}
            </button>
          ) : (
            <Link href="/settings#youtube" className="btn sm">
              {st?.youtube?.configured ? "Conectar ›" : "Configurar ›"}
            </Link>
          )}
        </div>
        <div className="field">
          <label htmlFor="pname">Nome do vídeo no Meta Ads</label>
          <input id="pname" className="input" value={adName} onChange={(e) => setAdName(e.target.value)} maxLength={120} />
        </div>
        <div className="pub-row">
          <div>
            <b>Meta Ads · vídeo na conta</b>
            <span className="muted">{st === null ? "…" : st.metaAds ? "conta conectada" : "não configurado"}</span>
          </div>
          {st?.metaAds ? (
            <button className="btn primary sm" disabled={!!busy} onClick={ads}>
              {busy === "ads" ? "Enviando…" : "Subir no Meta Ads"}
            </button>
          ) : (
            <Link href="/settings#publish" className="btn sm">
              Configurar ›
            </Link>
          )}
        </div>
        {result && <div className="empty" style={{ padding: 12, textAlign: "left", wordBreak: "break-all" }}>{result}</div>}
        <div className="muted" style={{ fontSize: 11.5 }}>
          Alternativa sem configurar nada: baixe o MP4 e poste pelo celular, ou peça pro Claude subir o criativo pelo MCP do Meta Ads. TikTok ainda não (o app precisa de aprovação deles).
        </div>
      </div>
    </Modal>
  );
}
