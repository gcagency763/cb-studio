"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, isActive, isDone, usd, type Job, type Project, type Scene, type Voice, type Review } from "@/lib/api";
import { useConfirm, useToast } from "@/components/Toasts";
import { PublishButton } from "@/components/Publish";
import { Modal, ReferencePicker } from "@/components/create";
import { CaptionPreview, CardPreview } from "@/components/CaptionPreview";
import { useModels, type CatalogModel, type Res } from "@/lib/models";

/* ───────────────────────── opções de motor ───────────────────────── */
type VideoOpt = { id: string; model: CatalogModel; resolution: Res; label: string; short: string; locked?: string; per5: number };
function videoOptions(models: CatalogModel[]): VideoOpt[] {
  const out: VideoOpt[] = [];
  for (const m of models) {
    for (const r of m.resolutions ?? ["720p"]) {
      const per = m.price.perSec?.[r] ?? m.price.perSec?.["1080p"] ?? 0;
      const tag = m.locked ? (m.gate === "reserve" ? "reserva US$ 30" : m.gate === "fal" ? "fal.ai, pago" : "travado") : m.free ? "grátis" : "pago";
      out.push({ id: `${m.id}:${r}`, model: m, resolution: r, label: `${m.name} · ${r} · ${usd(per * 5)}/5 s (${tag})`, short: `${m.name} ${r}`, locked: m.locked, per5: per * 5 });
    }
  }
  return out;
}
// padrão: MiniMax H3 quando a fal estiver ligada; senão o Seedance da cota grátis
const DEFAULT_VIDEO = "seedance-1-0-pro-fast-251015:720p";
const DEFAULT_H3 = "minimax-h3:720p";
const parseVideoModel = (v: string | null | undefined, opts: VideoOpt[]) =>
  opts.find((o) => o.id === v) ?? opts.find((o) => o.id === DEFAULT_H3 && !o.locked) ?? opts.find((o) => o.id === DEFAULT_VIDEO) ?? opts[0];

const IMAGE_REQ = (prompt: string) => ({ kind: "image", prompt, size: "1440x2560" });
const VIDEO_REQ = (prompt: string, firstFrame: string, durationSec: number, opt: VideoOpt | undefined) => ({
  kind: "video",
  model: opt?.model.id,
  prompt,
  firstFrame,
  ratio: "9:16",
  resolution: opt?.resolution ?? "720p",
  durationSec: Math.min(durationSec, Math.max(...(opt?.model.durations ?? [10]))),
  audio: opt?.model.nativeAudio ? false : undefined,
});
const AUDIO_REQ = (text: string, voice: Voice | null) => ({
  kind: "audio",
  text,
  voiceRef: voice ? { audioUrl: voice.reference_url } : undefined,
  format: "wav",
  subtitles: true,
});

