"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, fmtDate, type Job, type ProjectSummary } from "@/lib/api";
import { loadModels, type CatalogModel } from "@/lib/models";

const features = [
  { href: "/projects", ic: "📖", title: "Quadrinhos", tag: "Top", desc: "Tema → roteiro → imagens → vídeo → narração → legenda → MP4" },
  { href: "/clone", ic: "🧬", title: "Clone", tag: "Novo", desc: "Foto + voz clonada → a pessoa falando" },
  { href: "/image", ic: "🖼️", title: "Imagem", desc: "Seedream, GPT Image, Nano Banana" },
  { href: "/video", ic: "🎬", title: "Vídeo", desc: "Seedance, Kling, Grok" },
  { href: "/audio", ic: "🎙️", title: "Áudio", desc: "Narração, clonar voz, efeitos" },
  { href: "/cuts", ic: "✂️", title: "Cortes", tag: "Novo", desc: "Aula de 1 h → 10 cortes com legenda karaokê, grátis" },
  { href: "/cuts?tab=dub", ic: "🌎", title: "Dublar", tag: "Novo", desc: "O mesmo vídeo em inglês ou espanhol, com a sua voz" },
  { href: "/carousel", ic: "🖼️", title: "Carrossel", tag: "Novo", desc: "Tema → slides pro Instagram com arte e texto, zip pronto" },
  { href: "/ads", ic: "📣", title: "Anúncios", tag: "Novo", desc: "Produto + ganchos → um quadrinho por gancho, em lote" },
  { href: "/roadmap#publish", ic: "🚀", title: "Publicar", desc: "Reels, TikTok, Shorts e Meta Ads direto daqui", soon: true },
  { href: "/settings#mcp", ic: "🤖", title: "Pelo Claude", tag: "MCP", desc: "“faz um quadrinho sobre X” — ele cria, gera e monta" },
  { href: "/roadmap", ic: "🗺️", title: "Tudo que dá pra fazer", desc: "Pronto, em breve e o que o Higgsfield e cia têm" },
];

const HINTS = [
  "Pai de família quitou as dívidas vendendo na Shopee sem estoque",
  "Hera, Zeus e o cinto de Afrodite: por que o desejo esfria",
  "A formiga e a cigarra versão loja online",
  "O que ninguém te conta sobre frete grátis",
];

