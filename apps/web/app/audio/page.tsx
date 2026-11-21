"use client";

import { useEffect, useState } from "react";
import { ApiError, api, fmtDate, usd, type Job, type Voice } from "@/lib/api";
import { History, ModelCard } from "@/components/create";
import { NewVoiceModal } from "@/components/NewVoiceModal";
import { useConfirm, useToast } from "@/components/Toasts";
import { toOption, useModels, type CatalogModel } from "@/lib/models";

export default function AudioPage() {
  const toast = useToast();
  const ask = useConfirm();
  const [tab, setTab] = useState<"tts" | "voices" | "sfx">("tts");
  const models = useModels("audio");
  const sfxModels = useModels("sfx");
  const [modelId, setModelId] = useState("seed-audio-1.0");
  const model: CatalogModel | undefined = models.find((m) => m.id === modelId) ?? models[0];
  const paid = model?.provider === "elevenlabs";
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState<string>("");
  const [text, setText] = useState("");
  const [style, setStyle] = useState("");
  const [rate, setRate] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [newVoice, setNewVoice] = useState(false);

  const loadVoices = () => api<{ voices: Voice[] }>("/voices").then((r) => setVoices(r.voices)).catch(() => {});
  useEffect(() => {
    loadVoices();
  }, []);

  const voice = voices.find((v) => v.id === voiceId) ?? null;
  const request = () => ({
    kind: "audio",
    model: model?.id,
    text,
    voiceRef: voice ? { audioUrl: voice.reference_url } : undefined,
    style: style || undefined,
    speechRate: rate,
    format: "mp3",
    subtitles: true,
  });

  const generate = async () => {
    if (text.trim().length < 2) return toast("Escreve o texto primeiro", "bad");
    setBusy(true);
    try {
      const { estimatedCostUsd } = await api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request: request() }) });
      if (!await ask(`Gerar narração com ${model?.name}${voice ? ` e a voz "${voice.name}"` : ""}?\nCusto ${usd(estimatedCostUsd)} — ${paid ? "COBRADO (conta ElevenLabs)" : "sai dos 60 min grátis (cartão US$ 0)"}.`, paid ? "Gerar e cobrar" : "Gerar")) return;
      await api<Job>("/generate", { method: "POST", body: JSON.stringify({ request: request(), allowPaid: paid }) });
      setTick((t) => t + 1);
      toast("Narração na fila — alguns segundos");
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) toast(`Guarda de custo: ${usd(e.body.estimatedCostUsd)}`, "bad");
      else toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create">
      <aside className="panel" aria-label="Áudio">
        <div className="panel-tabs">
          <button className={`panel-tab ${tab === "tts" ? "active" : ""}`} onClick={() => setTab("tts")}>
            Texto → fala
          </button>
          <button className={`panel-tab ${tab === "voices" ? "active" : ""}`} onClick={() => setTab("voices")}>
            Vozes ({voices.length})
          </button>
          <button className={`panel-tab ${tab === "sfx" ? "active" : ""}`} onClick={() => setTab("sfx")}>
            Efeito sonoro
          </button>
        </div>

        {tab === "tts" ? (
          <>
            {model && <ModelCard model={toOption(model)} options={models.map(toOption)} onChange={(m) => setModelId(m.id)} />}
            {model?.locked && <div className="empty" style={{ padding: 10 }}>{model.locked}</div>}
            {model?.tip && <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>💡 {model.tip}</div>}
            <div className="field">
              <label htmlFor="voice">Voz</label>
              <select id="voice" className="select" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                <option value="">Voz padrão (descreva no estilo)</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setNewVoice(true)}>
                + nova voz (clonar)
              </button>
            </div>
            <div className="field">
              <label htmlFor="text">Texto da narração</label>
              <textarea id="text" className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Era uma vez um cara que trabalhava 12 horas por dia e mal pagava as contas…" maxLength={3000} />
              <span className="muted" style={{ fontSize: 11, justifySelf: "end" }}>
                {text.length}/3000 · ~{Math.round(text.length / 15)} s
              </span>
            </div>
            <div className="field">
              <label htmlFor="style">Estilo (opcional)</label>
              <input id="style" className="input" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Ex.: voz masculina calma, ritmo de narrador de documentário, leve sotaque mineiro" />
            </div>
            <div className="opts">
              <div className="opt">
                <label>Velocidade</label>
                <select value={rate} onChange={(e) => setRate(+e.target.value)}>
                  <option value={-20}>mais lenta</option>
                  <option value={0}>normal</option>
                  <option value={20}>mais rápida</option>
                  <option value={40}>bem rápida</option>
                </select>
              </div>
              <div className="opt" title="timestamps por frase e palavra para legenda sincronizada">
                <label>Legenda sincronizada</label>
                <input value="sim" readOnly />
              </div>
            </div>
            <button className="btn primary gen" disabled={busy || !model || !!model.locked} onClick={generate}>
              {busy ? "Enviando…" : paid ? "Gerar (cobra)" : "Gerar narração"} <span className="cost">{usd((Math.max(2, text.length / 15) / 60) * (model?.price.perMin ?? 0.15))}</span>
            </button>
          </>
        ) : tab === "voices" ? (
          <VoicesPanel voices={voices} onNew={() => setNewVoice(true)} onDeleted={loadVoices} />
        ) : (
          <SfxPanel model={sfxModels[0]} onQueued={() => setTick((t) => t + 1)} />
        )}
      </aside>

      <History kind="audio" refreshKey={tick} />

      {newVoice && (
        <NewVoiceModal
          onClose={() => setNewVoice(false)}
          onCreated={(v) => {
            setNewVoice(false);
            loadVoices().then(() => setVoiceId(v.id));
            setTab("tts");
          }}
        />
      )}
    </div>
  );
}

