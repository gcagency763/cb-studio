"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, fmtDate, isActive, isDone, uploadFile, usd, type Job } from "@/lib/api";
import { toOption, useModels, type CatalogModel } from "@/lib/models";
import { LibraryPicker, Modal, ModelPicker } from "@/components/create";
import { useConfirm, useToast } from "@/components/Toasts";

const SIZES: Record<string, string> = { "9:16": "1440x2560", "3:4": "1728x2304", "4:5": "1638x2048", "1:1": "2048x2048", "16:9": "2560x1440" };

/** edições rápidas com referência (Seedream edita a imagem de referência — cota grátis) */
const EDITS: { id: string; label: string; prompt: string; ratio?: string }[] = [
  { id: "white", label: "Fundo branco (produto)", prompt: "Keep the main subject exactly as in the reference image (same shape, colors, details, lighting on the subject). Remove the background completely and replace it with a clean pure white studio background with a soft natural contact shadow. E-commerce product photo." },
  { id: "newbg", label: "Trocar fundo por…", prompt: "Keep the main subject exactly as in the reference image. Replace only the background with: " },
  { id: "expand", label: "Expandir pra 16:9", prompt: "Extend the reference image to a wide 16:9 frame: keep everything in the original image identical and in the center, and continue the scene naturally to the left and right with matching style, lighting and perspective. No new subjects.", ratio: "16:9" },
  { id: "expand916", label: "Expandir pra 9:16", prompt: "Extend the reference image to a tall 9:16 frame: keep everything in the original image identical and centered, and continue the scene naturally above and below with matching style, lighting and perspective. No new subjects.", ratio: "9:16" },
  { id: "relight", label: "Nova luz (golden hour)", prompt: "Relight the reference image: same subject, same composition and same background, but with warm golden-hour sunlight from the left, soft long shadows, cinematic contrast. Keep every detail of the subject." },
  { id: "clean", label: "Limpar (tirar texto/objetos)", prompt: "Same image as the reference, but remove all text, watermarks, logos and distracting objects, filling the areas naturally. Keep the main subject and composition identical." },
  { id: "restyle", label: "Mesma cena, estilo G2 épico", prompt: "Recreate the reference image as an epic illustrated painting: golden light, dramatic skies, painterly brushwork, same subject and composition." },
];

