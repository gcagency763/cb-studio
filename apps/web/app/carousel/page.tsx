"use client";

import { useEffect, useState } from "react";
import { api, fmtDate, type Job } from "@/lib/api";
import { History } from "@/components/create";
import { useToast } from "@/components/Toasts";

/**
 * Carrossel pro Instagram: tema → Seed 2.1 escreve os slides (capa, conteúdo, CTA) + legenda,
 * Seedream gera a arte de cada slide (cota grátis), FFmpeg compõe o texto. Sai PNG por slide + zip.
 */
const STYLES = [
  { id: "flat", label: "Flat / vetor" },
  { id: "epic", label: "Épico ilustrado" },
  { id: "comic", label: "Quadrinhos" },
  { id: "anime", label: "Anime" },
  { id: "cinematic", label: "Foto real" },
];
const COUNTS = [5, 7, 10];

export default function CarouselPage() {
  const toast = useToast();
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(7);
  const [style, setStyle] = useState("flat");
  const [format, setFormat] = useState<"4:5" | "1:1">("4:5");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [context, setContext] = useState("");
  const [accent, setAccent] = useState("#F5C04A");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ jobs: Job[] }>("/edit/jobs").then((r) => alive && setJobs(r.jobs.filter((j) => j.kind === "carousel"))).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");

  const go = async () => {
    if (theme.trim().length < 3) return toast("Escreva o tema do carrossel", "bad");
    setBusy(true);
    try {
      await api("/carousel", { method: "POST", body: JSON.stringify({ theme, slides: count, style, format, audience: audience || undefined, tone: tone || undefined, context: context || undefined, accent }) });
      toast(`Na fila: ${count} slides — uns 2 min`, "ok");
      setTick((t) => t + 1);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create">
      <aside className="panel" aria-label="Carrossel">
        <div className="field">
          <label htmlFor="ctheme">Tema do carrossel</label>
          <textarea id="ctheme" className="textarea" rows={4} value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={600} placeholder="Ex.: 5 erros de precificação que travam uma loja na Shopee — com exemplo de número em cada um" />
        </div>
        <div className="field">
          <label>Quantos slides</label>
          <div className="seg" style={{ justifySelf: "start" }}>
            {COUNTS.map((c) => (
              <button key={c} className={count === c ? "active" : ""} onClick={() => setCount(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Arte dos slides</label>
          <div className="style-grid">
            {STYLES.map((s) => (
              <button key={s.id} className={`style-opt pic ${style === s.id ? "active" : ""}`} onClick={() => setStyle(s.id)} style={{ backgroundImage: `url(/art/style-${s.id}.jpg)` }}>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="opts">
          <div className="opt">
            <label>Formato</label>
            <select value={format} onChange={(e) => setFormat(e.target.value as "4:5" | "1:1")}>
              <option value="4:5">4:5 (1080×1350, feed)</option>
              <option value="1:1">1:1 (1080×1080)</option>
            </select>
          </div>
          <div className="opt">
            <label>Cor de destaque</label>
            <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} style={{ height: 32, width: 56, background: "transparent", border: "1px solid var(--line)", borderRadius: 8 }} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="caud">Público e tom (opcional)</label>
          <input id="caud" className="input" value={audience} onChange={(e) => setAudience(e.target.value)} maxLength={200} placeholder="Público: quem vende na Shopee e está começando" />
          <input className="input" value={tone} onChange={(e) => setTone(e.target.value)} maxLength={200} placeholder="Tom: direto, provocador, sem jargão" style={{ marginTop: 6 }} />
        </div>
        <div className="field">
          <label htmlFor="cctx">Contexto (opcional)</label>
          <textarea id="cctx" className="textarea" rows={2} value={context} onChange={(e) => setContext(e.target.value)} maxLength={600} placeholder="Produto, oferta, termos que não mudar…" />
        </div>
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
          Seed 2.1 escreve capa com gancho, um ponto por slide e CTA; Seedream faz a arte (cota grátis, ≈ US$ {(count * 0.04).toFixed(2)} nominais); o texto entra por cima com degradê. Logo da marca (Provedores → Marca) entra sozinho.
        </div>
        <button className="btn primary gen" disabled={busy || theme.trim().length < 3} onClick={go}>
          {busy ? "Enviando…" : `Gerar carrossel de ${count}`} <span className="cost">US$ 0</span>
        </button>
      </aside>

      <History
        kind="carousel"
        refreshKey={tick}
        title="Carrosséis"
        tileInfo={(j) => (
          <>
            <span>{j.usage?.title ?? j.request?.theme?.slice(0, 40)}</span>
            <span>{j.usage?.count ? `${j.usage.count} slides` : ""}</span>
          </>
        )}
        actions={(j) => <CarouselDetail job={j} />}
        before={
          <>
            <div className="hero-strip">
              <img src="/art/step-escreva.jpg" alt="" />
              <div className="txt">
                <div className="display">
                  Um tema vira <em>um carrossel</em>
                </div>
                <p>Capa com gancho, um ponto por slide, CTA — com arte gerada no estilo da G2 e o texto já composto. Baixa o zip e posta.</p>
                <div className="chips">
                  <span>Seed 2.1 escreve</span>
                  <span>Seedream desenha</span>
                  <span>1080×1350</span>
                </div>
              </div>
            </div>
            {jobs.length > 0 && (
              <div className="area" style={{ gap: 8 }}>
                <div className="area-head">
                  <h2 style={{ fontSize: 14 }}>Trabalhos</h2>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {active.length ? `${active.length} em andamento` : "tudo concluído"}
                  </span>
                </div>
                <div className="jobs-list">
                  {jobs.slice(0, 6).map((j) => (
                    <div key={j.id} className={`job-row ${j.status}`}>
                      <span className={`status-dot ${j.status === "succeeded" ? "ok" : j.status === "failed" ? "bad" : "run"}`} />
                      <b>{j.request?.theme?.slice(0, 48)}</b>
                      <span className="muted">{j.status === "succeeded" ? `${j.usage?.count ?? 0} slides` : j.status === "failed" ? (j.error ?? "falhou").slice(0, 90) : j.status === "running" ? "processando…" : "na fila"}</span>
                      <span className="muted" style={{ marginLeft: "auto" }}>
                        {fmtDate(j.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        }
        empty={
          <div className="empty">
            <b>Nenhum carrossel ainda</b>
            Escreva o tema ao lado e clique em Gerar. Em uns 2 minutos os slides aparecem aqui com o zip pra baixar.
          </div>
        }
      />
    </div>
  );
}

function CarouselDetail({ job }: { job: Job }) {
  const toast = useToast();
  const slides: { index: number; url: string; headline: string; kind: string }[] = job.usage?.slides ?? [];
  const text = [job.usage?.caption, (job.usage?.hashtags ?? []).join(" ")].filter(Boolean).join("\n\n");
  return (
    <div style={{ display: "grid", gap: 10, fontSize: 12.5 }}>
      <b>{job.usage?.title}</b>
      {slides.length > 0 && (
        <div className="var-strip" style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {slides.map((s) => (
            <a key={s.index} href={s.url} target="_blank" rel="noreferrer" title={s.headline} style={{ flex: "0 0 auto" }}>
              <img src={s.url} alt={s.headline} style={{ height: 120, borderRadius: 6, border: "1px solid var(--line)" }} />
            </a>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {job.usage?.zipUrl && (
          <a className="btn primary sm" href={job.usage.zipUrl} download>
            Baixar zip ({slides.length} PNG)
          </a>
        )}
        {text && (
          <button
            className="btn sm"
            onClick={() => {
              navigator.clipboard.writeText(text).then(() => toast("Legenda copiada", "ok"));
            }}
          >
            Copiar legenda + hashtags
          </button>
        )}
      </div>
      {text && <pre className="code" style={{ whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{text}</pre>}
      <span className="muted" style={{ fontSize: 11 }}>
        Instagram não aceita carrossel por API sem URL pública — baixe o zip e poste pelo app (ou pelo Meta Business Suite).
      </span>
    </div>
  );
}
