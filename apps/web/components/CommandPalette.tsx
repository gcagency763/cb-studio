"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api, type ProjectSummary } from "@/lib/api";
import { loadModels, type CatalogModel } from "@/lib/models";

type Cmd = { id: string; label: string; hint?: string; group: string; run: () => void; keywords?: string };

/** ⌘K / Ctrl+K: ir pra qualquer lugar, abrir um projeto, escolher um modelo */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [models, setModels] = useState<CatalogModel[]>([]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setI(0);
    api<{ projects: ProjectSummary[] }>("/projects").then((r) => setProjects(r.projects.slice(0, 20))).catch(() => {});
    loadModels().then(setModels).catch(() => {});
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const cmds: Cmd[] = useMemo(
    () => [
      { id: "new", label: "Novo quadrinho", hint: "tema → roteiro → vídeo", group: "Criar", run: () => go("/projects?novo=1"), keywords: "projeto roteiro" },
      { id: "img", label: "Criar imagem", group: "Criar", run: () => go("/image"), keywords: "seedream nano banana gpt" },
      { id: "vid", label: "Criar vídeo", group: "Criar", run: () => go("/video"), keywords: "seedance kling" },
      { id: "aud", label: "Gerar narração", group: "Criar", run: () => go("/audio"), keywords: "voz tts" },
      { id: "voice", label: "Clonar uma voz", group: "Criar", run: () => go("/audio"), keywords: "voz clone" },
      { id: "clone", label: "Clone de pessoa (foto + voz)", group: "Criar", run: () => go("/clone"), keywords: "avatar lipsync" },
      { id: "cuts", label: "Cortes de vídeo longo", hint: "aula → cortes virais legendados", group: "Criar", run: () => go("/cuts"), keywords: "cortes legenda transcrição shorts reels" },
      { id: "ads", label: "Anúncios em escala", hint: "produto + ganchos → campanha de quadrinhos", group: "Criar", run: () => go("/ads"), keywords: "anúncios campanha ganchos lote meta ads" },
      { id: "caption", label: "Legendar um vídeo", hint: "legenda karaokê automática", group: "Criar", run: () => go("/cuts"), keywords: "legenda karaokê whisper" },
      { id: "dub", label: "Dublar um vídeo", hint: "inglês, espanhol… com a sua voz", group: "Criar", run: () => go("/cuts?tab=dub"), keywords: "dublagem dublar tradução inglês espanhol voz" },
      { id: "carousel", label: "Carrossel pro Instagram", hint: "tema → slides com arte e texto", group: "Criar", run: () => go("/carousel"), keywords: "carrossel instagram slides post imagem" },
      { id: "explore", label: "Explorar", group: "Ir para", run: () => go("/explore") },
      { id: "lib", label: "Biblioteca", group: "Ir para", run: () => go("/library") },
      { id: "usage", label: "Gastos e cotas", group: "Ir para", run: () => go("/usage"), keywords: "custo cartão" },
      { id: "settings", label: "Provedores e chaves", group: "Ir para", run: () => go("/settings"), keywords: "fal byteplus elevenlabs env" },
      { id: "roadmap", label: "Tudo que dá pra fazer", hint: "pronto · em breve · ideias do Higgsfield e cia", group: "Ir para", run: () => go("/roadmap"), keywords: "roadmap capacidades recursos shorts cortes anúncios publicar" },
      { id: "mcp", label: "Controlar pelo Claude (MCP)", hint: "conectar ao Claude Desktop / Code", group: "Ir para", run: () => go("/settings#mcp"), keywords: "mcp claude agente" },
      ...projects.map((p) => ({ id: `p-${p.id}`, label: p.title, hint: p.render_url ? "vídeo final pronto" : `${p.ready_count}/${p.scene_count} cenas`, group: "Projetos", run: () => go(`/projects/${p.id}`) })),
      ...models.map((m) => ({
        id: `m-${m.id}`,
        label: m.name,
        hint: m.locked ? "🔒 " + m.locked.split("→")[0] : (m.note ?? "").slice(0, 60),
        group: "Modelos",
        run: () => go(m.kind === "image" || m.kind === "upscale" ? "/image" : m.kind === "audio" || m.kind === "sfx" ? "/audio" : m.kind === "avatar" || m.kind === "lipsync" ? "/clone" : "/video"),
        keywords: m.kind,
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, models],
  );
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = s ? cmds.filter((c) => `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""} ${c.group}`.toLowerCase().includes(s)) : cmds.filter((c) => c.group !== "Modelos");
    return all.slice(0, 14);
  }, [cmds, q]);

  useEffect(() => setI(0), [q]);
  if (!open || typeof document === "undefined") return null;

  const groups = Array.from(new Set(list.map((c) => c.group)));
  return createPortal(
    <div className="modal-bg" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Comandos" style={{ alignItems: "start", paddingTop: "12vh" }}>
      <div className="modal picker" onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 100%)" }}>
        <div className="search">
          <span className="muted">⌘K</span>
          <input
            autoFocus
            placeholder="Ir para, criar, abrir projeto, escolher modelo…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setI((x) => Math.min(list.length - 1, x + 1));
              if (e.key === "ArrowUp") setI((x) => Math.max(0, x - 1));
              if (e.key === "Enter") list[i]?.run();
            }}
          />
        </div>
        <div className="items">
          {groups.map((g) => (
            <div key={g}>
              <div className="grp">{g}</div>
              {list
                .filter((c) => c.group === g)
                .map((c) => {
                  const idx = list.indexOf(c);
                  return (
                    <button key={c.id} className={`list-item ${idx === i ? "active" : ""}`} onMouseEnter={() => setI(idx)} onClick={c.run}>
                      <span className="t">
                        <b>{c.label}</b>
                        {c.hint && <span>{c.hint}</span>}
                      </span>
                      {idx === i && <span className="muted" style={{ fontSize: 11 }}>↵</span>}
                    </button>
                  );
                })}
            </div>
          ))}
          {list.length === 0 && <div className="muted" style={{ padding: 16 }}>Nada encontrado.</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
