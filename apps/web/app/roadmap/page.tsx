"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";

type Status = "pronto" | "em-breve" | "planejado" | "ideia";
type Area = "quadrinhos" | "imagem" | "video" | "audio" | "clone" | "edicao" | "anuncios" | "publicar" | "controle";
type Cap = { id: string; title: string; desc: string; area: Area; status: Status; href?: string; via?: string; from?: string[]; cost?: string; phase?: 1 | 2 | 3; mcp?: string };
type Data = { areas: Record<Area, { label: string; desc: string }>; statusLabel: Record<Status, string>; counts: Record<Status, number>; items: Cap[] };

const ORDER: Status[] = ["pronto", "em-breve", "planejado", "ideia"];
const PHASE: Record<number, string> = { 1: "próximo sprint · grátis", 2: "precisa de provedor pago", 3: "longo prazo" };

/** Tudo que dá pra fazer: o que está pronto, o que vem e de onde veio cada ideia. */
export default function RoadmapPage() {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<Status | "all">("all");
  const [area, setArea] = useState<Area | "all">("all");
  useEffect(() => {
    api<Data>("/capabilities").then(setData).catch(() => {});
    if (typeof window !== "undefined" && window.location.hash) setStatus("all");
  }, []);

  const items = useMemo(() => (data?.items ?? []).filter((c) => (status === "all" || c.status === status) && (area === "all" || c.area === area)), [data, status, area]);
  const areas = useMemo(() => (data ? (Object.keys(data.areas) as Area[]).filter((a) => items.some((c) => c.area === a)) : []), [data, items]);

  if (!data) return <div className="page-pad muted">Carregando…</div>;
  const total = data.items.length;

  return (
    <div className="page-pad roadmap">
      <header className="rm-head">
        <div>
          <h1 className="display">
            Tudo que <em>dá pra fazer</em>
          </h1>
          <p>
            {data.counts.pronto} coisas prontas hoje, {data.counts["em-breve"]} no próximo sprint, {data.counts.planejado + data.counts.ideia} mapeadas do Higgsfield e das outras plataformas — cada uma com a rota no app, como é feita, quanto custa e a ferramenta do Claude que cobre.
          </p>
        </div>
        <div className="rm-counts">
          {ORDER.map((s) => (
            <button key={s} className={`rm-count ${s} ${status === s ? "active" : ""}`} onClick={() => setStatus(status === s ? "all" : s)}>
              <b>{data.counts[s]}</b>
              <span>{data.statusLabel[s]}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="rm-filters">
        <button className={`chipb ${area === "all" ? "active" : ""}`} onClick={() => setArea("all")}>
          Todas as áreas · {status === "all" ? total : data.counts[status]}
        </button>
        {(Object.keys(data.areas) as Area[]).map((a) => (
          <button key={a} className={`chipb ${area === a ? "active" : ""}`} onClick={() => setArea(area === a ? "all" : a)} title={data.areas[a].desc}>
            {data.areas[a].label}
          </button>
        ))}
      </div>

      {areas.map((a) => (
        <section key={a} className="rm-area" id={`area-${a}`}>
          <div className="rm-area-head">
            <h2>{data.areas[a].label}</h2>
            <span>{data.areas[a].desc}</span>
          </div>
          <div className="rm-grid">
            {items
              .filter((c) => c.area === a)
              .sort((x, y) => ORDER.indexOf(x.status) - ORDER.indexOf(y.status))
              .map((c) => (
                <article key={c.id} id={c.id} className={`rm-card ${c.status}`}>
                  <div className="rm-card-top">
                    <span className={`pill ${c.status}`}>{data.statusLabel[c.status]}</span>
                    {c.phase && c.status !== "pronto" && <span className="muted">{PHASE[c.phase]}</span>}
                  </div>
                  <h3>{c.title}</h3>
                  <p>{c.desc}</p>
                  <dl>
                    {c.via && (
                      <>
                        <dt>como</dt>
                        <dd>{c.via}</dd>
                      </>
                    )}
                    {c.cost && (
                      <>
                        <dt>custo</dt>
                        <dd>{c.cost}</dd>
                      </>
                    )}
                    {c.mcp && (
                      <>
                        <dt>Claude</dt>
                        <dd>
                          <code>{c.mcp}</code>
                        </dd>
                      </>
                    )}
                  </dl>
                  {(c.from?.length || c.href) && (
                    <div className="rm-card-foot">
                      <div className="rm-from">
                        {c.from?.map((f) => (
                          <span key={f}>{f}</span>
                        ))}
                      </div>
                      {c.href && c.status === "pronto" && (
                        <Link href={c.href} className="btn sm">
                          Abrir ›
                        </Link>
                      )}
                    </div>
                  )}
                </article>
              ))}
          </div>
        </section>
      ))}

      <section className="rm-mcp">
        <div>
          <h2 className="display">
            Controle tudo isso <em>pelo Claude</em>
          </h2>
          <p>O CB Studio tem um MCP: no Claude Desktop, Claude Code ou Cowork você pede “faz um quadrinho sobre X com a voz do Cirilo” e ele cria, gera, monta e manda o MP4 — perguntando antes de qualquer custo no cartão.</p>
        </div>
        <Link href="/settings#mcp" className="btn primary">
          Conectar ao Claude ›
        </Link>
      </section>
    </div>
  );
}
