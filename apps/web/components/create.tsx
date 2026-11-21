"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, fmtDate, isActive, isDone, uploadFile, usd, type Job, type Upload } from "@/lib/api";
import { useToast } from "@/components/Toasts";

/* ───────────────────────── modelo ───────────────────────── */

export type ModelOption = {
  id: string;
  name: string;
  provider: string;
  badges: { text: string; tone?: "top" | "free" | "locked" }[];
  note?: string;
  locked?: string; // motivo de estar bloqueado (ex.: exige US$ 30)
};

export function ModelCard({ model, options, onChange }: { model: ModelOption; options: ModelOption[]; onChange: (m: ModelOption) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="model-card" onClick={() => setOpen(true)}>
        <span className="k">Modelo</span>
        <span className="v">{model.name}</span>
        <span className="badges">
          {model.badges.map((b) => (
            <span key={b.text} className={`badge ${b.tone ?? ""}`}>
              {b.text}
            </span>
          ))}
        </span>
        <span className="swap">trocar</span>
      </button>
      {open && <ModelPicker current={model.id} options={options} onClose={() => setOpen(false)} onPick={onChange} />}
    </>
  );
}

const PROVIDER_LABEL: Record<string, string> = { byteplus: "BytePlus", fal: "fal.ai", seedaudio: "Seed Audio", elevenlabs: "ElevenLabs", google: "Google" };
const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/** seletor de modelos com busca (estilo estúdio): disponíveis primeiro, travados por último com o motivo */
export function ModelPicker({ current, options, onClose, onPick }: { current: string; options: ModelOption[]; onClose: () => void; onPick: (m: ModelOption) => void }) {
  const [q, setQ] = useState("");
  const list = options.filter((m) => !q || `${m.name} ${m.note ?? ""} ${m.provider}`.toLowerCase().includes(q.toLowerCase()));
  const avail = list.filter((m) => !m.locked);
  const locked = list.filter((m) => m.locked);
  const Item = (m: ModelOption) => (
    <button
      key={m.id}
      type="button"
      className={`list-item ${m.id === current ? "active" : ""}`}
      disabled={!!m.locked}
      title={m.locked}
      onClick={() => {
        onPick(m);
        onClose();
      }}
    >
      <span className={`ic ${m.provider}`}>{initials(m.name)}</span>
      <span className="t">
        <b>
          {m.name}{" "}
          {m.badges.slice(0, 3).map((b) => (
            <span key={b.text} className={`badge ${b.tone ?? ""}`} style={{ marginLeft: 4 }}>
              {b.text}
            </span>
          ))}
        </b>
        <span>{m.locked ?? m.note ?? PROVIDER_LABEL[m.provider] ?? m.provider}</span>
      </span>
    </button>
  );
  return (
    <Modal title="Escolher modelo" onClose={onClose} className="picker" bare>
      <div className="search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input autoFocus placeholder="Buscar modelo…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost sm" onClick={onClose}>
          Fechar
        </button>
      </div>
      <div className="items">
        {avail.length > 0 && <div className="grp">✦ Disponíveis agora</div>}
        {avail.map(Item)}
        {locked.length > 0 && <div className="grp">🔒 Precisam de liberação (o motivo está em cada um)</div>}
        {locked.map(Item)}
        {list.length === 0 && <div className="muted" style={{ padding: 16 }}>Nenhum modelo com esse nome.</div>}
      </div>
    </Modal>
  );
}

/* ───────────────────────── modal ───────────────────────── */

