"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api, usd, type Job, type Voice } from "@/lib/api";
import { toOption, useModels, type CatalogModel } from "@/lib/models";
import { History, ModelCard, ReferencePicker } from "@/components/create";
import { NewVoiceModal } from "@/components/NewVoiceModal";
import { useConfirm, useToast } from "@/components/Toasts";

/**
 * Clone: uma pessoa real falando sem gravar.
 *  Foto da pessoa + voz clonada + texto → vídeo falando (OmniHuman / Kling Avatar / Seedance 2.5)
 *  Vídeo pronto + narração → boca refeita (Sync Lipsync)
 * Só gente com autorização — o cadastro da voz registra quem autorizou.
 */
export default function ClonePage() {
  const toast = useToast();
  const ask = useConfirm();
  const [tab, setTab] = useState<"avatar" | "lipsync">("avatar");
  const avatars = useModels("avatar");
  const lipsyncs = useModels("lipsync");
  const videoModels = useModels("video");
  const audioModels = useModels("audio");
  // Seedance 2.5 também anima pela voz: aceita áudio de referência
  const options = useMemo(() => [...avatars, ...videoModels.filter((m) => m.audioRef)], [avatars, videoModels]);
  const [modelId, setModelId] = useState("omnihuman-1.5");
  const model: CatalogModel | undefined = options.find((m) => m.id === modelId) ?? options[0];
  const tts = audioModels.find((m) => !m.locked);

  const [photo, setPhoto] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  // fala: ou escreve o texto (gera com a voz clonada) ou escolhe uma narração pronta
  const [speech, setSpeech] = useState<"text" | "audio">("text");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [audio, setAudio] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [res, setRes] = useState<"720p" | "1080p">("1080p");
  const [audioSec, setAudioSec] = useState(10);
  const [pro, setPro] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [newVoice, setNewVoice] = useState(false);
  const loadVoices = () => api<{ voices: Voice[] }>("/voices").then((r) => setVoices(r.voices)).catch(() => {});
  useEffect(() => {
    loadVoices();
  }, []);
  const voice = voices.find((v) => v.id === voiceId) ?? null;

  // duração: medida do áudio escolhido, ou estimada do texto (~15 caracteres por segundo)
  useEffect(() => {
    if (speech === "text") {
      setAudioSec(Math.max(3, Math.ceil(text.length / 15)));
      return;
    }
    if (!audio) return;
    const a = new Audio(audio);
    a.addEventListener("loadedmetadata", () => Number.isFinite(a.duration) && setAudioSec(Math.ceil(a.duration)));
  }, [audio, text, speech]);

  const lip = lipsyncs[0];
  const target = tab === "avatar" ? model : lip;
  const paid = !!target && (target.provider === "fal" || target.gate === "reserve");
  const perSec = target?.price.perSec ?? {};
  const unit = perSec[res] ?? perSec["1080p"] ?? Object.values(perSec)[0] ?? (target?.price.perMin ? target.price.perMin / 60 : 0);
  const estimate = unit * audioSec * (tab === "lipsync" && pro ? 1.67 : 1);
  const ready = tab === "avatar" ? !!photo && (speech === "text" ? text.trim().length > 1 : !!audio) : !!video && !!audio;

  /** gera a narração com a voz clonada e espera ficar pronta (cota grátis do Seed Audio) */
  const narrate = async (): Promise<string> => {
    if (!voice) throw new Error("Escolha a voz da pessoa (ou cadastre uma nova)");
    setBusy("Gerando a fala com a voz clonada…");
    const job = await api<Job>("/generate", {
      method: "POST",
      body: JSON.stringify({ request: { kind: "audio", text: text.trim(), voiceRef: { audioUrl: voice.reference_url }, format: "wav", subtitles: true } }),
    });
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const j = await api<Job>(`/jobs/${job.id}`);
      if (j.status === "succeeded" && j.output_url) {
        setAudio(j.output_url);
        return j.output_url;
      }
      if (j.status === "failed") throw new Error(j.error ?? "a narração falhou");
    }
    throw new Error("a narração demorou demais — tente de novo");
  };

  const generate = async () => {
    if (tab === "avatar" && !photo) return toast("Escolha a foto da pessoa", "bad");
    if (tab === "lipsync" && !video) return toast("Escolha o vídeo que vai receber a boca", "bad");
    if (speech === "audio" && !audio) return toast("Escolha a narração pronta", "bad");
    if (speech === "text" && tab === "avatar" && !text.trim()) return toast("Escreva o que a pessoa vai dizer", "bad");
    if (!target) return;
    if (target.locked) return toast(target.locked, "bad");
    try {
      const verb = tab === "avatar" ? "Gerar a pessoa falando" : "Sincronizar a boca";
      if (!await ask(`${verb} com ${target.name} (~${audioSec}s)?\nCusto ${usd(estimate)} — ${paid ? "COBRADO no cartão" : "sai da cota grátis"}.${speech === "text" && tab === "avatar" ? "\nA fala é gerada antes com a voz clonada (cota grátis do Seed Audio)." : ""}\n\nLembrete: só com autorização da pessoa.`, paid ? "Gerar e cobrar" : "Gerar")) return;
      let audioUrl = audio;
      if (tab === "avatar" && speech === "text") audioUrl = await narrate();
      if (!audioUrl) throw new Error("sem áudio");
      setBusy("Enviando…");
      const request =
        tab === "avatar"
          ? { kind: "avatar", model: target.id, imageUrl: photo!, audioUrl, prompt: prompt || undefined, resolution: res, audioSec }
          : { kind: "lipsync", model: target.id, videoUrl: video!, audioUrl, pro, videoSec: audioSec };
      await api<Job>("/generate", { method: "POST", body: JSON.stringify({ request, allowPaid: paid }) });
      setTick((t) => t + 1);
      toast("Na fila — leva 1 a 4 minutos", "ok");
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) toast(e.body?.voiceFreeMinutes ? `Cota grátis de voz quase no fim (${Math.round(e.body.voiceMinutesUsed)}/${e.body.voiceFreeMinutes} min)` : `Guarda de custo: ${usd(e.body.estimatedCostUsd)} acima do limite ${usd(e.body.maxJobCostUsd)}`, "bad");
      else toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const steps = [
    { n: 1, label: tab === "avatar" ? "Foto da pessoa" : "Vídeo pronto", ok: tab === "avatar" ? !!photo : !!video },
    { n: 2, label: "Voz e fala", ok: speech === "text" ? !!voice && text.trim().length > 1 : !!audio },
    { n: 3, label: "Gerar o vídeo", ok: false },
  ];

  return (
    <div className="create">
      <aside className="panel" aria-label="Clone">
        <div className="panel-tabs">
          <button className={`panel-tab ${tab === "avatar" ? "active" : ""}`} onClick={() => setTab("avatar")}>
            Pessoa falando
          </button>
          <button className={`panel-tab ${tab === "lipsync" ? "active" : ""}`} onClick={() => setTab("lipsync")}>
            Arrumar a boca
          </button>
        </div>

        <ol className="flow">
          {steps.map((s) => (
            <li key={s.n} className={s.ok ? "ok" : ""}>
              <span>{s.ok ? "✓" : s.n}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {tab === "avatar" ? (
          <>
            {model && <ModelCard model={toOption(model)} options={options.map(toOption)} onChange={(m) => setModelId(m.id)} />}
            {model?.locked && <div className="empty" style={{ padding: 10 }}>{model.locked}</div>}
            <ReferencePicker kind="image" label="1 · Foto da pessoa" value={photo} onChange={setPhoto} hint="rosto de frente, bem iluminado, sem óculos escuros — foto real ou gerada com a cara dela (Nano Banana 2.1 + referências)" />
          </>
        ) : (
          <>
            {lip && <ModelCard model={toOption(lip)} options={lipsyncs.map(toOption)} onChange={() => {}} />}
            {lip?.locked && <div className="empty" style={{ padding: 10 }}>{lip.locked}</div>}
            <ReferencePicker kind="video" label="1 · Vídeo pronto" value={video} onChange={setVideo} accept="video/*" hint="o vídeo da pessoa que vai receber a boca nova" />
          </>
        )}

        <div className="field">
          <label>2 · Voz e fala</label>
          <div className="seg" style={{ justifySelf: "start" }}>
            <button className={speech === "text" ? "active" : ""} onClick={() => setSpeech("text")} disabled={tab === "lipsync"}>
              Escrever o texto
            </button>
            <button className={speech === "audio" ? "active" : ""} onClick={() => setSpeech("audio")}>
              Narração pronta
            </button>
          </div>
        </div>
        {speech === "text" && tab === "avatar" ? (
          <>
            <div className="field">
              <label htmlFor="voice">Voz da pessoa</label>
              <select id="voice" className="select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">{voices.length ? "Escolha a voz clonada…" : "Nenhuma voz cadastrada ainda"}</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setNewVoice(true)}>
                + clonar a voz dela (10–30 s de áudio)
              </button>
            </div>
            <div className="field">
              <label htmlFor="say">O que ela vai dizer</label>
              <textarea id="say" className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} placeholder="Oi, eu sou a Carla. Hoje eu vou te mostrar como a minha aluna vendeu 300 peças na Shopee sem ter estoque…" />
              <span className="muted" style={{ fontSize: 11, justifySelf: "end" }}>
                {text.length}/1500 · ~{audioSec} s · fala gerada com {tts?.name ?? "Seed Audio"} (grátis)
              </span>
            </div>
          </>
        ) : (
          <ReferencePicker kind="audio" label="Narração pronta" value={audio} onChange={setAudio} accept="audio/*" hint="gerada em Áudio com a voz clonada, ou um áudio gravado pela própria pessoa" />
        )}

        {tab === "avatar" ? (
          <>
            <div className="field">
              <label htmlFor="cp">Direção (opcional)</label>
              <input id="cp" className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="fala olhando pra câmera, sorri no final, gestos leves com as mãos" />
            </div>
            <div className="opts">
              <div className="opt">
                <label>Qualidade</label>
                <select value={res} onChange={(e) => setRes(e.target.value as any)}>
                  {(model?.resolutions ?? ["720p", "1080p"]).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="opt" title="medida do áudio ou estimada do texto">
                <label>Duração</label>
                <input value={`~${audioSec} s`} readOnly />
              </div>
            </div>
          </>
        ) : (
          <div className="opts">
            <div className="opt">
              <label>Qualidade</label>
              <select value={pro ? "pro" : "std"} onChange={(e) => setPro(e.target.value === "pro")}>
                <option value="std">lipsync-2 (US$ 3/min)</option>
                <option value="pro">lipsync-2-pro (US$ 5/min)</option>
              </select>
            </div>
          </div>
        )}

        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
          💡 Boca fora de sincronia: use um modelo que anima pela voz real (OmniHuman ou Seedance 2.5). Rosto que muda no meio: revise e use só os trechos bons. Ainda não cadastrou a voz? Clone agora mesmo — leva 1 minuto.
        </div>
        <button className="btn primary gen" disabled={!!busy || !ready || !target || !!target.locked} onClick={generate}>
          {busy ?? (tab === "avatar" ? "3 · Gerar pessoa falando" : "3 · Sincronizar boca")} {!busy && target && <span className="cost">{usd(estimate)}</span>}
        </button>
      </aside>

      <History
        kind="clone"
        refreshKey={tick}
        title="Pessoas"
        before={
          <div className="hero-strip">
            <img src="/art/banner-clone.jpg" alt="" />
            <div className="txt">
              <div className="display">
                O expert em vídeo <em>sem gravar</em>
              </div>
              <p>Uma foto, a voz clonada e o texto. O estúdio gera a pessoa falando com a boca sincronizada — pra anúncio, aula e resposta de aluno.</p>
              <div className="chips">
                <span>{voices.length} voz(es) cadastrada(s)</span>
                <span>{options.filter((m) => !m.locked).length} de {options.length} modelos liberados</span>
                <Link href="/audio" className="btn ghost sm">
                  Vozes e narração ›
                </Link>
              </div>
            </div>
          </div>
        }
        empty={
          <div className="empty">
            <b>Nenhuma pessoa clonada ainda</b>
            Comece pela foto, escolha a voz clonada e escreva o que ela vai dizer. O vídeo aparece aqui em 1 a 4 minutos.
          </div>
        }
      />

      {newVoice && (
        <NewVoiceModal
          onClose={() => setNewVoice(false)}
          onCreated={(v) => {
            setNewVoice(false);
            loadVoices().then(() => setVoiceId(v.id));
          }}
        />
      )}
    </div>
  );
}