export default function Explore() {
  const router = useRouter();
  const [theme, setTheme] = useState("");
  const [videos, setVideos] = useState<Job[]>([]);
  const [images, setImages] = useState<Job[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);
  useEffect(() => {
    api<{ generated: Job[] }>("/library?kind=video").then((r) => setVideos(r.generated.slice(0, 14))).catch(() => {});
    api<{ generated: Job[] }>("/library?kind=image").then((r) => setImages(r.generated.slice(0, 14))).catch(() => {});
    api<{ projects: ProjectSummary[] }>("/projects").then((r) => setProjects(r.projects.slice(0, 8))).catch(() => {});
    loadModels().then(setModels).catch(() => {});
  }, []);

  // parede do showreel: vídeos + imagens suas, distribuídos em 8 colunas (repete pra encher)
  const wall = useMemo(() => {
    // no máximo 9 vídeos tocando ao mesmo tempo (o resto são imagens) — leve pra qualquer máquina
    const vids = videos.map((j) => ({ k: "v", u: j.output_url! }));
    const imgs = images.map((j) => ({ k: "i", u: j.output_url! }));
    if (!vids.length && !imgs.length) return [] as { k: string; u: string }[][];
    const cols: { k: string; u: string }[][] = Array.from({ length: 9 }, () => []);
    for (let i = 0; i < 36; i++) {
      const useVideo = vids.length && (i % 4 === 0 || !imgs.length);
      cols[i % 9].push(useVideo ? vids[(i / 4) % vids.length | 0] : imgs[(i * 7) % imgs.length]);
    }
    return cols;
  }, [videos, images]);
  const start = (t: string) => {
    const tema = t.trim();
    if (tema.length < 4) return;
    router.push(`/projects?tema=${encodeURIComponent(tema)}`);
  };
  const free = models.filter((m) => !m.locked);
  const locked = models.filter((m) => m.locked);

  return (
    <div className="page-pad" style={{ display: "grid", gap: 34 }}>
      {/* showreel */}
      <section className="showreel" aria-label="Comece um vídeo">
        <div className="wall" aria-hidden>
          {wall.map((col, ci) => (
            <div key={ci} className="col">
              {col.map((m, i) => (
                <div key={i} className="m">
                  {m.k === "v" ? <video src={m.u} muted playsInline autoPlay loop preload="metadata" /> : <img src={m.u} alt="" loading="lazy" />}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="front">
          <h1>
            O vídeo de hoje
            <br />
            começa com <i>uma frase</i>
          </h1>
          <p>Escreva o tema. O estúdio escreve o roteiro, desenha as cenas, anima, narra e legenda — e mostra o custo de cada passo antes de gerar.</p>
          <form
            className="start"
            onSubmit={(e) => {
              e.preventDefault();
              start(theme);
            }}
          >
            <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Sobre o que é o vídeo de hoje?" aria-label="Tema do vídeo" />
            <button type="submit">Criar roteiro</button>
          </form>
          <div className="start-hints">
            {HINTS.map((h) => (
              <button key={h} type="button" onClick={() => setTheme(h)}>
                {h}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* banners */}
      <section className="banners">
        <Link href="/projects" className="banner">
          <div className="pic">
            <img src="/art/banner-historias.jpg" alt="" />
            <div className="txt">
              <div className="display">
                Histórias que <em>vendem</em>
              </div>
            </div>
          </div>
          <b>Quadrinhos · tema → vídeo pronto</b>
          <span>Roteiro, imagens, animação, narração e legenda karaokê em um fluxo só.</span>
        </Link>
        <Link href="/clone" className="banner">
          <div className="pic">
            <img src="/art/banner-clone.jpg" alt="" />
            <div className="txt">
              <div className="display">
                Clone de <em>pessoa</em>
              </div>
            </div>
          </div>
          <b>Clone · foto + voz → falando</b>
          <span>Vídeos do expert sem gravar: voz clonada e boca sincronizada.</span>
        </Link>
        <Link href="/usage" className="banner">
          <div className="pic">
            <img src="/art/banner-modelos.jpg" alt="" />
            <div className="txt">
              <div className="display">
                {free.length} modelos <em>grátis</em>
              </div>
            </div>
          </div>
          <b>Cota grátis · cartão US$ 0</b>
          <span>Seedream, Seedance 1.0 e Seed Audio sem custo; {locked.length} modelos pagos prontos pra liberar.</span>
        </Link>
      </section>

      {/* ferramentas */}
      <section className="features">
        <Link href="/projects" className="feature big" style={{ backgroundImage: "linear-gradient(180deg, rgba(6,6,6,.15), rgba(6,6,6,.82) 70%), url(/art/tile-produza.jpg)", backgroundSize: "cover", backgroundPosition: "center" }}>
          <div className="ic">📖</div>
          <div className="display">
            Produza o vídeo de <em>hoje</em> em minutos
          </div>
          <span>Escreva o tema, revise as cenas e deixe a fábrica rodar — com o custo de cada passo na tela antes de gerar.</span>
        </Link>
        {features.slice(1).map((f) => (
          <Link key={f.title} href={f.href} className={`feature ${f.soon ? "soon" : ""}`} title={f.soon ? "em breve — veja o plano" : undefined}>
            <div className="ic">{f.ic}</div>
            <b>
              {f.title} {f.tag && <span className="pill">{f.tag}</span>} {f.soon && <span className="pill gray">em breve</span>}
            </b>
            <span>{f.desc}</span>
          </Link>
        ))}
      </section>

      {/* seus vídeos */}
      {videos.length > 0 && (
        <section style={{ display: "grid", gap: 14 }}>
          <div className="rail-head">
            <div>
              <h2>Seus vídeos</h2>
              <p>Passe o mouse pra dar play. Clique pra abrir no Vídeo.</p>
            </div>
            <Link href="/library" className="btn sm">
              Ver todos ›
            </Link>
          </div>
          <div className="rail">
            {videos.map((j) => (
              <Link key={j.id} href="/video" className="tile">
                <video src={j.output_url!} muted playsInline preload="metadata" onError={(e) => { const t = e.currentTarget.closest(".tile") as HTMLElement | null; if (t) t.style.display = "none"; }} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
                <div className="meta">
                  <span>{models.find((m) => m.id === j.request?.model)?.name ?? "vídeo"}</span>
                  <span>·</span>
                  <span>{fmtDate(j.created_at)}</span>
                </div>
                {j.request?.firstFrame && (
                  <div className="pv">
                    <img src={j.request.firstFrame} alt="" />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* projetos */}
      {projects.length > 0 && (
        <section style={{ display: "grid", gap: 14 }}>
          <div className="rail-head">
            <div>
              <h2>Quadrinhos</h2>
              <p>Seus projetos — vídeo final, cenas prontas e o que falta.</p>
            </div>
            <Link href="/projects" className="btn sm">
              Novo quadrinho ›
            </Link>
          </div>
          <div className="rail">
            {projects.map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`} className="tile">
                {p.render_url ? <video src={p.render_url} poster={p.cover_url ?? undefined} muted playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} /> : p.cover_url ? <img src={p.cover_url} alt="" /> : <div className="frame-empty">sem imagens</div>}
                <div className="over">
                  <span>{p.title}</span>
                  <span>
                    {p.ready_count}/{p.scene_count}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* imagens */}
      {images.length > 0 && (
        <section style={{ display: "grid", gap: 14 }}>
          <div className="rail-head">
            <div>
              <h2>Suas imagens</h2>
              <p>Clique pra animar, usar como referência ou melhorar.</p>
            </div>
            <Link href="/image" className="btn sm">
              Criar imagem ›
            </Link>
          </div>
          <div className="rail">
            {images.map((j) => (
              <Link key={j.id} href="/image" className="tile">
                <img src={j.output_url!} alt="" loading="lazy" onError={(e) => { const t = e.currentTarget.closest(".tile") as HTMLElement | null; if (t) t.style.display = "none"; }} />
                <div className="over">
                  <span>{models.find((m) => m.id === j.request?.model)?.name ?? "Seedream"}</span>
                  <span>{fmtDate(j.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* modelos */}
      {models.length > 0 && (
        <section style={{ display: "grid", gap: 14 }}>
          <div className="rail-head">
            <div>
              <h2>Modelos</h2>
              <p>Tudo que a G2 usa, com preço por uso. 🔒 = precisa liberar o provedor.</p>
            </div>
            <Link href="/usage" className="btn sm">
              Gastos e cotas ›
            </Link>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[...free, ...locked].map((m) => (
              <Link key={m.id} href={m.kind === "image" ? "/image" : m.kind === "audio" || m.kind === "sfx" ? "/audio" : m.kind === "avatar" || m.kind === "lipsync" ? "/clone" : m.kind === "upscale" ? "/image" : "/video"} className="chipb" title={m.locked ?? m.note} style={{ opacity: m.locked ? 0.6 : 1 }}>
                {m.locked ? "🔒 " : "✦ "}
                {m.name}
                <span className="k">{m.kind === "image" ? "imagem" : m.kind === "video" ? "vídeo" : m.kind === "audio" ? "voz" : m.kind}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