type Kind = "image" | "video" | "audio";
const KIND_LABEL: Record<Kind, string> = { image: "imagem", video: "vídeo", audio: "narração" };
const STYLES = [
  { id: "epic", label: "Épico ilustrado" },
  { id: "comic", label: "Quadrinhos" },
  { id: "anime", label: "Anime" },
  { id: "cinematic", label: "Cinemático" },
  { id: "flat", label: "Flat / Motion" },
];

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const ask = useConfirm();
  const [project, setProject] = useState<Project | null>(null);
  const videoModels = useModels("video");
  const vopts = useMemo(() => videoOptions(videoModels), [videoModels]);
  const vopt = useMemo(() => parseVideoModel(project?.video_model, vopts), [project?.video_model, vopts]);
  const paidVideo = !!vopt && (vopt.model.provider === "fal" || vopt.model.provider === "gpu" || vopt.model.gate === "reserve");
  const [selected, setSelected] = useState<string | "final" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [theme, setTheme] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [settings, setSettings] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [scriptOpen, setScriptOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const p = await api<Project>(`/projects/${id}`);
    setProject(p);
    setTheme((t) => t || p.theme || "");
    setSelected((s) => s ?? p.scenes[0]?.id ?? null);
    return p;
  }, [id]);

  useEffect(() => {
    load().catch((e) => {
      toast(e.message, "bad");
      router.push("/projects");
    });
    api<{ voices: Voice[] }>("/voices").then((r) => setVoices(r.voices)).catch(() => {});
  }, [load, router, toast]);

  const anyActive = !!project && (project.scenes.some((s) => isActive(s.image_job) || isActive(s.video_job) || isActive(s.audio_job)) || isActive(project.render_job));
  useEffect(() => {
    if (!anyActive) return;
    const t = setInterval(() => load().catch(() => {}), 3500);
    return () => clearInterval(t);
  }, [anyActive, load]);

  /* ───── edição ───── */
  const patchScene = (sceneId: string, patch: Partial<Scene>) => {
    setProject((p) => (p ? { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) } : p));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveScenes, 700);
  };
  const sceneRows = (p: Project) => p.scenes.map((s) => ({ id: s.id, script: s.script, image_prompt: s.image_prompt, motion_prompt: s.motion_prompt, duration_sec: s.duration_sec ?? 5, type: s.type, card: s.card }));
  const saveScenes = () =>
    setProject((p) => {
      if (p) api(`/projects/${p.id}/scenes`, { method: "PUT", body: JSON.stringify({ scenes: sceneRows(p) }) }).catch((e) => toast(`Não salvou: ${e.message}`, "bad"));
      return p;
    });
  const addScene = async (afterId?: string) => {
    if (!project) return;
    const rows = sceneRows(project);
    const blank = { script: "", image_prompt: "", motion_prompt: "", duration_sec: 5, type: "video" as const, card: null };
    const idx = afterId ? rows.findIndex((r) => r.id === afterId) + 1 : rows.length;
    rows.splice(idx, 0, blank as any);
    const p = await api<Project>(`/projects/${project.id}/scenes`, { method: "PUT", body: JSON.stringify({ scenes: rows }) });
    setProject(p);
    setSelected(p.scenes[idx]?.id ?? null);
  };
  const removeScene = async (sceneId: string) => {
    if (!project || !await ask("Remover esta cena?")) return;
    const p = await api<Project>(`/projects/${project.id}/scenes`, { method: "PUT", body: JSON.stringify({ scenes: sceneRows(project).filter((s) => s.id !== sceneId) }) });
    setProject(p);
    setSelected(p.scenes[0]?.id ?? null);
  };
  const moveScene = async (sceneId: string, dir: -1 | 1) => {
    if (!project) return;
    const rows = sceneRows(project);
    const i = rows.findIndex((r) => r.id === sceneId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    const p = await api<Project>(`/projects/${project.id}/scenes`, { method: "PUT", body: JSON.stringify({ scenes: rows }) });
    setProject(p);
  };
  const patchProject = async (patch: Partial<Project>) => {
    if (!project) return;
    setProject({ ...project, ...patch });
    await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch((e) => toast(e.message, "bad"));
  };
  const setVoice = async (voice_id: string) => {
    if (!project) return;
    const v = voices.find((x) => x.id === voice_id) ?? null;
    setProject({ ...project, voice_id: v?.id ?? null, voice: v });
    await api(`/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ voice_id: v?.id ?? null }) }).catch(() => {});
  };

  /* ───── roteiro ───── */
  const writeScript = async () => {
    if (!project || theme.trim().length < 4) return;
    if (project.scenes.length && !await ask("Isso substitui as cenas atuais pelo novo roteiro. Continuar?")) return;
    setBusy("script");
    try {
      const p = await api<Project>("/script", { method: "POST", body: JSON.stringify({ projectId: project.id, theme: theme.trim(), scenes: Math.max(3, project.scenes.filter((s) => s.type !== "card").length || 8), style: project.style ?? "epic" }) });
      setProject(p);
      setSelected(p.scenes[0]?.id ?? null);
      setScriptOpen(false);
      toast(`Roteiro pronto: ${p.scenes.length} cenas`, "ok");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  /* ───── geração ───── */
  const estimate = async (request: any) => (await api<{ estimatedCostUsd: number }>("/estimate", { method: "POST", body: JSON.stringify({ request }) })).estimatedCostUsd;
  const reqFor = (s: Scene, kind: Kind) => (kind === "image" ? IMAGE_REQ(s.image_prompt ?? "") : kind === "video" ? VIDEO_REQ(s.motion_prompt ?? "", s.image_job?.output_url ?? "", s.duration_sec ?? 5, vopt) : AUDIO_REQ(s.script ?? "", project?.voice ?? null));
  const canGen = (s: Scene, kind: Kind) => (kind === "image" ? !!(s.image_prompt ?? "").trim() : kind === "video" ? isDone(s.image_job) && !!(s.motion_prompt ?? "").trim() : !!(s.script ?? "").trim());
  const localCost = (s: Scene, kind: Kind) => (kind === "image" ? 0.04 : kind === "video" ? (vopt?.per5 ?? 0.11) * ((s.duration_sec ?? 5) / 5) : (Math.max(2, (s.script ?? "").length / 15) / 60) * 0.15);

  const generate = async (scene: Scene, kind: Kind, opts: { confirmEach?: boolean } = { confirmEach: true }) => {
    if (!project) return;
    if (!canGen(scene, kind)) return toast(kind === "video" && !isDone(scene.image_job) ? "Gera a imagem antes do vídeo" : `Escreve o ${kind === "image" ? "prompt da imagem" : kind === "video" ? "prompt do movimento" : "texto da narração"} primeiro`, "bad");
    try {
      const paid = kind === "video" && paidVideo;
      if (opts.confirmEach && paid) {
        const cost = await estimate(reqFor(scene, kind));
        if (!await ask(`Gerar ${KIND_LABEL[kind]} da cena ${scene.position + 1} com ${vopt?.short}?\nCusto ${usd(cost)} — COBRADO no cartão.`, "Gerar e cobrar")) return;
      }
      await api<Job>("/generate", { method: "POST", body: JSON.stringify({ projectId: project.id, sceneId: scene.id, request: reqFor(scene, kind), allowPaid: paid }) });
      await load();
      if (opts.confirmEach) toast(`${KIND_LABEL[kind]} da cena ${scene.position + 1} gerando`);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 402) toast(`Bloqueado pela guarda de custo: ${usd(e.body.estimatedCostUsd)} acima do limite ${usd(e.body.maxJobCostUsd)}`, "bad");
      else toast(e.message, "bad");
    }
  };

  const isCard = (s: Scene) => s.type === "card";
  const pending = useMemo(
    () => ({
      image: project?.scenes.filter((s) => !isCard(s) && (s.image_prompt ?? "").trim() && !isDone(s.image_job) && !isActive(s.image_job)) ?? [],
      video: project?.scenes.filter((s) => !isCard(s) && isDone(s.image_job) && (s.motion_prompt ?? "").trim() && !isDone(s.video_job) && !isActive(s.video_job)) ?? [],
      audio: project?.scenes.filter((s) => (s.script ?? "").trim() && !isDone(s.audio_job) && !isActive(s.audio_job)) ?? [],
    }),
    [project],
  );
  const readyVideos = useMemo(() => project?.scenes.filter((s) => (isCard(s) ? !!s.card?.text : isDone(s.video_job))) ?? [], [project]);
  // vídeos feitos em outro motor/resolução que o escolhido agora (ex.: rascunho 480p → final 720p)
  const upgradable = useMemo(
    () => project?.scenes.filter((s) => !isCard(s) && isDone(s.video_job) && vopt && s.video_job!.request?.kind !== "still" && (s.video_job!.request?.resolution !== vopt.resolution || s.video_job!.request?.model !== vopt.model.id) && isDone(s.image_job) && (s.motion_prompt ?? "").trim()) ?? [],
    [project, vopt],
  );
  const upgradeAll = async () => {
    if (!project || !vopt || !upgradable.length) return;
    setBusy("video");
    try {
      const est = await api<{ totalUsd: number; paid: boolean; model: string }>(`/projects/${project.id}/estimate`, { method: "POST", body: JSON.stringify({ kind: "video", mode: "upgrade" }) });
      if (!await ask(`Refazer ${upgradable.length} vídeo(s) em ${vopt.short}?\nCusto ${usd(est.totalUsd)} — ${est.paid ? "COBRADO no cartão" : "sai da cota grátis (cartão US$ 0)"}.`, est.paid ? "Refazer e cobrar" : "Refazer")) return;
      await api(`/projects/${project.id}/generate`, { method: "POST", body: JSON.stringify({ kind: "video", mode: "upgrade", allowPaid: est.paid }) });
      toast(`${upgradable.length} vídeo(s) refazendo em ${vopt.resolution}`, "ok");
      await load();
    } catch (e: any) {
      toast(e instanceof ApiError && e.status === 402 ? `Trava de custo: ${usd(e.body?.estimatedCostUsd)}` : e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  const videoScenes = useMemo(() => project?.scenes.filter((s) => !isCard(s)) ?? [], [project]);

  const generateAll = async (kind: Kind) => {
    const list = pending[kind];
    if (!list.length || !project) return;
    setBusy(kind);
    try {
      const paid = kind === "video" && paidVideo;
      const total = list.reduce((a, s) => a + localCost(s, kind), 0);
      const label = kind === "image" ? "imagens" : kind === "video" ? "vídeos" : "narrações";
      if (!await ask(`Gerar ${list.length} ${label}${kind === "video" && vopt ? ` com ${vopt.short}` : ""}${kind === "audio" && project.voice ? ` com a voz "${project.voice.name}"` : ""}?\nCusto ${usd(total)} — ${paid ? "COBRADO no cartão" : "sai da cota grátis (cartão US$ 0)"}.`, paid ? "Gerar e cobrar" : "Gerar")) return;
      for (const s of list) await generate(s, kind, { confirmEach: false });
      toast(`${list.length} ${label} gerando`);
    } finally {
      setBusy(null);
    }
  };

  const renderFinal = async () => {
    if (!project || !readyVideos.length) return;
    setBusy("render");
    try {
      // o servidor monta o pedido (mesma lógica do MCP): cards, legenda, planos extras, corte de silêncio
      await api(`/projects/${project.id}/render`, { method: "POST", body: "{}" });
      toast("Montando o vídeo final — ~1 minuto");
      setSelected("final");
      await load();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };

  const removeProject = async () => {
    if (!project || !await ask(`Apagar o projeto "${project.title}"? Isso não tem volta.`)) return;
    await api(`/projects/${project.id}`, { method: "DELETE" });
    router.push("/projects");
  };

  /* ───── atalhos: ↑/↓ troca cena ───── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !project) return;
      const ids = project.scenes.map((s) => s.id);
      const i = ids.indexOf(selected as string);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") setSelected(ids[Math.min(ids.length - 1, i + 1)] ?? selected);
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") setSelected(ids[Math.max(0, i - 1)] ?? selected);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, selected]);

  if (!project) return <div className="page-pad muted">Carregando…</div>;
  const sel = selected === "final" ? null : project.scenes.find((s) => s.id === selected) ?? null;
  const render = project.render_job;
  const missing = pending.image.length + pending.video.length + pending.audio.length;

  return (
    <div className="desk">
      {/* ───── topo ───── */}
      <header className="desk-top">
        <div className="desk-title">
          <Link href="/projects" className="icon-btn" aria-label="Voltar" title="Quadrinhos">
            ‹
          </Link>
          <input className="title-input" value={project.title} onChange={(e) => setProject({ ...project, title: e.target.value })} onBlur={(e) => patchProject({ title: e.target.value.trim() || project.title })} aria-label="Título do projeto" />
          <span className="muted desk-meta">
            {videoScenes.length} cenas · {project.scenes.length - videoScenes.length} cards · {readyVideos.length}/{project.scenes.length} prontas
          </span>
        </div>
        <div className="desk-actions">
          <button className="chipb" onClick={() => setScriptOpen(true)} title="tema, estilo e reescrever roteiro">
            <span className="k">Roteiro</span> {STYLES.find((s) => s.id === project.style)?.label ?? "Épico"}
          </button>
          <label className="chipb" title="voz da narração">
            <span className="k">Voz</span>
            <select value={project.voice_id ?? ""} onChange={(e) => setVoice(e.target.value)}>
              <option value="">padrão</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className={`chipb ${paidVideo ? "paid" : ""}`} title={vopt?.model.tip ?? "motor de vídeo"}>
            <span className="k">Motor</span>
            <select value={vopt?.id ?? DEFAULT_VIDEO} onChange={(e) => patchProject({ video_model: e.target.value })}>
              {vopts.map((o) => (
                <option key={o.id} value={o.id} disabled={!!o.locked}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button className="chipb" onClick={() => setSettings(true)} title="legenda, caixa, trilha">
            <span className="k">Legenda</span> {project.caption_style === "sentence" ? "frase" : "karaokê"}
            {project.music_url ? " · ♪" : ""}
          </button>
          <button
            className={`chipb ${project.review ? "" : "ghosty"}`}
            title="nota de viralidade do roteiro: gancho, ritmo, clareza e CTA (Seed 2.1, grátis)"
            disabled={reviewing}
            onClick={async () => {
              if (project.review) return setReviewOpen(true);
              setReviewing(true);
              try {
                const r = await api<{ review: Review }>("/review", { method: "POST", body: JSON.stringify({ projectId: project.id }) });
                setProject({ ...project, review: r.review });
                setReviewOpen(true);
              } catch (e: any) {
                toast(e.message, "bad");
              } finally {
                setReviewing(false);
              }
            }}
          >
            <span className="k">Nota</span> {reviewing ? "avaliando…" : project.review ? `${project.review.score}/10` : "avaliar ✦"}
          </button>
          {missing > 0 && (
            <div className="chipb" style={{ gap: 4 }}>
              <span className="k">Gerar</span>
              {pending.image.length > 0 && (
                <button className="mini" disabled={busy !== null} onClick={() => generateAll("image")}>
                  {pending.image.length} img
                </button>
              )}
              {pending.audio.length > 0 && (
                <button className="mini" disabled={busy !== null} onClick={() => generateAll("audio")}>
                  {pending.audio.length} voz
                </button>
              )}
              {pending.video.length > 0 && (
                <button className="mini" disabled={busy !== null} onClick={() => generateAll("video")}>
                  {pending.video.length} vídeo
                </button>
              )}
            </div>
          )}
          {upgradable.length > 0 && vopt && (
            <button className="chipb" disabled={busy !== null} onClick={upgradeAll} title={`esses vídeos foram feitos em outro motor/resolução; refaz em ${vopt.short} (rascunho 480p → final)`}>
              <span className="k">Refazer</span> {upgradable.length} em {vopt.resolution}
            </button>
          )}
          <button className="btn primary" disabled={!readyVideos.length || busy !== null || isActive(render)} onClick={renderFinal}>
            {isActive(render) ? "Montando…" : `Montar vídeo final ✦ ${readyVideos.length}`}
          </button>
        </div>
      </header>

      <div className="desk-body">
        {/* ───── cenas ───── */}
        <aside className="scenes" aria-label="Cenas">
          {(isDone(render) || isActive(render)) && (
            <button className={`scene final ${selected === "final" ? "active" : ""}`} onClick={() => setSelected("final")}>
              <div className="sc-thumb">{isDone(render) ? <video src={render!.output_url!} muted playsInline preload="metadata" poster={project.scenes.find((x) => isDone(x.image_job))?.image_job?.output_url ?? undefined} /> : <span className="stage"><span className="status-dot run" /> montando</span>}</div>
              <div className="sc-text">
                <b>Vídeo final</b>
                <span>{isDone(render) ? `${Math.round(render!.usage?.durationSec ?? 0)} s · pronto pra baixar` : "montando com FFmpeg…"}</span>
              </div>
            </button>
          )}
          {project.scenes.map((s, i) => (
            <button key={s.id} className={`scene ${selected === s.id ? "active" : ""}`} onClick={() => setSelected(s.id)} aria-label={`Cena ${i + 1}`}>
              <div className={`sc-thumb ${isCard(s) ? "card" : ""}`}>
                {isCard(s) ? <b>{s.card?.text?.slice(0, 14) || "CARD"}</b> : isDone(s.video_job) ? <video src={s.video_job!.output_url!} muted playsInline preload="metadata" poster={isDone(s.image_job) ? s.image_job!.output_url! : undefined} /> : isDone(s.image_job) ? <img src={s.image_job!.output_url!} alt="" /> : <span className="sc-empty">{isActive(s.image_job) ? "…" : i + 1}</span>}
                <span className="sc-num">{i + 1}</span>
              </div>
              <div className="sc-text">
                <span className="sc-cap">{isCard(s) ? s.card?.text || "Card" : s.script || "sem narração"}</span>
                <span className="sc-dots" aria-label="estado">
                  {!isCard(s) && <i className={pipClass(s.image_job)} title="imagem" />}
                  {!isCard(s) && <i className={pipClass(s.video_job)} title="vídeo" />}
                  <i className={pipClass(s.audio_job)} title="narração" />
                  <em>{s.duration_sec ?? (isCard(s) ? 2 : 5)}s</em>
                </span>
              </div>
            </button>
          ))}
          <button className="scene add" onClick={() => addScene()}>
            <div className="sc-thumb">+</div>
            <div className="sc-text">
              <b>Nova cena</b>
              <span>vídeo ou card de texto</span>
            </div>
          </button>
        </aside>

        {/* ───── palco ───── */}
        <main className="stage-col">
          {selected === "final" ? (
            <FinalStage project={project} render={render} onRerender={renderFinal} busy={busy !== null} />
          ) : sel ? (
            <SceneStage key={sel.id} scene={sel} project={project} vopt={vopt} onGenerate={(k) => generate(sel, k)} localCost={(k) => localCost(sel, k)} canGen={(k) => canGen(sel, k)} onReload={load} />
          ) : (
            <div className="howto" style={{ padding: 24 }}>
              <h2>Sem cenas ainda</h2>
              <p>Escreva o tema no botão Roteiro e deixe a IA montar as cenas — ou crie a primeira cena à mão.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary" onClick={() => setScriptOpen(true)}>
                  Escrever roteiro
                </button>
                <button className="btn" onClick={() => addScene()}>
                  Nova cena
                </button>
              </div>
            </div>
          )}
        </main>

        {/* ───── inspetor ───── */}
        <aside className="inspector" aria-label="Detalhes da cena">
          {sel ? (
            <>
              <div className="insp-head">
                <div className="seg">
                  <button className={sel.type !== "card" ? "active" : ""} onClick={() => patchScene(sel.id, { type: "video" })}>
                    Vídeo
                  </button>
                  <button className={sel.type === "card" ? "active" : ""} onClick={() => patchScene(sel.id, { type: "card", card: sel.card ?? { text: sel.script.split(" ").slice(0, 3).join(" ").toUpperCase() } })}>
                    Card de texto
                  </button>
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  <button className="icon-btn" title="mover pra cima" onClick={() => moveScene(sel.id, -1)}>
                    ↑
                  </button>
                  <button className="icon-btn" title="mover pra baixo" onClick={() => moveScene(sel.id, 1)}>
                    ↓
                  </button>
                  <button className="icon-btn" title="inserir cena depois" onClick={() => addScene(sel.id)}>
                    +
                  </button>
                  <button className="icon-btn" title="remover cena" onClick={() => removeScene(sel.id)}>
                    🗑
                  </button>
                </div>
              </div>

              {sel.type === "card" && (
                <>
                  <div className="field">
                    <label htmlFor="ctext">Texto grande</label>
                    <input id="ctext" className="input" value={sel.card?.text ?? ""} onChange={(e) => patchScene(sel.id, { card: { ...sel.card, text: e.target.value } })} placeholder="ESFRIOU" />
                  </div>
                  <div className="field">
                    <label htmlFor="csub">Linha menor</label>
                    <input id="csub" className="input" value={sel.card?.subtext ?? ""} onChange={(e) => patchScene(sel.id, { card: { ...sel.card, subtext: e.target.value } })} placeholder="opcional" />
                  </div>
                  <div className="field">
                    <label htmlFor="cbtn">Botão</label>
                    <input id="cbtn" className="input" value={sel.card?.button ?? ""} onChange={(e) => patchScene(sel.id, { card: { ...sel.card, button: e.target.value } })} placeholder="Saiba mais (só no card final)" />
                  </div>
                  <ReferencePicker kind="image" label="Fundo" value={sel.card?.bgUrl ?? null} onChange={(url) => patchScene(sel.id, { card: { ...sel.card, bgUrl: url ?? undefined } })} hint="vazio = cor sólida ou a imagem da cena" />
                </>
              )}

              <div className="field">
                <label htmlFor="script">{sel.type === "card" ? "Narração do card" : "Narração"}</label>
                <textarea id="script" className="textarea" rows={3} value={sel.script} onChange={(e) => patchScene(sel.id, { script: e.target.value })} placeholder={sel.type === "card" ? "opcional — o card fica em silêncio se vazio" : "o que o narrador fala nessa cena (vira a legenda)"} />
                <span className="muted" style={{ fontSize: 11 }}>
                  {sel.script.length} caracteres · ~{Math.max(1, Math.round(sel.script.length / 15))} s de fala
                </span>
              </div>
              {sel.type !== "card" && (
                <>
                  <div className="field">
                    <label htmlFor="imgp">Prompt da imagem</label>
                    <textarea id="imgp" className="textarea" rows={4} value={sel.image_prompt ?? ""} onChange={(e) => patchScene(sel.id, { image_prompt: e.target.value })} placeholder="em inglês: estilo, personagem (ficha), ação, cenário, luz" />
                  </div>
                  <div className="field">
                    <label htmlFor="motp">Prompt do movimento</label>
                    <textarea id="motp" className="textarea" rows={2} value={sel.motion_prompt ?? ""} onChange={(e) => patchScene(sel.id, { motion_prompt: e.target.value })} placeholder="câmera e ação — ex.: slow push-in, she looks up" />
                  </div>
                </>
              )}
              <div className="field">
                <label htmlFor="dur">Duração</label>
                <select id="dur" className="select" value={sel.duration_sec ?? (sel.type === "card" ? 2 : 5)} onChange={(e) => patchScene(sel.id, { duration_sec: +e.target.value })}>
                  {(sel.type === "card" ? [1, 2, 3, 4] : vopt?.model.durations ?? [3, 4, 5, 6, 8, 10]).map((n) => (
                    <option key={n} value={n}>
                      {n} s
                    </option>
                  ))}
                </select>
                {sel.type !== "card" && <span className="muted" style={{ fontSize: 11 }}>com narração, a cena dura a fala + respiro; o clipe congela no último frame se faltar</span>}
              </div>
              {(sel.image_job?.error || sel.video_job?.error || sel.audio_job?.error) && (
                <div className="err">{sel.image_job?.error ?? sel.video_job?.error ?? sel.audio_job?.error}</div>
              )}
            </>
          ) : selected === "final" ? (
            <>
              <h3 style={{ margin: 0, fontSize: 14 }}>Montagem</h3>
              <div className="kv">
                <span>Legenda</span>
                <b>{project.caption_style === "sentence" ? "frase inteira" : "karaokê"} · {project.caption_uppercase ? "maiúsculas" : "normal"}</b>
              </div>
              <div className="kv">
                <span>Voz</span>
                <b>{project.voice?.name ?? "padrão"}</b>
              </div>
              <div className="kv">
                <span>Motor</span>
                <b>{vopt?.short}</b>
              </div>
              <div className="kv">
                <span>Trilha</span>
                <b>{project.music_url ? `${Math.round((project.music_volume ?? 0.18) * 100)}%` : "sem"}</b>
              </div>
              <button className="btn" onClick={() => setSettings(true)}>
                Ajustar legenda e trilha
              </button>
              <button className="btn ghost" onClick={removeProject}>
                Apagar projeto
              </button>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>Selecione uma cena.</div>
          )}
        </aside>
      </div>

      {/* ───── modais ───── */}
      {reviewOpen && project.review && (
        <Modal title={`Nota de viralidade · ${project.review.score}/10`} onClose={() => setReviewOpen(false)}>
          <div className="review">
            <div className="review-grid">
              {(["hook", "pacing", "clarity", "cta"] as const).map((k) => (
                <div key={k} className="review-item">
                  <b>
                    {project.review![k].score}
                    <small>/10</small>
                  </b>
                  <span>{k === "hook" ? "Gancho" : k === "pacing" ? "Ritmo" : k === "clarity" ? "Clareza da oferta" : "CTA"}</span>
                  <p>{project.review![k].note}</p>
                </div>
              ))}
            </div>
            {project.review.improvements?.length > 0 && (
              <div>
                <b style={{ fontSize: 13 }}>O que melhorar</b>
                <ul>
                  {project.review.improvements.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {project.review.bestVersion && (
              <div className="review-best">
                <span className="muted">Gancho sugerido</span>
                <b>{project.review.bestVersion}</b>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                className="btn"
                disabled={reviewing}
                onClick={async () => {
                  setReviewing(true);
                  try {
                    const r = await api<{ review: Review }>("/review", { method: "POST", body: JSON.stringify({ projectId: project.id }) });
                    setProject({ ...project, review: r.review });
                  } catch (e: any) {
                    toast(e.message, "bad");
                  } finally {
                    setReviewing(false);
                  }
                }}
              >
                {reviewing ? "Avaliando…" : "Avaliar de novo"}
              </button>
              <button className="btn primary" onClick={() => setReviewOpen(false)}>
                Fechar
              </button>
            </div>
          </div>
        </Modal>
      )}
      {scriptOpen && (
        <Modal title="Roteiro" onClose={() => setScriptOpen(false)}>
          <div style={{ display: "grid", gap: 12, maxWidth: 640 }}>
            <div className="field">
              <label htmlFor="theme">Tema</label>
              <textarea id="theme" className="textarea" rows={3} value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Sobre o que é esse vídeo? Quanto mais contexto, melhor o roteiro." />
            </div>
            <div className="field">
              <label>Estilo visual</label>
              <div className="style-grid">
                {STYLES.map((s) => (
                  <button key={s.id} className={`style-opt pic ${(project.style ?? "epic") === s.id ? "active" : ""}`} onClick={() => patchProject({ style: s.id })} style={{ backgroundImage: `url(/art/style-${s.id}.jpg)` }}>
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {project.character_sheet && (
              <div className="field">
                <label>Ficha do personagem (entra em toda imagem)</label>
                <textarea className="textarea" rows={3} value={project.character_sheet} onChange={(e) => patchProject({ character_sheet: e.target.value })} />
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setScriptOpen(false)}>
                Fechar
              </button>
              <button className="btn primary" disabled={busy !== null || theme.trim().length < 4} onClick={writeScript}>
                {busy === "script" ? "Escrevendo (até 2 min)…" : project.scenes.length ? "Reescrever roteiro" : "Escrever roteiro"}
              </button>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>Custo do roteiro: ~US$ 0,005 (cota grátis). Reescrever substitui as cenas e o que já foi gerado nelas.</span>
          </div>
        </Modal>
      )}
      {settings && (
        <Modal title="Narração, legenda e trilha" onClose={() => setSettings(false)}>
          <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
            <div className="field">
              <label htmlFor="nstyle">Direção da narração (vale pra todas as cenas)</label>
              <input id="nstyle" className="input" defaultValue={project.narration_style ?? ""} maxLength={300} placeholder="Ex.: narrador de Reels contando uma história de suspense, ritmo ágil, pausas mínimas" onBlur={(e) => e.target.value !== (project.narration_style ?? "") && patchProject({ narration_style: e.target.value || null })} />
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>Ritmo</span>
                <select className="select" style={{ width: 190 }} value={String(project.speech_rate ?? 0)} onChange={(e) => patchProject({ speech_rate: +e.target.value })}>
                  <option value="-10">mais calmo</option>
                  <option value="0">normal</option>
                  <option value="12">ágil (Reels)</option>
                  <option value="25">bem rápido</option>
                </select>
                <span className="muted" style={{ fontSize: 11.5 }}>Mudou aqui? Refaça a narração das cenas pra valer.</span>
              </div>
              <TakeBox project={project} onReload={load} />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="cstyle">Legenda</label>
                <select id="cstyle" className="select" value={project.caption_style ?? "karaoke"} onChange={(e) => patchProject({ caption_style: e.target.value as any })}>
                  <option value="karaoke">Palavra destacada (karaokê)</option>
                  <option value="sentence">Frase inteira</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="ccase">Caixa</label>
                <select id="ccase" className="select" value={project.caption_uppercase ? "1" : "0"} onChange={(e) => patchProject({ caption_uppercase: e.target.value === "1" })}>
                  <option value="1">MAIÚSCULAS</option>
                  <option value="0">Normal</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>Música de fundo</label>
              {project.music_url ? (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <audio className="player" src={project.music_url} controls preload="none" style={{ flex: 1 }} />
                  <select className="select" style={{ width: 84 }} value={String(project.music_volume ?? 0.18)} onChange={(e) => patchProject({ music_volume: +e.target.value })} title="volume">
                    {["0.08", "0.12", "0.18", "0.25", "0.35"].map((v) => (
                      <option key={v} value={v}>
                        {Math.round(+v * 100)}%
                      </option>
                    ))}
                  </select>
                  <button className="btn ghost sm" onClick={() => patchProject({ music_url: null })}>
                    Tirar
                  </button>
                </div>
              ) : (
                <>
                  <ReferencePicker kind="audio" label="Trilha (mp3) — entra baixa e abaixa sozinha sob a narração" value={null} onChange={(url) => url && patchProject({ music_url: url })} accept="audio/*" />
                  <MusicGen project={project} onDone={(url) => patchProject({ music_url: url })} />
                </>
              )}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>A prévia no palco já usa esses ajustes; o vídeo final só muda depois de Remontar.</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ───────────────────────── palco da cena ───────────────────────── */
function SceneStage({ scene, project, vopt, onGenerate, localCost, canGen, onReload }: { scene: Scene; project: Project; vopt?: VideoOpt; onGenerate: (k: Kind) => void; localCost: (k: Kind) => number; canGen: (k: Kind) => boolean; onReload: () => Promise<unknown> | void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const words = scene.audio_job?.usage?.subtitle?.sentences?.flatMap((s: any) => s.words ?? []) ?? undefined;
  const hasAudio = isDone(scene.audio_job);
  const isCard = scene.type === "card";
  const isStill = scene.video_job?.request?.kind === "still";
  const toast = useToast();
  const [stillBusy, setStillBusy] = useState(false);
  /** plano parado: a imagem da cena vira o clipe (zoom), no lugar do vídeo de IA — local e grátis */
  const makeStill = async () => {
    setStillBusy(true);
    try {
      await api(`/projects/${project.id}/scenes/${scene.id}/still`, { method: "POST", body: "{}" });
      toast("Plano parado na fila — fica pronto em segundos", "ok");
      await onReload();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setStillBusy(false);
    }
  };

  const toggle = () => {
    const a = audioRef.current;
    const v = videoRef.current;
    if (playing) {
      a?.pause();
      v?.pause();
      setPlaying(false);
      return;
    }
    if (a) {
      a.currentTime = 0;
      a.play().catch(() => {});
    }
    if (v) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    setPlaying(true);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === " " && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, scene.id]);

  const bg = scene.card?.bgUrl ?? (isDone(scene.image_job) ? scene.image_job!.output_url! : undefined);

  return (
    <div className="stagebox">
      <div className="stage-frame">
        {isCard ? (
          <CardPreview text={scene.card?.text} subtext={scene.card?.subtext} button={scene.card?.button} bg={bg} size={1} />
        ) : isDone(scene.video_job) ? (
          <video ref={videoRef} src={scene.video_job!.output_url!} muted={hasAudio} playsInline preload="metadata" onEnded={() => !hasAudio && setPlaying(false)} />
        ) : isDone(scene.image_job) ? (
          <img src={scene.image_job!.output_url!} alt="" />
        ) : (
          <div className="stage-empty">
            {isActive(scene.image_job) ? (
              <span className="stage">
                <span className="status-dot run" /> gerando imagem
              </span>
            ) : (
              <>
                <b>Sem imagem</b>
                <span>escreva o prompt ao lado e gere — ou faça upload na Biblioteca</span>
              </>
            )}
          </div>
        )}
        {!isCard && (scene.script || words) && (
          <CaptionPreview text={scene.script} words={words} t={t} karaoke={project.caption_style !== "sentence"} uppercase={project.caption_uppercase ?? true} size={0.52} />
        )}
        {(hasAudio || isDone(scene.video_job)) && (
          <button className={`play ${playing ? "on" : ""}`} onClick={toggle} aria-label={playing ? "pausar" : "tocar prévia"}>
            {playing ? "❚❚" : "▶"}
          </button>
        )}
        {hasAudio && (
          <audio
            ref={audioRef}
            src={scene.audio_job!.output_url!}
            preload="metadata"
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onEnded={() => {
              setPlaying(false);
              setT(0);
              videoRef.current?.pause();
            }}
          />
        )}
        <span className="stage-tag">cena {scene.position + 1}{isCard ? " · card" : isDone(scene.video_job) ? (isStill ? " · plano parado (imagem com zoom)" : ` · ${scene.video_job?.request?.resolution ?? ""} ${videoModelName(scene.video_job?.request?.model) ?? ""}`) : isDone(scene.image_job) ? " · imagem (sem vídeo ainda)" : ""}</span>
      </div>

      {/* ações da cena */}
      <div className="stage-actions">
        {!isCard && <AssetBtn label="Imagem" job={scene.image_job} cost={localCost("image")} can={canGen("image")} onGo={() => onGenerate("image")} free />}
        {!isCard && <AssetBtn label="Vídeo" job={scene.video_job} cost={localCost("video")} can={canGen("video")} onGo={() => onGenerate("video")} free={!!vopt?.model.free} hint={!isDone(scene.image_job) ? "precisa da imagem" : undefined} />}
        <AssetBtn label="Narração" job={scene.audio_job} cost={localCost("audio")} can={canGen("audio")} onGo={() => onGenerate("audio")} free />
      </div>
      {!isCard && isDone(scene.image_job) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", flexWrap: "wrap", fontSize: 11.5 }}>
          <button className="btn sm" disabled={stillBusy || isActive(scene.video_job)} onClick={makeStill} title="A imagem da cena vira o clipe, com zoom de aproximação, no lugar do vídeo de IA. Feito aqui no computador, em segundos.">
            {isStill ? "Refazer plano parado" : "Usar plano parado"}
          </button>
          <span className="muted">{isStill ? "esta cena usa a imagem com zoom — clique em Vídeo pra voltar ao vídeo de IA" : "imagem com zoom no lugar do vídeo — grátis; bom pra gráfico, tela e texto, que o vídeo de IA deforma"}</span>
        </div>
      )}
      {!isCard && (scene.image_prompt ?? "").trim() && <Variations projectId={project.id} scene={scene} onReload={onReload} />}
      <div className="muted" style={{ fontSize: 11.5, textAlign: "center" }}>
        {hasAudio ? "▶ toca a narração com a legenda no estilo final (espaço = play/pause)" : "gere a narração pra ver a legenda sincronizada aqui"} · ↑↓ troca de cena
      </div>
    </div>
  );
}

/** grade de variações: N imagens alternativas da cena; clique em uma pra usar (o vídeo é regerado depois) */
function Variations({ projectId, scene, onReload }: { projectId: string; scene: Scene; onReload: () => Promise<unknown> | void }) {
  const toast = useToast();
  const ask = useConfirm();
  const [vars, setVars] = useState<Job[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api<{ variations: Job[] }>(`/projects/${projectId}/scenes/${scene.id}/variations`).then((r) => setVars(r.variations)).catch(() => {}), [projectId, scene.id]);
  useEffect(() => {
    setVars(null);
    load();
  }, [load]);
  useEffect(() => {
    if (!vars?.some(isActive)) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [vars, load]);

  const make = async () => {
    if (!await ask(`Gerar 4 variações da imagem da cena ${scene.position + 1} com Seedream?
Custo ${usd(0.16)} — sai da cota grátis.`, "Gerar")) return;
    setBusy(true);
    try {
      await api(`/projects/${projectId}/scenes/${scene.id}/variations`, { method: "POST", body: JSON.stringify({ count: 4 }) });
      toast("4 variações na fila — ~30 s", "ok");
      await load();
    } catch (e: any) {
      toast(e instanceof ApiError && e.status === 402 ? `Trava de custo: ${usd(e.body?.estimatedCostUsd)}` : e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  const use = async (j: Job) => {
    try {
      await api(`/projects/${projectId}/scenes/${scene.id}`, { method: "PATCH", body: JSON.stringify({ image_job_id: j.id }) });
      toast("Imagem trocada — gere o vídeo de novo se já tinha", "ok");
      await onReload();
    } catch (e: any) {
      toast(e.message, "bad");
    }
  };

  const list = vars ?? [];
  if (!list.length) {
    return (
      <button className="btn ghost sm" style={{ justifySelf: "center" }} disabled={busy} onClick={make} title="4 imagens alternativas pra escolher a melhor">
        ✦ 4 variações da imagem <span className="cost">grátis</span>
      </button>
    );
  }
  return (
    <div className="variations">
      <div className="area-head" style={{ marginBottom: 2 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          Variações · clique pra usar
        </span>
        <button className="btn ghost sm" disabled={busy} onClick={make}>
          + 4 <span className="cost">grátis</span>
        </button>
      </div>
      <div className="var-strip">
        {list.map((j) => (
          <button key={j.id} className={`var ${scene.image_job?.id === j.id ? "current" : ""}`} disabled={!isDone(j)} onClick={() => use(j)} title={isDone(j) ? "usar esta imagem" : j.status}>
            {isDone(j) ? <img src={j.output_url!} alt="" /> : <span className="muted" style={{ fontSize: 11 }}>{isActive(j) ? "gerando…" : "falhou"}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssetBtn({ label, job, cost, can, onGo, free, hint }: { label: string; job: Job | null; cost: number; can: boolean; onGo: () => void; free: boolean; hint?: string }) {
  const active = isActive(job);
  const done = isDone(job);
  return (
    <button className={`asset ${done ? "done" : ""} ${active ? "run" : ""} ${job?.status === "failed" ? "bad" : ""}`} disabled={!can || active} onClick={onGo} title={hint ?? (done ? `gerar ${label.toLowerCase()} de novo` : `gerar ${label.toLowerCase()}`)}>
      <span className="a-dot" />
      <span className="a-l">
        <b>{label}</b>
        <span>{active ? (job?.status === "queued" ? "na fila" : "gerando…") : done ? "pronto ↻" : job?.status === "failed" ? "falhou ↻" : hint ?? "gerar"}</span>
      </span>
      <span className="a-cost">
        {usd(cost)}
        <small>{free ? "grátis" : "cartão"}</small>
      </span>
    </button>
  );
}

function FinalStage({ project, render, onRerender, busy }: { project: Project; render: Job | null; onRerender: () => void; busy: boolean }) {
  const poster = project.scenes.find((x) => isDone(x.image_job))?.image_job?.output_url ?? undefined;
  return (
    <div className="stagebox">
      <div className="stage-frame">
        {isDone(render) ? (
          <video src={render!.output_url!} controls playsInline preload="metadata" poster={poster} />
        ) : (
          <div className="stage-empty">
            <span className="stage">
              <span className="status-dot run" /> montando com FFmpeg
            </span>
            <span>legenda, narração, cards e trilha — ~1 minuto</span>
          </div>
        )}
        <span className="stage-tag">vídeo final</span>
      </div>
      {isDone(render) && (
        <div className="stage-actions">
          <a className="btn primary" href={render!.output_url!} download>
            Baixar MP4
          </a>
          <PublishButton videoUrl={render!.output_url!} caption={project.theme ?? project.title} name={project.title} projectId={project.id} />
          <button className="btn" disabled={busy} onClick={onRerender}>
            Remontar
          </button>
          <a className="btn ghost" href={render!.output_url!} target="_blank" rel="noreferrer">
            Abrir em nova aba
          </a>
        </div>
      )}
      {render?.error && <div className="err">{render.error}</div>}
    </div>
  );
}

function videoModelName(id?: string) {
  if (!id) return undefined;
  if (id.startsWith("seedance-1-0-pro-fast")) return "Seedance 1.0 fast";
  if (id.startsWith("seedance-1-0")) return "Seedance 1.0 pro";
  if (id.startsWith("dreamina-seedance-2-5")) return "Seedance 2.5";
  if (id.startsWith("dreamina-seedance-2")) return "Seedance 2.0";
  if (id.startsWith("kling")) return "Kling " + id.replace("kling-", "");
  return id;
}

function pipClass(j: Job | null) {
  if (!j) return "";
  if (j.status === "succeeded") return "ok";
  if (j.status === "failed") return "bad";
  return "run";
}

/* ───────────────────────── trilha gerada (Seed Audio, experimental) ───────────────────────── */
const MOODS: Record<string, string> = {
  epic: "epic orchestral cinematic soundtrack, slow build with strings and low drums, inspiring",
  comic: "playful upbeat pop-funk beat, bright synths and claps, fun",
  anime: "emotional J-pop style instrumental, piano and strings with a steady beat",
  cinematic: "modern cinematic trailer bed, deep pulse, atmospheric pads, tension and release",
  flat: "clean corporate lo-fi beat, soft keys and light percussion, optimistic",
};
function MusicGen({ project, onDone }: { project: Project; onDone: (url: string) => void }) {
  const toast = useToast();
  const [mood, setMood] = useState(MOODS[project.style ?? "epic"] ?? MOODS.epic);
  const [busy, setBusy] = useState<string | null>(null);
  const total = Math.min(120, Math.max(15, Math.round(project.scenes.reduce((a, s) => a + (s.duration_sec ?? 5), 0) + 6)));
  const go = async () => {
    setBusy("gerando…");
    try {
      const r = await api<{ jobId: string }>("/generate", { method: "POST", body: JSON.stringify({ request: { kind: "sfx", model: "seed-audio-sfx", prompt: `background music: ${mood}`, durationSec: total } }) });
      for (let i = 0; i < 60; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const j = await api<Job>(`/jobs/${r.jobId}`);
        if (j.status === "succeeded" && j.output_url) {
          onDone(j.output_url);
          toast("Trilha gerada — ouça e ajuste o volume", "ok");
          return;
        }
        if (j.status === "failed") throw new Error(j.error ?? "falhou");
      }
      throw new Error("demorou demais — veja em Biblioteca → Áudio");
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 8, padding: 10, border: "1px dashed var(--line)", borderRadius: 10 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        Ou gere uma trilha instrumental ({total} s) pelo Seed Audio — experimental, cota grátis de voz, sem direito autoral de terceiros.
      </span>
      <input className="input" value={mood} onChange={(e) => setMood(e.target.value)} maxLength={300} placeholder="clima da música (em inglês funciona melhor)" />
      <button className="btn sm" disabled={!!busy} onClick={go} style={{ justifySelf: "start" }}>
        {busy ?? "Gerar trilha ♪"}
      </button>
    </div>
  );
}

/** narração contínua: todas as falas numa tomada (sem emenda entre cenas); o render corta as cenas em cima dela */
function TakeBox({ project, onReload }: { project: Project; onReload: () => Promise<unknown> | void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const j = project.narration_job;
  const text = project.scenes.map((s) => (s.script ?? "").trim()).filter(Boolean).join(" ");
  const current = isDone(j) && (j!.request as any)?.text === text;
  useEffect(() => {
    if (!isActive(j)) return;
    const t = setInterval(() => onReload(), 3000);
    return () => clearInterval(t);
  }, [j?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    setBusy(true);
    try {
      await api(`/projects/${project.id}/narration`, { method: "POST", body: "{}" });
      toast("Narração contínua na fila — uns 30 s", "ok");
      await onReload();
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "grid", gap: 6, padding: 10, border: "1px solid var(--line)", borderRadius: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn sm" disabled={busy || isActive(j) || !text} onClick={go}>
          {isActive(j) ? "Gerando narração…" : current ? "Gerar a narração contínua de novo" : "Gerar narração contínua"}
        </button>
        {current && <audio src={j!.output_url!} controls preload="none" style={{ height: 30 }} />}
      </div>
      {current && (j!.usage as any)?.check && !(j!.usage as any).check.ok && (
        <span style={{ fontSize: 12, color: "var(--bad, #e5484d)" }}>
          A voz pulou ou trocou palavras: {[...(j!.usage as any).check.missing.map((t: string) => `faltou em “${t}”`), ...((j!.usage as any).check.extra.length ? [`a mais: ${(j!.usage as any).check.extra.join(", ")}`] : [])].join(" · ")}. Gere de novo antes de montar.
        </span>
      )}
      {current && (j!.usage as any)?.check?.ok && (
        <span style={{ fontSize: 12, color: "var(--ok, #30a46c)" }}>
          Conferida: a voz falou todas as {(j!.usage as any).check.words} palavras do roteiro
          {(j!.usage as any).check.wps ? ` · ${(j!.usage as any).check.seconds} s de fala, ${String((j!.usage as any).check.wps).replace(".", ",")} palavras/s (${(j!.usage as any).check.pace})` : ""}.
        </span>
      )}
      <span className="muted" style={{ fontSize: 11.5 }}>
        {current
          ? `Em uso: o vídeo monta em cima desta tomada (${Math.round((j!.usage as any)?.seconds ?? 0)} s). A narração por cena fica de lado.`
          : isDone(j)
            ? "O roteiro mudou depois da última tomada — gere de novo pra usar (até lá o vídeo usa a narração por cena)."
            : "Uma tomada só com todas as falas: entonação contínua, sem emenda entre as cenas. Grátis (cota de voz)."}
      </span>
    </div>
  );
}