export function Modal({ title, onClose, children, className, bare }: { title: string; onClose: () => void; children: ReactNode; className?: string; bare?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (typeof document === "undefined") return null;
  // portal: o painel lateral é sticky/overflow e "prende" o position:fixed
  return createPortal(
    <div className="modal-bg" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
        {!bare && (
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="btn ghost sm" onClick={onClose} aria-label="Fechar">
              Fechar
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  , document.body);
}

/* ───────────────────────── referência (upload / biblioteca) ───────────────────────── */

export function ReferencePicker({
  kind,
  label,
  value,
  onChange,
  accept,
  hint,
}: {
  kind: "image" | "video" | "audio";
  label: string;
  value?: string | null;
  onChange: (url: string | null) => void;
  accept?: string;
  hint?: string;
}) {
  const toast = useToast();
  const [lib, setLib] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setPct(0);
    try {
      const u = await uploadFile(f, setPct);
      onChange(u.url);
      toast(`${f.name} enviado`);
    } catch (e: any) {
      toast(e.message, "bad");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div
        className="dropzone"
        onClick={() => !value && fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          <>
            {kind === "image" && (
              <div className="thumb">
                <img src={value} alt="" />
              </div>
            )}
            {kind === "video" && (
              <div className="thumb">
                <video src={value} muted loop autoPlay playsInline />
              </div>
            )}
            {kind === "audio" && <audio className="player" src={value} controls />}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn ghost sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                }}
              >
                Remover
              </button>
              <button
                className="btn ghost sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setLib(true);
                }}
              >
                Trocar
              </button>
            </div>
          </>
        ) : (
          <>
            <b>{busy ? `Enviando… ${pct}%` : "Solte um arquivo ou clique"}</b>
            <span>{hint ?? "ou escolha da biblioteca"}</span>
            <button
              className="btn ghost sm"
              onClick={(e) => {
                e.stopPropagation();
                setLib(true);
              }}
            >
              Biblioteca
            </button>
          </>
        )}
        <input ref={fileRef} type="file" accept={accept ?? `${kind}/*`} hidden onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {lib && (
        <LibraryPicker
          kind={kind}
          onPick={(url) => {
            onChange(url);
            setLib(false);
          }}
          onClose={() => setLib(false)}
        />
      )}
    </div>
  );
}

