"use client";

import { useEffect, useState } from "react";
import { api, fmtDate, usd } from "@/lib/api";

type Usage = {
  days: { day: string; usd: number; jobs: number }[];
  months: { month: string; usd: number; jobs: number }[];
  byModel: { provider: string; kind: string; model: string | null; name: string; jobs: number; usd: number; seconds: number; monthUsd: number; monthJobs: number; billed: boolean }[];
  recent: { id: string; kind: string; provider: string; model: string | null; name: string; usd: number; created_at: string; project_id: string | null }[];
  quotas: { id: string; name: string; unit: string; used: number; free: number; pctUsed: number; lockAt?: number }[];
  billedUsd: number;
  billedMonthUsd: number;
  nominalMonthUsd: number;
  voiceFreeMinutes: number;
  maxJobCostUsd: number;
  providers: { byteplus: boolean; seedaudio: boolean; fal: boolean; seedance2: boolean };
};

const BRL = 5.58; // dólar aproximado (nov/2026) — só pra leitura rápida
const brl = (v: number) => `R$ ${(v * BRL).toFixed(2).replace(".", ",")}`;
const KIND: Record<string, string> = { image: "imagem", video: "vídeo", audio: "voz", avatar: "clone", upscale: "upscale", lipsync: "lip-sync", sfx: "efeito" };
const PROV: Record<string, string> = { byteplus: "BytePlus", fal: "fal.ai", seedaudio: "Seed Audio", elevenlabs: "ElevenLabs" };

