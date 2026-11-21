"use client";

import Link from "next/link";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, fmtDate, isActive, isDone, uploadFile, usd, type Job } from "@/lib/api";
import { estimateVideoUsd, toOption, useModels, type CatalogModel, type Res } from "@/lib/models";
import { LibraryPicker, Modal, ModelPicker } from "@/components/create";
import { useConfirm, useToast } from "@/components/Toasts";

type Slot = "first" | "last" | "audio";

function VideoCreate() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const models = useModels("video");
  const [modelId, setModelId] = useState<string>("seedance-1-0-pro-fast-251015");
  const model: CatalogModel | undefined = useMemo(() => models.find((m) => m.id === modelId) ?? models[0], [models, modelId]);
  const [tab, setTab] = useState<"create" | "edit" | "motion">("create");
  const [prompt, setPrompt] = useState("");
  const [frame, setFrame] = useState<string | null>(params.get("frame"));
  const [endFrame, setEndFrame] = useState<string | null>(null);
  const [audioRef, setAudioRef] = useState<string | null>(null);
  const [ratio, setRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [res, setRes] = useState<Res>("720p");
  const [dur, setDur] = useState(5);
  const [audio, setAudio] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [lib, setLib] = useState<Slot | null>(null);
  const [right, setRight] = useState<"history" | "how">("history");
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [tick, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileSlot = useRef<Slot>("first");
  const cover = useMemo(() => jobs?.find((j) => isDone(j) && j.request?.model === model?.id) ?? jobs?.find(isDone), [jobs, model?.id]);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ generated: Job[] }>("/library?kind=video").then((r) => alive && setJobs(r.generated)).catch(() => alive && setJobs([]));
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);

  useEffect(() => {
    if (!model) return;
    if (model.resolutions && !model.resolutions.includes(res)) setRes(model.resolutions.includes("720p") ? "720p" : model.resolutions[model.resolutions.length - 1]);
    if (model.durations && !model.durations.includes(dur)) setDur(model.durations.includes(5) ? 5 : model.durations[0]);
    if (!model.nativeAudio) setAudio(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id]);

  const request = () => ({
    kind: "video",
    model: model?.id,
    prompt: prompt || "subtle natural motion, cinematic",
    firstFrame: frame ?? undefined,
    lastFrame: model?.endFrame && endFrame ? endFrame : undefined,
    audioRef: model?.audioRef && audioRef ? audioRef : undefined,
    ratio,
    resolution: res,
    durationSec: dur,
    audio: audio || (model?.audioRef && audioRef ? true : undefined),
  });

  useEffect(() => {
    if (!model) return;
    setEstimate(estimateVideoUsd(model, res, dur, audio));
    api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request: request() }) })
      .then((r) => setEstimate(r.estimatedCostUsd))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, ratio, res, dur, model?.id, audio, audioRef]);

  const paid = model?.provider === "fal" || model?.provider === "gpu" || model?.gate === "reserve";

  const generate = async () => {
    if (!model) return;
    if (model.locked) return toast(model.locked, "bad");
    if (!frame && prompt.trim().length < 3) return toast("Descreva o vídeo ou adicione o primeiro frame", "bad");
    if (!frame && model.needsFirstFrame) return toast(`${model.name} só anima uma imagem — adicione o primeiro frame`, "bad");
    setBusy(true);
    try {
      const { estimatedCostUsd } = await api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request: request() }) });
      if (paid && !await ask(`Gerar vídeo ${res} de ${dur}s com ${model.name}?\nCusto ${usd(estimatedCostUsd)} — COBRADO no cartão.`, "Gerar e cobrar")) return;
      await api<Job>("/generate", { method: "POST", body: JSON.stringify({ request: request(), allowPaid: paid }) });
      setTick((t) => t + 1);
      setRight("history");
      toast(`Vídeo gerando (1–3 min) — ${paid ? usd(estimatedCostUsd) + " no cartão" : "cota grátis"}`);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) toast(`Guarda de custo: ${usd(e.body.estimatedCostUsd)} acima do limite ${usd(e.body.maxJobCostUsd)}`, "bad");
      else toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const setSlot = (slot: Slot, url: string | null) => (slot === "first" ? setFrame(url) : slot === "last" ? setEndFrame(url) : setAudioRef(url));
  const openFile = (slot: Slot) => {
    fileSlot.current = slot;
    fileRef.current?.click();
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const u = await uploadFile(f);
      setSlot(fileSlot.current, u.url);
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };
  const hasRefs = !!(frame || endFrame || audioRef);

  return (
    <div className="create">
      <aside className="panel" aria-label="Criar vídeo">
        <div className="panel-tabs">
          <button className={`panel-tab ${tab === "create" ? "active" : ""}`} onClick={() => setTab("create")}>
            Criar vídeo
          </button>
          <Link href="/cuts" className="panel-tab" title="legenda karaokê, tirar pausas, zoom, b-roll, cortes — em Cortes">
            Editar vídeo
          </Link>
          <Link href="/roadmap#motion-transfer" className="panel-tab" title="transferir movimento (Kling Motion Control) — precisa da fal.ai">
            Motion control
          </Link>
        </div>

        {/* card do modelo com capa */}
        <button type="button" className="cover-card" onClick={() => setPick(true)}>
          {cover?.output_url ? <video src={cover.output_url} muted playsInline preload="metadata" /> : null}
          <span className="swap">✎ Trocar</span>
          <span className="txt">
            <span className="display">{model?.gate ? model.name : "Geral"}</span>
            <span>{model?.name ?? "…"} · {model?.free ? "cota grátis" : model?.gate === "reserve" ? "reserva US$ 30" : "fal.ai"}</span>
          </span>
        </button>
        {model?.locked && <div className="empty" style={{ padding: 10, fontSize: 12 }}>{model.locked}</div>}

        {/* referências */}
        <input ref={fileRef} type="file" accept={fileSlot.current === "audio" ? "audio/*" : "image/*"} hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {!hasRefs ? (
          <div className="refbox">
            <div className="icons">
              <i title="imagem">🖼️</i>
              {model?.endFrame && <i title="último frame">🎞️</i>}
              {model?.audioRef && <i title="áudio">🔊</i>}
            </div>
            <b>Adicionar referências</b>
            <span>{model?.needsFirstFrame ? "Primeiro frame (obrigatório)" : "Imagem"}{model?.endFrame ? ", último frame" : ""}{model?.audioRef ? " ou áudio (fala)" : ""}</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn sm" onClick={() => openFile("first")}>
                Upload
              </button>
              <button className="btn sm ghost" onClick={() => setLib("first")}>
                Biblioteca
              </button>
            </div>
          </div>
        ) : (
          <div className="refgrid">
            <RefSlot label="Início" url={frame} onPick={() => setLib("first")} onUpload={() => openFile("first")} onClear={() => setFrame(null)} />
            {model?.endFrame && <RefSlot label="Fim" url={endFrame} onPick={() => setLib("last")} onUpload={() => openFile("last")} onClear={() => setEndFrame(null)} />}
            {model?.audioRef && <RefSlot label="Áudio" url={audioRef} kind="audio" onPick={() => setLib("audio")} onUpload={() => openFile("audio")} onClear={() => setAudioRef(null)} />}
          </div>
        )}

        {/* prompt */}
        <div className="promptbox">
          <label htmlFor="prompt">Prompt</label>
          <textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={model?.needsFirstFrame ? "Descreva o movimento e a câmera — ex.: “slow push-in, ela levanta os olhos e sorri, papéis voam”" : "Descreva a cena ou a mudança — ex.: “faça chover” ou “câmera orbita o personagem”"} />
          <div className="chips">
            <label className="chipb">
              <span className="k">Duração</span>
              <select value={dur} onChange={(e) => setDur(+e.target.value)}>
                {(model?.durations ?? [3, 4, 5, 6, 8, 10]).map((n) => (
                  <option key={n} value={n}>
                    {n} s
                  </option>
                ))}
              </select>
            </label>
            <label className="chipb">
              <span className="k">Qualidade</span>
              <select value={res} onChange={(e) => setRes(e.target.value as Res)}>
                {(model?.resolutions ?? ["480p", "720p", "1080p"]).map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            {!frame && (
              <label className="chipb">
                <span className="k">Formato</span>
                <select value={ratio} onChange={(e) => setRatio(e.target.value as any)}>
                  {["9:16", "16:9", "1:1"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="chipb" title={model?.nativeAudio ? "som ambiente/falas gerados junto do vídeo" : "esse modelo gera vídeo mudo; a narração entra na montagem"}>
              <span className="k">🔊 Áudio</span>
              <select value={audio ? "on" : "off"} disabled={!model?.nativeAudio} onChange={(e) => setAudio(e.target.value === "on")}>
                <option value="off">{model?.nativeAudio ? "off" : "na montagem"}</option>
                {model?.nativeAudio && <option value="on">on</option>}
              </select>
            </label>
          </div>
        </div>
        {/* presets de câmera e emoção (Cinema Studio / Director Panel) — entram no prompt */}
        <div className="presets">
          <span className="muted">Câmera</span>
          {CAMERA.map((c) => (
            <button key={c.label} type="button" className="preset" title={c.text} onClick={() => setPrompt((p) => (p.trim() ? `${p.trim().replace(/[.,;]$/, "")}, ${c.text}` : c.text))}>
              {c.label}
            </button>
          ))}
          <span className="muted">Emoção</span>
          {EMOTION.map((c) => (
            <button key={c.label} type="button" className="preset" title={c.text} onClick={() => setPrompt((p) => (p.trim() ? `${p.trim().replace(/[.,;]$/, "")}, ${c.text}` : c.text))}>
              {c.label}
            </button>
          ))}
        </div>
        {model?.tip && <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>💡 {model.tip}</div>}

        <button className="gen-big" disabled={busy || !model || !!model.locked} onClick={generate}>
          {busy ? "Enviando…" : "Gerar"} <span className="cost">{estimate == null ? "" : paid ? usd(estimate) : "grátis"}</span>
        </button>
        <span className="muted" style={{ fontSize: 11, textAlign: "center" }}>{paid ? `cobra ${estimate != null ? usd(estimate) : ""} no cartão ao gerar` : `sai da cota grátis da BytePlus (vale ${estimate != null ? usd(estimate) : "—"} de tabela) · cartão US$ 0`}</span>
      </aside>

      <section className="area">
        <div className="area-head">
          <div className="tabs2">
            <button className={right === "history" ? "active" : ""} onClick={() => setRight("history")}>
              🗂 Histórico
            </button>
            <button className={right === "how" ? "active" : ""} onClick={() => setRight("how")}>
              📖 Como funciona
            </button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            {jobs?.length ?? 0} vídeos
          </span>
        </div>

        {right === "how" || (jobs && jobs.length === 0) ? (
          <div className="howto">
            <h2>
              Vídeos em <span style={{ color: "var(--coral)" }}>um clique</span>
            </h2>
            <p>Escolha o modelo, adicione a imagem (ou só descreva a cena), diga o movimento e gere. Cada modelo mostra o preço antes; os grátis saem da cota da BytePlus sem tocar no cartão.</p>
            <div className="steps">
              <div className="step">
                <div className="box"><img src="/art/step-escreva.jpg" alt="" /></div>
                <b>Adicione a imagem</b>
                <span>Gere em Imagem ou faça upload. Mão com objeto? Use início e fim no Kling 3.0 Pro.</span>
              </div>
              <div className="step">
                <div className="box"><img src="/art/step-anime.jpg" alt="" /></div>
                <b>Escolha o modelo</b>
                <span>Seedance 1.0 fast (grátis) pra planos simples; 2.5 pra fala sincronizada; Kling pra câmera cinematográfica.</span>
              </div>
              <div className="step">
                <div className="box"><img src="/art/step-video.jpg" alt="" /></div>
                <b>Receba o vídeo</b>
                <span>Em 1–3 min aparece aqui. Monte com narração e legenda no Quadrinhos.</span>
              </div>
            </div>
          </div>
        ) : !jobs ? (
          <div className="muted">Carregando…</div>
        ) : (
          <div className="masonry">
            {jobs.map((j) => (
              <div key={j.id} className={`tile ${isActive(j) ? "pending" : j.status === "failed" ? "failed" : ""}`} onClick={() => isDone(j) && setSelected(j)} role="button" tabIndex={0}>
                {isDone(j) ? <video src={j.output_url!} muted playsInline preload="metadata" onError={(e) => { const t = e.currentTarget.closest(".tile") as HTMLElement | null; if (t) t.style.display = "none"; }} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} /> : isActive(j) ? <span className="stage"><span className="status-dot run" /> {j.status === "queued" ? "na fila" : "gerando · 1–3 min"}</span> : <span style={{ padding: 10 }}>{j.error?.slice(0, 120)}</span>}
                {isDone(j) && (
                  <div className="over">
                    <span>{models.find((m) => m.id === j.request?.model)?.name ?? j.request?.model ?? "vídeo"}</span>
                    <span>{usd(j.estimated_cost_usd)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {pick && model && <ModelPicker current={model.id} options={models.map(toOption)} onClose={() => setPick(false)} onPick={(m) => setModelId(m.id)} />}
      {lib && (
        <LibraryPicker
          kind={lib === "audio" ? "audio" : "image"}
          onClose={() => setLib(null)}
          onPick={(url) => {
            setSlot(lib, url);
            setLib(null);
          }}
        />
      )}
      {selected && (
        <Modal title="Vídeo" onClose={() => setSelected(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 16 }}>
            <div style={{ background: "#000", borderRadius: 10, overflow: "hidden", display: "grid", placeItems: "center", minHeight: 200 }}>
              <video src={selected.output_url!} controls autoPlay style={{ maxWidth: "100%", maxHeight: "72vh" }} />
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div className="muted" style={{ fontSize: 12 }}>
                {fmtDate(selected.created_at)} · {usd(selected.estimated_cost_usd)}
              </div>
              {selected.request?.prompt && <div style={{ fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>{selected.request.prompt}</div>}
              <button className="btn" onClick={() => { setPrompt(selected.request?.prompt ?? ""); if (selected.request?.firstFrame) setFrame(selected.request.firstFrame); setSelected(null); }}>
                Reusar configuração
              </button>
              <button
                className="btn"
                title="último frame → Seedance 1.0 continua a cena (cota grátis) → emenda. Em movimento rápido pode dar um solavanco na emenda."
                onClick={async () => {
                  try {
                    await api(`/videos/${selected.id}/extend`, { method: "POST", body: JSON.stringify({ durationSec: 5 }) });
                    toast("Estendendo +5 s — o vídeo novo aparece aqui em 1–3 min", "ok");
                    setSelected(null);
                    setTick((t) => t + 1);
                  } catch (e: any) {
                    toast(e.message, "bad");
                  }
                }}
              >
                Estender +5 s (grátis)
              </button>
              <button
                className="btn"
                title="lanczos + nitidez, sem IA (grátis, local). Pra recuperar detalhe de verdade existe o Topaz na fal (pago)."
                onClick={async () => {
                  try {
                    await api(`/videos/${selected.id}/upscale`, { method: "POST", body: JSON.stringify({ to: "1080p" }) });
                    toast("Ampliando pra 1080p — aparece aqui em ~1 min", "ok");
                    setSelected(null);
                    setTick((t) => t + 1);
                  } catch (e: any) {
                    toast(e.message, "bad");
                  }
                }}
              >
                Ampliar pra 1080p (grátis)
              </button>
              <button className="btn" onClick={() => router.push(`/clone`)}>
                Arrumar a boca (Clone)
              </button>
              <a className="btn ghost" href={selected.output_url!} download>
                Baixar
              </a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RefSlot({ label, url, kind, onPick, onUpload, onClear }: { label: string; url: string | null; kind?: "audio"; onPick: () => void; onUpload: () => void; onClear: () => void }) {
  return (
    <div className={`refslot ${kind === "audio" ? "audio" : ""}`} onClick={() => (url ? null : onPick())} title={url ? label : `adicionar ${label.toLowerCase()}`}>
      {url ? kind === "audio" ? <audio className="player" src={url} controls preload="none" onClick={(e) => e.stopPropagation()} /> : <img src={url} alt="" /> : (
        <span>
          + {label}
          <br />
          <small style={{ opacity: 0.7 }} onClick={(e) => { e.stopPropagation(); onUpload(); }}>ou upload</small>
        </span>
      )}
      <span className="lbl">{label}</span>
      {url && (
        <button className="x" onClick={(e) => { e.stopPropagation(); onClear(); }} aria-label="remover">
          ×
        </button>
      )}
    </div>
  );
}

/** presets de direção (o vocabulário do Director Panel do Higgsfield, em prompts que os modelos entendem) */
const CAMERA = [
  { label: "push-in lento", text: "slow cinematic push-in toward the subject" },
  { label: "dolly out", text: "slow dolly out revealing the scene" },
  { label: "órbita", text: "camera slowly orbits around the subject" },
  { label: "crash zoom", text: "fast crash zoom into the face" },
  { label: "handheld", text: "subtle handheld camera shake, documentary feel" },
  { label: "drone", text: "aerial drone shot rising up and away" },
  { label: "parallax", text: "gentle parallax, foreground and background drifting at different speeds" },
  { label: "close-up mãos", text: "close-up on the hands, shallow depth of field" },
  { label: "35 mm", text: "35mm lens, natural perspective, soft bokeh" },
  { label: "tele 85 mm", text: "85mm telephoto, compressed background, shallow focus" },
];
const EMOTION = [
  { label: "surpresa", text: "eyes widen in surprise, eyebrows lift" },
  { label: "alívio", text: "a slow relieved smile, shoulders relax" },
  { label: "tensão", text: "tense expression, jaw tight, slight tremor" },
  { label: "confiança", text: "confident look straight into the camera, slight smile" },
  { label: "tristeza", text: "eyes lower, sad and quiet, slow blink" },
  { label: "riso", text: "bursts into warm laughter" },
];

export default function VideoPage() {
  return (
    <Suspense fallback={<div className="page-pad muted">Carregando…</div>}>
      <VideoCreate />
    </Suspense>
  );
}