export function LibraryPicker({ kind, onPick, onClose }: { kind: "image" | "video" | "audio"; onPick: (url: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"generated" | "uploads">("generated");
  const [data, setData] = useState<{ generated: Job[]; uploads: Upload[] } | null>(null);
  useEffect(() => {
    api<{ generated: Job[]; uploads: Upload[] }>(`/library?kind=${kind}`).then(setData).catch(() => setData({ generated: [], uploads: [] }));
  }, [kind]);
  const items = tab === "generated" ? (data?.generated ?? []).map((j) => ({ id: j.id, url: j.output_url!, label: fmtDate(j.created_at) })) : (data?.uploads ?? []).map((u) => ({ id: u.id, url: u.url, label: u.name }));
  return (
    <Modal title="Biblioteca" onClose={onClose}>
      <div className="seg">
        <button className={tab === "generated" ? "active" : ""} onClick={() => setTab("generated")}>
          Gerados
        </button>
        <button className={tab === "uploads" ? "active" : ""} onClick={() => setTab("uploads")}>
          Enviados
        </button>
      </div>
      {!data ? (
        <div className="muted">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          <b>Nada aqui ainda</b>
          {tab === "generated" ? "Gere algo e ele aparece aqui." : "Envie um arquivo pela área de referência."}
        </div>
      ) : (
        <div className="masonry">
          {items.map((it) => (
            <button key={it.id} className={`tile ${kind === "audio" ? "audio" : ""}`} onClick={() => onPick(it.url)} style={{ border: 0, padding: 0 }}>
              <Media kind={kind} url={it.url} />
              <div className="over">
                <span>{it.label}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function Media({ kind, url }: { kind: "image" | "video" | "audio" | "render"; url: string }) {
  if (kind === "image") return <img src={url} alt="" />;
  if (kind === "audio") return <Wave />;
  return <video src={url} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />;
}

export function Wave() {
  const bars = Array.from({ length: 36 }, (_, i) => 20 + Math.abs(Math.sin(i * 0.9) * 60 + Math.cos(i * 2.3) * 20));
  return (
    <div className="wave" aria-hidden>
      {bars.map((h, i) => (
        <i key={i} style={{ height: `${Math.min(100, h)}%` }} />
      ))}
    </div>
  );
}

/* ───────────────────────── histórico ───────────────────────── */

export function History({
  kind,
  refreshKey,
  onSelect,
  actions,
  title = "Histórico",
  empty,
  before,
  tileInfo,
}: {
  /** "clone" = pessoas falando (avatar + lipsync); "cuts" = cortes e vídeos legendados — ambos mostrados como vídeo */
  kind: "image" | "video" | "audio" | "clone" | "cuts" | "carousel";
  refreshKey: number;
  onSelect?: (j: Job) => void;
  actions?: (j: Job) => ReactNode;
  title?: string;
  /** estado vazio próprio (substitui o padrão) */
  empty?: ReactNode;
  /** conteúdo acima da lista (cabeçalho com arte, passos…) */
  before?: ReactNode;
  /** texto do canto do tile (padrão: data · custo) */
  tileInfo?: (j: Job) => ReactNode;
}) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const media: "image" | "video" | "audio" = kind === "clone" || kind === "cuts" ? "video" : kind === "carousel" ? "image" : kind;

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ generated: Job[] }>(`/library?kind=${kind}`)
        .then((r) => alive && setJobs(r.generated))
        .catch(() => alive && setJobs([]));
    load();
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [kind, refreshKey]);

  return (
    <section className="area">
      {before}
      <div className="area-head">
        <h2>{title}</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          {jobs?.length ?? 0} {kind === "image" ? "imagens" : kind === "video" ? "vídeos" : kind === "clone" ? "vídeos de pessoas" : kind === "cuts" ? "clipes" : "áudios"}
        </span>
      </div>
      {!jobs ? (
        <div className="muted">Carregando…</div>
      ) : jobs.length === 0 ? (
        empty ?? (
          <div className="empty">
            <b>Suas gerações aparecem aqui</b>
            Preencha o painel ao lado e clique em Gerar.
          </div>
        )
      ) : (
        <div className="masonry">
          {jobs.map((j) => (
            <div
              key={j.id}
              className={`tile ${media === "audio" ? "audio" : ""} ${isActive(j) ? "pending" : j.status === "failed" ? "failed" : ""}`}
              onClick={() => (onSelect ? onSelect(j) : setSelected(j))}
              role="button"
              tabIndex={0}
            >
              {isDone(j) ? <Media kind={media} url={j.output_url!} /> : isActive(j) ? "gerando…" : j.error?.slice(0, 120)}
              {isDone(j) && (
                <div className="over">
                  {tileInfo ? (
                    tileInfo(j)
                  ) : (
                    <>
                      <span>{fmtDate(j.created_at)}</span>
                      <span>{usd(j.estimated_cost_usd)}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {selected && (
        <Modal title={kind === "image" ? "Imagem" : kind === "video" ? "Vídeo" : kind === "clone" ? "Pessoa falando" : kind === "cuts" ? "Corte" : "Áudio"} onClose={() => setSelected(null)}>
          <div style={{ display: "grid", gridTemplateColumns: media === "audio" ? "1fr" : "minmax(0,1fr) 260px", gap: 16 }}>
            <div style={{ background: "#000", borderRadius: 10, overflow: "hidden", display: "grid", placeItems: "center", minHeight: 200 }}>
              {media === "image" && <img src={selected.output_url!} alt="" style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }} />}
              {media === "video" && <video src={selected.output_url!} controls autoPlay style={{ maxWidth: "100%", maxHeight: "70vh" }} />}
              {media === "audio" && <audio className="player" src={selected.output_url!} controls autoPlay style={{ margin: 16 }} />}
            </div>
            <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
              <div className="muted" style={{ fontSize: 12 }}>
                {fmtDate(selected.created_at)} · {usd(selected.estimated_cost_usd)}
              </div>
              {selected.request?.prompt && <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{selected.request.prompt}</div>}
              {selected.request?.text && <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{selected.request.text}</div>}
              <a className="btn" href={selected.output_url!} download>
                Baixar
              </a>
              {actions?.(selected)}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
