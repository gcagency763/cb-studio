"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, fmtDate, type Job, type Voice } from "@/lib/api";
import { History, ReferencePicker } from "@/components/create";
import { useToast } from "@/components/Toasts";
import { PublishButton } from "@/components/Publish";

/**
 * Cortes: vídeo longo (aula, live, gravação) → cortes virais legendados, ou só a legenda karaokê.
 * Tudo local e grátis: Whisper (Docker) + Seed 2.1 (escolhe os trechos) + FFmpeg.
 */
type EditStatus = { whisper: boolean; starting?: boolean; model: string; language: string };
type Fmt = "9:16" | "original" | "1:1";

const COUNTS = [3, 6, 10];
const RANGES: { id: string; label: string; min: number; max: number }[] = [
  { id: "short", label: "15–40 s", min: 15, max: 40 },
  { id: "mid", label: "30–60 s", min: 25, max: 70 },
  { id: "long", label: "45–90 s", min: 45, max: 90 },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Lang = "en" | "es" | "pt-BR" | "it" | "fr" | "de" | "ja";
const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "inglês" },
  { id: "es", label: "espanhol" },
  { id: "pt-BR", label: "português (regravar)" },
  { id: "it", label: "italiano" },
  { id: "fr", label: "francês" },
  { id: "de", label: "alemão" },
  { id: "ja", label: "japonês" },
];
const parseTime = (v: string) => {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (m) return +m[1] * 60 + +m[2];
  const n = +v.replace(",", ".");
  return Number.isFinite(n) ? n : NaN;
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

/** ajustar os limites e o título de um corte e refazer (novo clipe, o antigo fica no histórico) */
function AdjustCut({ job, onDone }: { job: Job; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(fmtTime(job.request?.start ?? 0));
  const [end, setEnd] = useState(fmtTime(job.request?.end ?? 0));
  const [title, setTitle] = useState(job.request?.title ?? "");
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <button className="btn sm" onClick={() => setOpen(true)}>
        Ajustar corte ›
      </button>
    );
  const go = async () => {
    const a = parseTime(start), b = parseTime(end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b - a < 3) return toast("Tempos inválidos (mín. 3 s) — use m:ss.s", "bad");
    setBusy(true);
    try {
      await api(`/cuts/${job.id}/rerender`, { method: "POST", body: JSON.stringify({ start: a, end: b, title: title || undefined }) });
      toast("Refazendo o corte — aparece aqui em instantes", "ok");
      setOpen(false);
      onDone();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 8, padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div className="field">
          <label>Começo (m:ss.s)</label>
          <input className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label>Fim</label>
          <input className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Gancho no topo</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary sm" disabled={busy} onClick={go}>
          {busy ? "Enviando…" : "Refazer corte"}
        </button>
        <button className="btn sm" onClick={() => setOpen(false)}>
          Cancelar
        </button>
      </div>
      <span className="muted" style={{ fontSize: 11 }}>
        Tempos do vídeo original. Mesmas opções do lote (formato, pausas, zoom, reenquadre).
      </span>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { cuts: "cortes", caption: "legenda", transcribe: "transcrição", dub: "dublagem", recreate: "roteiro da referência" };

export default function CutsPage() {
  return (
    <Suspense fallback={<div className="page-pad muted">Carregando…</div>}>
      <Cuts />
    </Suspense>
  );
}

function Cuts() {
  const toast = useToast();
  const params = useSearchParams();
  const [mode, setMode] = useState<"cuts" | "caption" | "dub">(params.get("tab") === "dub" ? "dub" : "cuts");
  const [lang, setLang] = useState<Lang>("en");
  const [dubVoice, setDubVoice] = useState("same");
  const [consent, setConsent] = useState(false);
  const [dubCaptions, setDubCaptions] = useState(true);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [video, setVideo] = useState<string | null>(null);
  const [count, setCount] = useState(6);
  const [range, setRange] = useState("mid");
  const [format, setFormat] = useState<Fmt>("9:16");
  const [context, setContext] = useState("");
  const [title, setTitle] = useState("");
  const [uppercase, setUppercase] = useState(true);
  const [big, setBig] = useState(true);
  const [cutSilence, setCutSilence] = useState(true);
  const [cutFillers, setCutFillers] = useState(true);
  const [zooms, setZooms] = useState(true);
  const [broll, setBroll] = useState(0);
  const [brollStyle, setBrollStyle] = useState("cinematic");
  const [reframe, setReframe] = useState<"face" | "center">("face");
  const [logo, setLogo] = useState(true);
  const [hasLogo, setHasLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [status, setStatus] = useState<EditStatus | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api<EditStatus>("/edit/status").then((s) => alive && setStatus(s)).catch(() => alive && setStatus({ whisper: false, model: "", language: "pt" }));
      api<{ jobs: Job[] }>("/edit/jobs").then((r) => alive && setJobs(r.jobs)).catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);

  useEffect(() => {
    if (mode === "dub" && !voices.length) api<{ voices: Voice[] }>("/voices").then((r) => setVoices(r.voices)).catch(() => {});
  }, [mode, voices.length]);
  useEffect(() => {
    api<{ brand: { logo?: { url: string } | null } }>("/brand").then((r) => setHasLogo(!!r.brand?.logo?.url)).catch(() => {});
  }, []);

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");

  const go = async () => {
    if (!video) return toast("Escolha o vídeo primeiro", "bad");
    setBusy(true);
    try {
      if (mode === "cuts") {
        const r = RANGES.find((x) => x.id === range)!;
        await api("/cuts", { method: "POST", body: JSON.stringify({ videoUrl: video, count, minSec: r.min, maxSec: r.max, context: context || undefined, format, cutSilence, cutFillers, zooms, broll: Math.min(2, broll), brollStyle, reframe, logo }) });
        toast(`Na fila: transcrever e gerar ${count} cortes — ~1 min por 5 min de vídeo${status?.whisper ? "" : " (mais o tempo de subir a transcrição)"}`, "ok");
      } else if (mode === "dub") {
        if (dubVoice === "same" && !consent) return toast("Marque que a pessoa do vídeo autorizou clonar a voz", "bad");
        await api("/dub", { method: "POST", body: JSON.stringify({ videoUrl: video, language: lang, voice: dubVoice, consent, captions: dubCaptions, format, context: context || undefined }) });
        toast(`Na fila: transcrever, traduzir e dublar — ~2 min por minuto de fala`, "ok");
      } else {
        await api("/caption", { method: "POST", body: JSON.stringify({ videoUrl: video, format, uppercase, fontSize: big ? undefined : format === "9:16" ? 60 : 48, title: title || undefined, cutSilence, cutFillers, zooms, broll, brollStyle, reframe, logo }) });
        toast("Na fila: transcrever e legendar", "ok");
      }
      setTick((t) => t + 1);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create">
      <aside className="panel" aria-label="Cortes">
        <div className="panel-tabs">
          <button className={`panel-tab ${mode === "cuts" ? "active" : ""}`} onClick={() => setMode("cuts")}>
            Cortes virais
          </button>
          <button className={`panel-tab ${mode === "caption" ? "active" : ""}`} onClick={() => setMode("caption")}>
            Só legendar
          </button>
          <button className={`panel-tab ${mode === "dub" ? "active" : ""}`} onClick={() => setMode("dub")}>
            Dublar
          </button>
        </div>

        <div className="kv" style={{ fontSize: 12 }}>
          <span>
            <span className={`status-dot ${status?.whisper ? "ok" : "run"}`} /> Transcrição local {status ? (status.whisper ? `· ${status.model} · ${status.language}` : status.starting ? "· subindo (1ª vez baixa ~1,8 GB)…" : "· fora do ar — o OrbStack está aberto?") : "…"}
          </span>
          <b style={{ color: "var(--ok)" }}>US$ 0</b>
        </div>

        <ReferencePicker kind="video" label="Vídeo (aula, live, gravação)" value={video} onChange={setVideo} accept="video/*,audio/*" hint="mp4 ou mov de qualquer tamanho — sobe em stream, pode ser uma aula de 1 h" />

        {mode === "dub" ? (
          <>
            <div className="field">
              <label>Dublar para</label>
              <div className="seg wrap" style={{ justifySelf: "start" }}>
                {LANGS.map((l) => (
                  <button key={l.id} className={lang === l.id ? "active" : ""} onClick={() => setLang(l.id)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                {lang === "pt-BR" ? "Regrava a narração em português, limpa (sem “né”, “tipo”, gaguejos) — bom pra áudio ruim." : "Traduz no tempo da fala e fala na outra língua. A boca continua a original (boca refeita é o lipsync, pago)."}
              </span>
            </div>
            <div className="field">
              <label htmlFor="dvoice">Voz</label>
              <select id="dvoice" className="select" value={dubVoice} onChange={(e) => setDubVoice(e.target.value)}>
                <option value="same">a mesma voz do vídeo (clonada)</option>
                <option value="default">voz padrão do estúdio</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {dubVoice === "same" && (
                <label className={`tog ${consent ? "on" : ""}`} style={{ marginTop: 6 }}>
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> a pessoa que fala no vídeo autorizou clonar a voz dela
                </label>
              )}
            </div>
            <div className="field">
              <label>Legenda</label>
              <div className="toggles">
                <label className={`tog ${dubCaptions ? "on" : ""}`}>
                  <input type="checkbox" checked={dubCaptions} onChange={(e) => setDubCaptions(e.target.checked)} /> queimar a legenda traduzida (karaokê)
                </label>
              </div>
            </div>
            <div className="field">
              <label htmlFor="dctx">Contexto (opcional)</label>
              <textarea id="dctx" className="textarea" rows={2} value={context} onChange={(e) => setContext(e.target.value)} maxLength={600} placeholder="Ex.: nomes e termos que não traduzir (Shopee, MVS); público; tom" />
            </div>
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
              Custo zero: usa a cota grátis de voz (Seed Audio) — ~1 min de cota por minuto de fala. Sai também a legenda .srt na língua nova.
            </div>
          </>
        ) : mode === "cuts" ? (
          <>
            <div className="field">
              <label>Quantos cortes</label>
              <div className="seg" style={{ justifySelf: "start" }}>
                {COUNTS.map((c) => (
                  <button key={c} className={count === c ? "active" : ""} onClick={() => setCount(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Duração de cada corte</label>
              <div className="seg" style={{ justifySelf: "start" }}>
                {RANGES.map((r) => (
                  <button key={r.id} className={range === r.id ? "active" : ""} onClick={() => setRange(r.id)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="ctx">Contexto (opcional)</label>
              <textarea id="ctx" className="textarea" rows={3} value={context} onChange={(e) => setContext(e.target.value)} maxLength={600} placeholder="Ex.: aula do Cirilo sobre precificação na Shopee; público iniciante; destacar números e histórias de alunos" />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="ttl">Gancho no topo (opcional, 3 s)</label>
              <input id="ttl" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Ex.: O ERRO QUE TRAVA SUA LOJA" />
            </div>
            <div className="opts">
              <div className="opt">
                <label>Letras</label>
                <select value={uppercase ? "caps" : "normal"} onChange={(e) => setUppercase(e.target.value === "caps")}>
                  <option value="caps">CAIXA ALTA</option>
                  <option value="normal">Normal</option>
                </select>
              </div>
              <div className="opt">
                <label>Tamanho</label>
                <select value={big ? "big" : "std"} onChange={(e) => setBig(e.target.value === "big")}>
                  <option value="big">Grande (Reels)</option>
                  <option value="std">Padrão</option>
                </select>
              </div>
            </div>
          </>
        )}

        {mode !== "dub" && (
        <div className="field">
          <label>Edição automática</label>
          <div className="toggles">
            <label className={`tog ${cutSilence ? "on" : ""}`}>
              <input type="checkbox" checked={cutSilence} onChange={(e) => setCutSilence(e.target.checked)} /> tirar pausas e silêncios
            </label>
            <label className={`tog ${cutFillers ? "on" : ""}`} title="palavras marcadas como vício na revisão da transcrição (Seed 2.1): saem da legenda e do vídeo">
              <input type="checkbox" checked={cutFillers} onChange={(e) => setCutFillers(e.target.checked)} /> tirar “ééé”, “né” e repetições
            </label>
            <label className={`tog ${zooms ? "on" : ""}`}>
              <input type="checkbox" checked={zooms} onChange={(e) => setZooms(e.target.checked)} /> zoom nas frases fortes
            </label>
            {hasLogo && (
              <label className={`tog ${logo ? "on" : ""}`} title="logo de Provedores → Marca no canto">
                <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} /> logo da marca
              </label>
            )}
          </div>
          <div className="opts" style={{ marginTop: 6 }}>
            <div className="opt" title="imagens geradas (Seedream, cota grátis) que entram nas frases com objeto, lugar ou número">
              <label>B-roll gerado</label>
              <select value={broll} onChange={(e) => setBroll(+e.target.value)}>
                <option value={0}>nenhum</option>
                <option value={2}>{mode === "cuts" ? "até 2 por corte" : "2 imagens"}</option>
                {mode === "caption" && <option value={4}>4 imagens</option>}
                {mode === "caption" && <option value={8}>8 imagens</option>}
              </select>
            </div>
            <div className="opt">
              <label>Estilo do b-roll</label>
              <select value={brollStyle} onChange={(e) => setBrollStyle(e.target.value)} disabled={!broll}>
                <option value="cinematic">foto real</option>
                <option value="epic">épico ilustrado</option>
                <option value="comic">quadrinhos</option>
                <option value="anime">anime</option>
                <option value="flat">flat</option>
              </select>
            </div>
          </div>
          {broll > 0 && (
            <span className="muted" style={{ fontSize: 11 }}>
              ≈ US$ {((mode === "cuts" ? Math.min(2, broll) * count : broll) * 0.04).toFixed(2)} da cota grátis do Seedream · cada imagem fica 2–3 s na tela
            </span>
          )}
        </div>
        )}
        <div className="field">
          <label>Formato</label>
          <div className="seg" style={{ justifySelf: "start" }}>
            {(["9:16", "original", "1:1"] as Fmt[]).map((f) => (
              <button key={f} className={format === f ? "active" : ""} onClick={() => setFormat(f)}>
                {f === "original" ? "original" : f}
              </button>
            ))}
          </div>
          {format !== "original" && mode !== "dub" && (
            <div className="seg" style={{ justifySelf: "start", marginTop: 6 }} title="como recortar pra 9:16 / 1:1">
              <button className={reframe === "face" ? "active" : ""} onClick={() => setReframe("face")}>
                segue quem fala
              </button>
              <button className={reframe === "center" ? "active" : ""} onClick={() => setReframe("center")}>
                centro fixo
              </button>
            </div>
          )}
          <span className="muted" style={{ fontSize: 11 }}>
            {format === "original" ? "Original mantém o enquadramento." : reframe === "face" && mode !== "dub" ? "O recorte segue o rosto de quem fala (detector local, grátis) — a câmera só se move quando a pessoa sai do quadro. Sem rosto, corta o centro." : "Corta o centro da imagem (Reels/TikTok/Shorts)."}
          </span>
        </div>

        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
          💡 Legenda karaokê da G2 (palavra atual em dourado, caixa alta), frases curtas de até 5 palavras. A transcrição de um vídeo fica guardada: cortes e legendas seguintes do mesmo vídeo saem na hora.
        </div>
        <button className="btn primary gen" disabled={busy || !video} onClick={go}>
          {busy ? "Enviando…" : mode === "cuts" ? `Gerar ${count} cortes` : mode === "dub" ? `Dublar em ${LANGS.find((l) => l.id === lang)?.label.replace(" (regravar)", "")}` : "Legendar vídeo"} <span className="cost">US$ 0</span>
        </button>
      </aside>

      <History
        kind="cuts"
        refreshKey={tick}
        title="Cortes e vídeos legendados"
        tileInfo={(j) => (
          <>
            <span>{j.request?.title ? `${j.request.score ?? ""}${j.request.score != null ? "/10 · " : ""}${j.request.title}` : j.kind === "caption" ? "legendado" : j.kind === "dub" ? `dublado · ${LANGS.find((l) => l.id === j.request?.language)?.label ?? j.request?.language}` : ""}</span>
            <span>{j.usage?.durationSec ? `${Math.round(j.usage.durationSec)} s` : ""}</span>
          </>
        )}
        actions={(j) => (
          <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            {j.kind === "cut" && (
              <>
                <b>{j.request?.title}</b>
                <span className="muted">
                  nota {j.request?.score}/10 · trecho {mmss(j.request?.start ?? 0)}–{mmss(j.request?.end ?? 0)}
                </span>
                {j.request?.hook && <i>“{j.request.hook}”</i>}
                {j.request?.reason && <span className="muted">{j.request.reason}</span>}
                {j.request?.adjusted && <span className="badge">ajustado na mão</span>}
                <AdjustCut job={j} onDone={() => setTick((t) => t + 1)} />
              </>
            )}
            {j.kind === "dub" && (
              <>
                <b>Dublado em {LANGS.find((l) => l.id === j.request?.language)?.label ?? j.request?.language}</b>
                {j.usage?.translation && (
                  <details>
                    <summary className="muted" style={{ cursor: "pointer" }}>texto traduzido</summary>
                    <pre className="code" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{j.usage.translation}</pre>
                  </details>
                )}
                <a className="btn ghost sm" href={`/api/transcripts/${j.id}/export?format=srt`} download>
                  legenda .srt traduzida
                </a>
              </>
            )}
            {j.output_url && <PublishButton videoUrl={j.output_url} caption={j.request?.hook ?? j.request?.title ?? ""} name={j.request?.title ?? (j.kind === "dub" ? "dublagem" : "corte")} jobId={j.id} />}
          </div>
        )}
        before={
          <>
            <div className="hero-strip">
              <img src="/art/banner-historias.jpg" alt="" />
              <div className="txt">
                <div className="display">
                  Uma aula vira <em>dez cortes</em>
                </div>
                <p>Sobe a gravação. O estúdio transcreve, escolhe os melhores trechos, reenquadra em 9:16, legenda no estilo da G2 — e dubla pra outra língua com a sua voz. De graça, no seu Mac.</p>
                <div className="chips">
                  <span>Whisper local</span>
                  <span>Seed 2.1 escolhe os trechos</span>
                  <span>legenda karaokê</span>
                  <span>dublagem com a sua voz</span>
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
                  {jobs.slice(0, 8).map((j) => (
                    <div key={j.id} className={`job-row ${j.status}`}>
                      <span className={`status-dot ${j.status === "succeeded" ? "ok" : j.status === "failed" ? "bad" : "run"}`} />
                      <b>{j.kind === "cuts" ? `${j.request?.count ?? ""} cortes` : j.kind === "dub" ? `dublagem · ${LANGS.find((l) => l.id === j.request?.language)?.label ?? j.request?.language}` : KIND_LABEL[j.kind] ?? j.kind}</b>
                      <span className="muted">
                        {j.status === "succeeded" ? (j.kind === "cuts" ? `${j.usage?.count ?? 0} clipes prontos` : j.kind === "transcribe" ? `${Math.round((j.usage?.durationSec ?? 0) / 60)} min · ${j.usage?.words ?? 0} palavras` : "pronto") : j.status === "failed" ? (j.error ?? "falhou").slice(0, 90) : j.status === "running" ? "processando…" : "na fila"}
                      </span>
                      {j.status === "succeeded" && (j.kind === "transcribe" || j.usage?.transcriptUrl) && (
                        <a className="btn ghost sm" href={`/api/transcripts/${j.id}/export?format=srt`} download title="legenda .srt pra YouTube/CapCut" style={{ marginLeft: "auto" }}>
                          .srt
                        </a>
                      )}
                      <span className="muted" style={{ marginLeft: j.status === "succeeded" && (j.kind === "transcribe" || j.usage?.transcriptUrl) ? 0 : "auto" }}>
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
            <b>Nenhum corte ainda</b>
            Escolha um vídeo longo ao lado e clique em Gerar cortes. Uma aula de 1 h leva uns 10–15 min na primeira vez (transcrição) e os cortes aparecem aqui.
          </div>
        }
      />
    </div>
  );
}
