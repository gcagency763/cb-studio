"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api, type Job, type Project, type ProjectSummary, type Voice } from "@/lib/api";
import { useToast } from "@/components/Toasts";
import { Modal, ReferencePicker } from "@/components/create";

type Style = { id: string; label: string };
const STYLE_META: Record<string, { desc: string; sample: string }> = {
  epic: { desc: "Pintura épica, luz dourada, mitologia — o estilo dos anúncios que mais venderam", sample: "epic" },
  comic: { desc: "Traço de quadrinho, contorno forte, cores chapadas", sample: "comic" },
  anime: { desc: "Anime moderno, expressivo, fundo detalhado", sample: "anime" },
  cinematic: { desc: "Fotorrealista, câmera de cinema, profundidade", sample: "cinematic" },
  flat: { desc: "Vetor limpo, motion graphics, explicativo", sample: "flat" },
};

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="page-pad muted">Carregando…</div>}>
      <ProjectsInner />
    </Suspense>
  );
}

function ProjectsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);

  const [wizard, setWizard] = useState(!!params.get("tema") || !!params.get("novo"));
  const [step, setStep] = useState(0);
  const [theme, setTheme] = useState(params.get("tema") ?? "");
  const [style, setStyle] = useState("epic");
  const [voiceId, setVoiceId] = useState("");
  const [count, setCount] = useState(8);
  const [refVideo, setRefVideo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"creating" | "writing" | null>(null);

  useEffect(() => {
    api<{ projects: ProjectSummary[] }>("/projects").then((r) => setProjects(r.projects)).catch(() => setProjects([]));
    api<{ styles: Style[] }>("/styles").then((r) => setStyles(r.styles)).catch(() => {});
    api<{ voices: Voice[] }>("/voices").then((r) => setVoices(r.voices)).catch(() => {});
  }, []);

  const styleList = useMemo(() => (styles.length ? styles : Object.keys(STYLE_META).map((id) => ({ id, label: id }))), [styles]);
  // amostra por estilo: capa de um projeto seu com esse estilo; senão, gradiente
  // arte própria do estúdio: a mesma cena nos 5 estilos (apps/web/public/art)
  const sampleFor = (styleId: string) => (STYLE_META[styleId] ? `/art/style-${styleId}.jpg` : undefined);

  async function create(withScript: boolean) {
    setBusy("creating");
    try {
      if (withScript && refVideo) {
        // a partir de um vídeo de referência: transcreve, analisa a estrutura e escreve o roteiro novo (job local)
        setBusy("writing");
        const r = await api<{ jobId: string }>("/script/from-video", { method: "POST", body: JSON.stringify({ videoUrl: refVideo, theme: theme.trim(), style, scenes: count, voiceId: voiceId || null }) });
        for (let i = 0; i < 300; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const j = await api<Job>(`/jobs/${r.jobId}`);
          if (j.status === "succeeded" && j.usage?.projectId) return router.push(`/projects/${j.usage.projectId}`);
          if (j.status === "failed") throw new Error(j.error ?? "falhou ao recriar a referência");
        }
        throw new Error("demorou demais — veja em Cortes › Trabalhos");
      }
      const p = await api<Project>("/projects", { method: "POST", body: JSON.stringify({ title: theme.trim().slice(0, 80) || "Novo vídeo", theme: theme.trim() || undefined, style }) });
      if (voiceId) await api(`/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ voice_id: voiceId }) }).catch(() => {});
      if (withScript) {
        setBusy("writing");
        await api<Project>("/script", { method: "POST", body: JSON.stringify({ projectId: p.id, theme: theme.trim(), scenes: count, style }) });
      }
      router.push(`/projects/${p.id}`);
    } catch (e: any) {
      toast(e.message, "bad");
      setBusy(null);
    }
  }

  const steps = ["Tema", "Estilo", "Voz", "Cenas"];
  const canNext = step === 0 ? theme.trim().length >= 4 : true;

  return (
    <div className="page-pad" style={{ display: "grid", gap: 24 }}>
      <div className="rail-head">
        <div>
          <h1 className="page" style={{ margin: 0 }}>
            Quadrinhos
          </h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Tema → roteiro → imagens → vídeo → narração → legenda → MP4. Cada passo mostra o custo antes.
          </p>
        </div>
        <button className="btn primary" onClick={() => { setStep(0); setWizard(true); }}>
          + Novo quadrinho
        </button>
      </div>

      {projects === null ? (
        <div className="muted">Carregando…</div>
      ) : projects.length === 0 ? (
        <div className="howto" style={{ padding: "32px 0" }}>
          <h2>Seu primeiro quadrinho</h2>
          <p>Uma frase sobre o tema basta. A IA escreve 8 cenas + cards de abertura e de chamada, com a ficha do personagem pra manter o mesmo rosto em todas as imagens.</p>
          <button className="btn primary" style={{ justifySelf: "start" }} onClick={() => setWizard(true)}>
            Começar
          </button>
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="card">
              <div className="frame-box">
                {p.render_url ? (
                  <video src={p.render_url} muted playsInline preload="metadata" poster={p.cover_url ?? undefined} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                ) : p.cover_url ? (
                  <img src={p.cover_url} alt="" />
                ) : (
                  <div className="frame-empty">sem imagens ainda</div>
                )}
                <div className="frame-state">
                  {Array.from({ length: Math.max(1, p.scene_count) }).map((_, i) => (
                    <span key={i} className={`pip ${i < p.ready_count ? "ok" : ""}`} />
                  ))}
                </div>
                {p.render_url && <span className="stage-tag" style={{ left: 8, top: 8, fontSize: 10.5 }}>✦ vídeo final</span>}
                {p.campaign && <span className="stage-tag" style={{ right: 8, top: 8, left: "auto", fontSize: 10.5 }} title={`campanha: ${p.campaign}`}>📣 {p.campaign.slice(0, 18)}</span>}
              </div>
              <div>
                <b>{p.title}</b>
                <span>{p.render_url ? "Pronto pra baixar" : `${p.ready_count} de ${p.scene_count} cenas prontas`}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {wizard && (
        <Modal title="Novo quadrinho" onClose={() => !busy && setWizard(false)} className="wizard" bare>
          <aside className="wiz-steps">
            <div className="wiz-brand">Novo quadrinho</div>
            {steps.map((s, i) => (
              <button key={s} className={`wiz-step ${i === step ? "active" : ""} ${i < step ? "done" : ""}`} onClick={() => i < step && setStep(i)} disabled={!!busy}>
                <span className="n">{i < step ? "✓" : i + 1}</span>
                {s}
              </button>
            ))}
            <div className="wiz-foot muted">
              Roteiro ~US$ 0,005 · imagens US$ 0,04 cada · vídeo 720p US$ 0,11 por 5 s · narração ~US$ 0,01/cena — tudo na cota grátis hoje.
            </div>
          </aside>
          <section className="wiz-body">
            {busy === "writing" ? (
              <div className="wiz-writing">
                <div className="orb" />
                <h3>{refVideo ? "Lendo a referência e escrevendo o roteiro…" : "Escrevendo o roteiro…"}</h3>
                <p className="muted">{refVideo ? "Transcrição do vídeo de referência, análise da estrutura (gancho, batidas, CTA) e roteiro novo com o seu tema. Leva 2–4 minutos — você já cai na mesa de edição quando terminar." : "Personagem, cenas, cards de abertura e de chamada. Leva até 2 minutos — você já cai na mesa de edição quando terminar."}</p>
              </div>
            ) : step === 0 ? (
              <>
                <h3>Sobre o que é o vídeo?</h3>
                <p className="muted">Quanto mais contexto (quem, qual dor, qual virada, qual oferta), melhor o roteiro.</p>
                <textarea className="textarea" rows={5} autoFocus value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Ex.: Pai de família endividado começou a vender na Shopee sem estoque e em 90 dias quitou tudo — mostrar a virada e chamar pra aula gratuita" />
                <div className="starters">
                  {["Hera, Zeus e o cinto de Afrodite: por que o desejo esfria e o que isso tem a ver com vender", "A formiga e a cigarra, versão loja online", "O que ninguém te conta sobre frete grátis na Shopee"].map((t) => (
                    <button key={t} type="button" onClick={() => setTheme(t)}>
                      {t}
                    </button>
                  ))}
                </div>
                <details className="wiz-ref" open={!!refVideo}>
                  <summary>Recriar um vídeo que performou (opcional)</summary>
                  <p className="muted" style={{ margin: "6px 0 10px", fontSize: 12.5 }}>
                    Suba o anúncio de referência (seu ou de concorrente): o estúdio transcreve, entende gancho, batidas e CTA, e escreve o roteiro novo com o seu tema na mesma estrutura. Grátis.
                  </p>
                  <ReferencePicker kind="video" label="Vídeo de referência" value={refVideo} onChange={setRefVideo} accept="video/*,audio/*" hint="mp4 ou mov — o roteiro vai seguir a estrutura dele" />
                </details>
              </>
            ) : step === 1 ? (
              <>
                <h3>Estilo visual</h3>
                <p className="muted">Vale pra todas as imagens do projeto. Épico ilustrado é o que mais converteu nos anúncios da G2.</p>
                <div className="style-cards">
                  {styleList.map((s, i) => (
                    <button key={s.id} className={`style-card ${style === s.id ? "active" : ""}`} onClick={() => setStyle(s.id)}>
                      <div className="pic" style={!sampleFor(s.id) ? { background: `linear-gradient(135deg, hsl(${i * 60 + 10} 45% 22%), #151515)` } : undefined}>
                        {sampleFor(s.id) ? <img src={sampleFor(s.id)} alt="" /> : <span className="pic-label">{s.label}</span>}
                      </div>
                      <b>{s.label}</b>
                      <span>{STYLE_META[s.id]?.desc ?? ""}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : step === 2 ? (
              <>
                <h3>Voz da narração</h3>
                <p className="muted">Voz padrão do Seed Audio ou uma voz clonada (cadastre em Áudio → Vozes, com autorização).</p>
                <div className="voice-list">
                  <button className={`voice ${voiceId === "" ? "active" : ""}`} onClick={() => setVoiceId("")}>
                    <b>Voz padrão</b>
                    <span>masculina, grave, narrador — pt-BR</span>
                  </button>
                  {voices.map((v) => (
                    <button key={v.id} className={`voice ${voiceId === v.id ? "active" : ""}`} onClick={() => setVoiceId(v.id)}>
                      <b>{v.name}</b>
                      <span>clonada · autorizada por {v.consent_name ?? "—"}</span>
                      <audio className="player" src={v.reference_url} controls preload="none" onClick={(e) => e.stopPropagation()} />
                    </button>
                  ))}
                  <Link href="/audio" className="voice ghost">
                    <b>+ Clonar uma voz</b>
                    <span>10–30 s de áudio limpo da pessoa</span>
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h3>Quantas cenas?</h3>
                <p className="muted">Cada cena de vídeo dura ~5 s + a narração. O roteiro adiciona cards de abertura, meio e chamada final sozinho.</p>
                <div className="count-row">
                  {[6, 8, 10, 12, 14].map((n) => (
                    <button key={n} className={`count ${count === n ? "active" : ""}`} onClick={() => setCount(n)}>
                      <b>{n}</b>
                      <span>~{Math.round(n * 6.5)} s</span>
                    </button>
                  ))}
                </div>
                <div className="kv">
                  <span>Tema</span>
                  <b style={{ textAlign: "right", maxWidth: "70%" }}>{theme.trim().slice(0, 90)}</b>
                </div>
                <div className="kv">
                  <span>Estilo</span>
                  <b>{styleList.find((s) => s.id === style)?.label}</b>
                </div>
                <div className="kv">
                  <span>Voz</span>
                  <b>{voices.find((v) => v.id === voiceId)?.name ?? "padrão"}</b>
                </div>
                {refVideo && (
                  <div className="kv">
                    <span>Referência</span>
                    <b>segue a estrutura do vídeo enviado</b>
                  </div>
                )}
                <div className="kv">
                  <span>Custo estimado do vídeo inteiro</span>
                  <b style={{ color: "var(--gold)" }}>≈ US$ {(0.005 + count * (0.04 + 0.11) + (count + 3) * 0.01).toFixed(2)} · cota grátis</b>
                </div>
              </>
            )}
            {busy !== "writing" && (
              <div className="wiz-nav">
                <button className="btn ghost" onClick={() => (step === 0 ? setWizard(false) : setStep(step - 1))} disabled={!!busy}>
                  {step === 0 ? "Cancelar" : "Voltar"}
                </button>
                <div style={{ display: "flex", gap: 8 }}>
                  {step === 3 && (
                    <button className="btn" disabled={!!busy} onClick={() => create(false)} title="cria o projeto vazio pra você escrever as cenas à mão">
                      Criar vazio
                    </button>
                  )}
                  {step < 3 ? (
                    <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
                      Continuar
                    </button>
                  ) : (
                    <button className="btn primary" disabled={!!busy || theme.trim().length < 4} onClick={() => create(true)}>
                      {busy === "creating" ? "Criando…" : "Escrever roteiro ✦"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </Modal>
      )}
    </div>
  );
}
