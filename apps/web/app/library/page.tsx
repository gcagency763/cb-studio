"use client";

import { useEffect, useState } from "react";
import { api, fmtDate, usd, type Job, type Upload } from "@/lib/api";
import { Media, Modal } from "@/components/create";

type Kind = "image" | "video" | "clone" | "cuts" | "audio" | "render" | "uploads";
const TABS: { id: Kind; label: string }[] = [
  { id: "image", label: "Imagens" },
  { id: "video", label: "Vídeos" },
  { id: "clone", label: "Pessoas" },
  { id: "cuts", label: "Cortes" },
  { id: "audio", label: "Áudios" },
  { id: "render", label: "Vídeos finais" },
  { id: "uploads", label: "Enviados" },
];
/** como cada tipo é exibido */
const MEDIA: Record<Kind, "image" | "video" | "audio" | "render"> = { image: "image", video: "video", clone: "video", cuts: "video", audio: "audio", render: "render", uploads: "image" };

export default function LibraryPage() {
  const [tab, setTab] = useState<Kind>("image");
  const [gen, setGen] = useState<Job[]>([]);
  const [ups, setUps] = useState<Upload[]>([]);
  const [sel, setSel] = useState<{ kind: Kind; url: string; meta: string } | null>(null);

  useEffect(() => {
    const q = tab === "uploads" ? "" : `?kind=${tab}`;
    api<{ generated: Job[]; uploads: Upload[] }>(`/library${q}`)
      .then((r) => {
        setGen(r.generated);
        setUps(r.uploads);
      })
      .catch(() => {});
  }, [tab]);

  const items =
    tab === "uploads"
      ? ups.map((u) => ({ id: u.id, kind: u.kind as Kind, url: u.url, meta: u.name, sub: fmtDate(u.created_at) }))
      : gen.map((j) => ({ id: j.id, kind: tab, url: j.output_url!, meta: fmtDate(j.created_at), sub: usd(j.estimated_cost_usd) }));

  return (
    <div className="page-pad" style={{ display: "grid", gap: 16 }}>
      <div className="area-head">
        <h1 className="page" style={{ margin: 0 }}>
          Biblioteca
        </h1>
        <div className="seg">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <div className="empty">
          <b>Nada aqui ainda</b>
          Tudo o que você gerar ou enviar fica guardado aqui.
        </div>
      ) : (
        <div className="masonry">
          {items.map((it) => (
            <div key={it.id} className={`tile ${it.kind === "audio" ? "audio" : ""}`} onClick={() => setSel({ kind: it.kind, url: it.url, meta: it.meta })} role="button" tabIndex={0}>
              <Media kind={MEDIA[it.kind] ?? "image"} url={it.url} />
              <div className="over">
                <span>{it.meta}</span>
                <span>{it.sub}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {sel && (
        <Modal title={sel.meta} onClose={() => setSel(null)}>
          <div style={{ background: "#000", borderRadius: 10, overflow: "hidden", display: "grid", placeItems: "center", minHeight: 200 }}>
            {sel.kind === "image" && <img src={sel.url} alt="" style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }} />}
            {(sel.kind === "video" || sel.kind === "clone" || sel.kind === "cuts" || sel.kind === "render") && <video src={sel.url} controls autoPlay style={{ maxWidth: "100%", maxHeight: "70vh" }} />}
            {sel.kind === "audio" && <audio className="player" src={sel.url} controls autoPlay style={{ margin: 16 }} />}
          </div>
          <a className="btn" href={sel.url} download style={{ justifySelf: "start" }}>
            Baixar
          </a>
        </Modal>
      )}
    </div>
  );
}