function SfxPanel({ model, onQueued }: { model?: CatalogModel; onQueued: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [prompt, setPrompt] = useState("");
  const [dur, setDur] = useState(5);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    if (!model) return toast("Efeito sonoro indisponível", "bad");
    if (model.locked) return toast(model.locked, "bad");
    if (prompt.trim().length < 3) return toast("Descreva o som", "bad");
    setBusy(true);
    try {
      const req = { kind: "sfx", model: model.id, prompt, durationSec: dur };
      const { estimatedCostUsd } = await api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request: req }) });
      if (!await ask(`Gerar efeito sonoro de ${dur}s?\nCusto ${usd(estimatedCostUsd)} — COBRADO (conta ElevenLabs).`, "Gerar e cobrar")) return;
      await api<Job>("/generate", { method: "POST", body: JSON.stringify({ request: req, allowPaid: true }) });
      onQueued();
      toast("Efeito na fila — alguns segundos");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {model && <div className="model-card" style={{ cursor: "default" }}><span className="k">Modelo</span><span className="v">{model.name}</span><span className="badges">{model.badges.map((b) => <span key={b.text} className={`badge ${b.tone ?? ""}`}>{b.text}</span>)}</span></div>}
      {model?.locked && <div className="empty" style={{ padding: 10 }}>{model.locked}</div>}
      <div className="field">
        <label htmlFor="sfx">Descreva o som (foley)</label>
        <textarea id="sfx" className="textarea" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: zíper de mochila fechando rápido, quarto silencioso, sem música" />
      </div>
      <div className="opts">
        <div className="opt">
          <label>Duração</label>
          <select value={dur} onChange={(e) => setDur(+e.target.value)}>
            {[1, 2, 3, 5, 8, 10, 15].map((n) => (
              <option key={n} value={n}>
                {n} s
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11.5 }}>💡 {model?.note}</div>
      <button className="btn primary gen" disabled={busy || !model || !!model.locked} onClick={gen}>
        {busy ? "Enviando…" : "Gerar efeito (cobra)"} <span className="cost">{usd(0.05)}</span>
      </button>
    </>
  );
}

function VoicesPanel({ voices, onNew, onDeleted }: { voices: Voice[]; onNew: () => void; onDeleted: () => void }) {
  const toast = useToast();
  const ask = useConfirm();
  const remove = async (v: Voice) => {
    if (!await ask(`Apagar a voz "${v.name}"?`)) return;
    await api(`/voices/${v.id}`, { method: "DELETE" });
    toast("Voz apagada");
    onDeleted();
  };
  return (
    <>
      <button className="btn primary" onClick={onNew}>
        + Nova voz (clonar)
      </button>
      {voices.length === 0 ? (
        <div className="empty">
          <b>Nenhuma voz salva</b>
          Envie 10–30 s de áudio limpo da pessoa, com a autorização dela, e a voz fica disponível em todos os projetos.
        </div>
      ) : (
        <div className="list">
          {voices.map((v) => (
            <div key={v.id} className="list-item" style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b style={{ fontSize: 13 }}>{v.name}</b>
                <button className="btn ghost sm" onClick={() => remove(v)}>
                  Apagar
                </button>
              </div>
              <audio className="player" src={v.reference_url} controls preload="none" />
              <span className="muted" style={{ fontSize: 11 }}>
                Autorizada por {v.consent_name} em {fmtDate(v.consent_at ?? undefined)}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