export default function ImagePage() {
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const models = useModels("image");
  const upscalers = useModels("upscale");
  const [modelId, setModelId] = useState("seedream-4-5-251128");
  const model: CatalogModel | undefined = useMemo(() => models.find((m) => m.id === modelId) ?? models[0], [models, modelId]);
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [ratio, setRatio] = useState("9:16");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [lib, setLib] = useState(false);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [filter, setFilter] = useState<"all" | "today">("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => api<{ generated: Job[] }>("/library?kind=image").then((r) => alive && setJobs(r.generated)).catch(() => alive && setJobs([]));
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tick]);

  const paid = model?.provider === "fal";
  const request = () => ({ kind: "image", model: model?.id, prompt, size: SIZES[ratio], referenceImages: refs.length ? refs : undefined });
  const unit = model?.price.perImage ?? 0.04;

  const generate = async () => {
    if (!model) return;
    if (model.locked) return toast(model.locked, "bad");
    if (prompt.trim().length < 3) return toast("Descreva a imagem primeiro", "bad");
    setBusy(true);
    try {
      const { estimatedCostUsd } = await api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request: request() }) });
      const total = estimatedCostUsd * count;
      if (paid && !await ask(`Gerar ${count} imagem(ns) com ${model.name}?\nCusto ${usd(total)} — COBRADO no cartão (fal.ai).`, "Gerar e cobrar")) return;
      for (let i = 0; i < count; i++) await api<Job>("/generate", { method: "POST", body: JSON.stringify({ request: request(), allowPaid: paid }) });
      setTick((t) => t + 1);
      toast(`${count} imagem(ns) gerando — ${paid ? usd(total) + " no cartão" : "cota grátis"}`);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) toast(`Guarda de custo: ${usd(e.body.estimatedCostUsd)} acima do limite ${usd(e.body.maxJobCostUsd)}`, "bad");
      else toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  const upscale = async (j: Job) => {
    const up = upscalers[0];
    if (!up) return toast("Upscale não disponível", "bad");
    if (up.locked) return toast(up.locked, "bad");
    try {
      const req = { kind: "upscale", model: up.id, imageUrl: j.output_url!, factor: 2, inputMp: 3.7 };
      const { estimatedCostUsd } = await api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request: req }) });
      if (!await ask(`Melhorar (estilo Magnific, 2×) com ${up.name}?\nCusto ${usd(estimatedCostUsd)} — COBRADO no cartão (fal.ai).`, "Melhorar e cobrar")) return;
      await api<Job>("/generate", { method: "POST", body: JSON.stringify({ request: req, allowPaid: true }) });
      setTick((t) => t + 1);
      toast("Upscale na fila — ~1 minuto");
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const u = await uploadFile(f);
      setRefs((r) => [...r, u.url].slice(0, 10));
      toast(`${f.name} adicionada como referência`);
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const shown = (jobs ?? []).filter((j) => filter === "all" || (j.created_at && new Date(j.created_at).toDateString() === new Date().toDateString()));

  return (
    <div className="studio">
      <div className="studio-top">
        <h1>Imagem</h1>
        <div className="tabs2">
          <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>
            Tudo
          </button>
          <button className={filter === "today" ? "active" : ""} onClick={() => setFilter("today")}>
            Hoje
          </button>
        </div>
      </div>

      {!jobs ? (
        <div className="muted" style={{ padding: 24 }}>Carregando…</div>
      ) : shown.length === 0 ? (
        <div className="howto">
          <h2>
            Crie imagens em <span style={{ color: "var(--coral)" }}>um clique</span>
          </h2>
          <p>Descreva a cena embaixo, escolha o modelo (Seedream grátis; GPT Image e Nano Banana quando liberar a fal.ai) e a proporção. Pra manter o mesmo personagem, adicione a ficha dele como referência com o “+”.</p>
          <div className="steps">
            <div className="step">
              <div className="box"><img src="/art/step-escreva.jpg" alt="" /></div>
              <b>Descreva a cena</b>
              <span>Sujeito, cenário, luz, estilo. Em inglês fica melhor; o roteirista do Quadrinhos já faz isso por você.</span>
            </div>
            <div className="step">
              <div className="box"><img src="/art/style-epic.jpg" alt="" /></div>
              <b>Referência</b>
              <span>Ficha do personagem ou foto real (Nano Banana 2.1 aceita até 14) — sem ela, sai outra pessoa.</span>
            </div>
            <div className="step">
              <div className="box"><img src="/art/step-video.jpg" alt="" /></div>
              <b>Anime</b>
              <span>Passe o mouse na imagem e clique em “Animar” — vira o primeiro frame do vídeo.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="gallery">
          {shown.map((j) => (
            <div key={j.id} className={`tile ${isActive(j) ? "pending" : j.status === "failed" ? "failed" : ""}`} onClick={() => isDone(j) && setSelected(j)} role="button" tabIndex={0}>
              {isDone(j) ? <img src={j.output_url!} alt="" loading="lazy" onError={(e) => { const t = e.currentTarget.closest(".tile") as HTMLElement | null; if (t) t.style.display = "none"; }} /> : isActive(j) ? <span className="stage"><span className="status-dot run" /> {j.status === "queued" ? "na fila" : "gerando"}</span> : <span style={{ padding: 10 }}>{j.error?.slice(0, 120)}</span>}
              {isDone(j) && (
                <>
                  <div className="acts" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => router.push(`/video?frame=${encodeURIComponent(j.output_url!)}`)}>Animar</button>
                    <button onClick={() => setRefs((r) => [...r, j.output_url!].slice(0, 10))}>@ ref</button>
                    <button onClick={() => upscale(j)} title={upscalers[0]?.locked ?? "aumenta resolução e detalhe"}>
                      Melhorar
                    </button>
                  </div>
                  <div className="over">
                    <span>{j.request?.model ? models.find((m) => m.id === j.request.model)?.name ?? j.request.model : "Seedream"}</span>
                    <span>{fmtDate(j.created_at)}</span>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* composer flutuante */}
      <div className="composer">
        <textarea
          rows={1}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Descreva a cena que você imagina"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
          }}
        />
        {!prompt && (
          <div className="starters" style={{ gridColumn: 1 }}>
            {[
              "Painterly epic illustration: a Brazilian woman packing Shopee orders at home at dawn, warm light, vertical",
              "Character sheet, 3 views, same outfit: 38-year-old Brazilian man, navy polo, short curly hair",
              "Comic book cover, bold ink: phone showing sales notifications, dramatic lighting",
            ].map((t) => (
              <button key={t} type="button" onClick={() => setPrompt(t)}>
                {t.slice(0, 48)}…
              </button>
            ))}
          </div>
        )}
        <div className="chips">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="chipb icon" title="Adicionar referência (upload)" onClick={() => fileRef.current?.click()}>
            +
          </button>
          <button className="chipb icon" title="Referência da biblioteca" onClick={() => setLib(true)}>
            @
          </button>
          {refs.map((r, i) => (
            <button key={r + i} className="chipb" title="remover referência" onClick={() => setRefs((x) => x.filter((_, k) => k !== i))}>
              <img className="thumb" src={r} alt="" /> ×
            </button>
          ))}
          {refs.length > 0 && (
            <label className="chipb" title="preenche o prompt com uma edição pronta da referência (Seedream, cota grátis)">
              <span className="k">Editar</span>
              <select
                value=""
                onChange={(e) => {
                  const ed = EDITS.find((x) => x.id === e.target.value);
                  if (!ed) return;
                  setPrompt(ed.prompt);
                  if (ed.ratio) setRatio(ed.ratio);
                }}
              >
                <option value="">escolher…</option>
                {EDITS.map((ed) => (
                  <option key={ed.id} value={ed.id}>
                    {ed.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className={`chipb ${paid ? "paid" : ""}`} onClick={() => setPick(true)} title={model?.locked ?? model?.note}>
            <span className="k">Modelo</span> {model?.name ?? "…"} ›
          </button>
          <label className="chipb">
            <span className="k">Proporção</span>
            <select value={ratio} onChange={(e) => setRatio(e.target.value)}>
              {Object.keys(SIZES).map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <span className="chipb">
            <span className="k">Qtd</span>
            <span className="stepper">
              <button onClick={() => setCount((c) => Math.max(1, c - 1))}>−</button>
              {count}
              <button onClick={() => setCount((c) => Math.min(4, c + 1))}>+</button>
            </span>
          </span>
          {!paid && <span className="chipb" style={{ color: "var(--ok)" }}>✦ cota grátis</span>}
        </div>
        <button className="gen-btn" disabled={busy || !model || !!model.locked} onClick={generate}>
          {busy ? "Enviando…" : "Gerar"}
          <small>
            ✦ {usd(unit * count)}
            {paid ? " · cobra" : " · grátis"}
          </small>
        </button>
      </div>

      {pick && model && <ModelPicker current={model.id} options={models.map(toOption)} onClose={() => setPick(false)} onPick={(m) => setModelId(m.id)} />}
      {lib && (
        <LibraryPicker
          kind="image"
          onClose={() => setLib(false)}
          onPick={(url) => {
            setRefs((r) => [...r, url].slice(0, 10));
            setLib(false);
          }}
        />
      )}
      {selected && (
        <Modal title="Imagem" onClose={() => setSelected(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 16 }}>
            <div style={{ background: "#000", borderRadius: 10, overflow: "hidden", display: "grid", placeItems: "center", minHeight: 200 }}>
              <img src={selected.output_url!} alt="" style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain" }} />
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div className="muted" style={{ fontSize: 12 }}>
                {fmtDate(selected.created_at)} · {usd(selected.estimated_cost_usd)}
              </div>
              {selected.request?.prompt && <div style={{ fontSize: 13, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{selected.request.prompt}</div>}
              <button className="btn primary" onClick={() => router.push(`/video?frame=${encodeURIComponent(selected.output_url!)}`)}>
                Animar esta imagem
              </button>
              <button className="btn" onClick={() => setPrompt(selected.request?.prompt ?? prompt)}>
                Reusar prompt
              </button>
              <button className="btn" onClick={() => { setRefs((r) => [...r, selected.output_url!].slice(0, 10)); setSelected(null); }}>
                Usar como referência
              </button>
              <button className="btn" onClick={() => upscale(selected)}>
                Melhorar (Magnific)
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