export default function UsagePage() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    const load = () => api<Usage>("/usage").then(setU).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!u) return <div className="page-pad muted">Carregando…</div>;
  const month = new Date().toISOString().slice(0, 7);
  const thisMonth = u.months.find((m) => m.month === month) ?? { month, usd: 0, jobs: 0 };
  const maxDay = Math.max(0.01, ...u.days.map((d) => d.usd));
  // últimos 30 dias, preenchendo vazios
  const days: { day: string; usd: number; jobs: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push(u.days.find((x) => x.day === d) ?? { day: d, usd: 0, jobs: 0 });
  }

  return (
    <div className="page-pad" style={{ display: "grid", gap: 20, maxWidth: 1100 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Gastos</h1>
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          Preço de tabela de cada geração × o que sai do cartão de verdade. BytePlus está em modo &quot;só crédito grátis&quot; e o Seed Audio tem 60 min grátis — por isso o cobrado fica em zero até você liberar um provedor pago.
        </p>
      </div>

      <div className="kpis">
        <Kpi label="Cobrado no cartão (mês)" value={usd(u.billedMonthUsd)} sub={brl(u.billedMonthUsd)} tone={u.billedMonthUsd > 0 ? "warn" : "ok"} />
        <Kpi label="Cobrado no cartão (total)" value={usd(u.billedUsd)} sub={brl(u.billedUsd)} tone={u.billedUsd > 0 ? "warn" : "ok"} />
        <Kpi label="Valor de tabela (mês)" value={usd(thisMonth.usd)} sub={`${thisMonth.jobs} gerações · ${brl(thisMonth.usd)}`} />
        <Kpi label="Se fosse no Higgsfield" value={usd(thisMonth.usd * 1.35)} sub="≈ +35% nos mesmos modelos" />
      </div>

      <section className="area">
        <div className="area-head">
          <h2>Cotas grátis</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            quando acabam, os modelos pausam (BytePlus) ou a trava do app segura (voz: {u.voiceFreeMinutes} min)
          </span>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {u.quotas.map((q) => (
            <div key={q.id} style={{ display: "grid", gridTemplateColumns: "220px 1fr 160px", gap: 12, alignItems: "center", fontSize: 13 }}>
              <b>{q.name}</b>
              <div className="bar">
                <span style={{ width: `${q.pctUsed}%` }} className={q.pctUsed > 85 ? "hot" : ""} />
              </div>
              <span className="muted">
                {fmt(q.used)} / {fmt(q.free)} {q.unit} ({Math.round(q.pctUsed)}%)
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="area">
        <div className="area-head">
          <h2>Por dia (30 dias, valor de tabela)</h2>
          <span className="muted" style={{ fontSize: 12 }}>passe o mouse pra ver o dia</span>
        </div>
        <div className="spark">
          {days.map((d) => (
            <div key={d.day} className="col" title={`${d.day.slice(8)}/${d.day.slice(5, 7)} · ${usd(d.usd)} · ${d.jobs} gerações`}>
              <span style={{ height: `${Math.max(2, (d.usd / maxDay) * 100)}%` }} className={d.usd === 0 ? "zero" : ""} />
            </div>
          ))}
        </div>
      </section>

      <section className="area">
        <div className="area-head">
          <h2>Por modelo</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Tipo</th>
              <th>Provedor</th>
              <th className="r">Gerações (mês)</th>
              <th className="r">Tabela (mês)</th>
              <th className="r">Tabela (total)</th>
              <th className="r">Cobra?</th>
            </tr>
          </thead>
          <tbody>
            {u.byModel.map((m, i) => (
              <tr key={i}>
                <td>{m.name}</td>
                <td>{KIND[m.kind] ?? m.kind}</td>
                <td>{PROV[m.provider] ?? m.provider}</td>
                <td className="r">
                  {m.monthJobs} <span className="muted">/ {m.jobs}</span>
                </td>
                <td className="r">{usd(m.monthUsd)}</td>
                <td className="r">{usd(m.usd)}</td>
                <td className="r">{m.billed ? <span className="badge locked">cartão</span> : <span className="badge free">grátis</span>}</td>
              </tr>
            ))}
            {u.byModel.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Nada gerado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="area">
        <div className="area-head">
          <h2>Por mês</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="r">Gerações</th>
              <th className="r">Valor de tabela</th>
              <th className="r">em reais</th>
            </tr>
          </thead>
          <tbody>
            {u.months.map((m) => (
              <tr key={m.month}>
                <td>{m.month}</td>
                <td className="r">{m.jobs}</td>
                <td className="r">{usd(m.usd)}</td>
                <td className="r">{brl(m.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="area">
        <div className="area-head">
          <h2>Últimas gerações</h2>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Modelo</th>
              <th>Tipo</th>
              <th className="r">Tabela</th>
            </tr>
          </thead>
          <tbody>
            {u.recent.map((r) => (
              <tr key={r.id}>
                <td className="muted">{fmtDate(r.created_at)}</td>
                <td>{r.name}</td>
                <td>{KIND[r.kind] ?? r.kind}</td>
                <td className="r">{usd(r.usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="area">
        <div className="area-head">
          <h2>Provedores</h2>
        </div>
        <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
          <Row ok={u.providers.byteplus} label="BytePlus ModelArk (Seedream, Seedance 1.0)" note="cota grátis · modo só crédito grátis" />
          <Row ok={u.providers.seedance2} label="Seedance 2.x (2.5 / 2.0)" note="exige fundo de reserva US$ 30 → ARK_ALLOW_SEEDANCE_2=true" />
          <Row ok={u.providers.seedaudio} label="Seed Audio (voz, clonagem)" note="60 min grátis · depois US$ 0,15/min · trava do app em 55 min" />
          <Row ok={u.providers.fal} label="fal.ai (Kling, GPT Image, Nano Banana, Grok, upscale, avatar, lipsync)" note="pré-pago, mínimo US$ 10 → FAL_KEY" />
        </div>
      </section>
    </div>
  );
}

const fmt = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(0)}k` : n % 1 ? n.toFixed(1) : String(n));

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub && <span className="s">{sub}</span>}
    </div>
  );
}

function Row({ ok, label, note }: { ok: boolean; label: string; note: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <span className={`status-dot ${ok ? "ok" : ""}`} />
      <b style={{ minWidth: 320 }}>{label}</b>
      <span className="muted">{ok ? "ativo" : "não configurado"} · {note}</span>
    </div>
  );
}
