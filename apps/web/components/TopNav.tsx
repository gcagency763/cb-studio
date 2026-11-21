"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, usd, type Me, type Stats } from "@/lib/api";
import { useToast } from "@/components/Toasts";

const tools = [
  { href: "/explore", label: "Explorar" },
  { href: "/image", label: "Imagem" },
  { href: "/video", label: "Vídeo" },
  { href: "/audio", label: "Áudio" },
  { sep: true },
  { href: "/projects", label: "Quadrinhos", match: /^\/projects/, tag: "Top" },
  { href: "/clone", label: "Clone" },
  { href: "/cuts", label: "Cortes", tag: "Novo" },
  { href: "/carousel", label: "Carrossel", tag: "Novo" },
  { href: "/ads", label: "Anúncios", tag: "Novo" },
  { sep: true },
  { href: "/roadmap", label: "Tudo que dá pra fazer", match: /^\/roadmap/ },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<Me>("/auth/me").then(setMe).catch(() => {});
  }, [pathname === "/login"]);
  const prevActive = useRef<number | null>(null);

  // título da aba por página
  useEffect(() => {
    const names: Record<string, string> = { "/explore": "Explorar", "/image": "Imagem", "/video": "Vídeo", "/audio": "Áudio", "/clone": "Clone", "/library": "Biblioteca", "/usage": "Gastos", "/settings": "Provedores", "/projects": "Quadrinhos", "/roadmap": "Tudo que dá pra fazer", "/cuts": "Cortes", "/ads": "Anúncios", "/carousel": "Carrossel" };
    const key = Object.keys(names).find((k) => pathname === k || (k !== "/projects" ? false : pathname.startsWith("/projects")));
    document.title = key ? `${names[key]} · CB Studio` : "CB Studio";
  }, [pathname]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Stats>("/stats")
        .then((s) => {
          if (!alive) return;
          setStats(s);
          const active = s.queued + s.running;
          // avisa quando uma geração termina (contagem de ativos caiu)
          if (prevActive.current !== null && active < prevActive.current) toast(`✓ ${prevActive.current - active} geração(ões) concluída(s)`, "ok");
          prevActive.current = active;
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  if (pathname.startsWith("/login")) return null;
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  };

  return (
    <header className="topnav">
      <Link href="/explore" className="logo" aria-label="CB Studio">
        <div className="logo-mark">
          G<sup>2</sup>
        </div>
      </Link>
      <nav className="nav-tools" aria-label="Ferramentas">
        {tools.map((t, i) => {
          if ("sep" in t) return <span key={i} className="nav-sep" />;
          const active = "match" in t && t.match ? t.match.test(pathname) : pathname === t.href;
          return (
            <Link key={t.label} href={t.href} className={`nav-tool ${active ? "active" : ""}`}>
              {t.label}
              {"tag" in t && t.tag && <span className="tag">{t.tag}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="nav-right">
        {stats && stats.queued + stats.running > 0 && (
          <span className="chip" title="gerações em andamento">
            <span className="status-dot run" /> {stats.queued + stats.running}
          </span>
        )}
        <button className="chip kbd" title="Buscar e ir para (⌘K)" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <b>⌘K</b>
        </button>
        <Link href="/settings" className="icon-btn" title="Provedores e chaves" aria-label="Provedores">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
        <Link href="/library" className="icon-btn" title="Biblioteca" aria-label="Biblioteca">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        </Link>
        <Link
          href="/usage"
          className="chip"
          title={stats ? `Hoje: ${usd(stats.todayBilledUsd ?? 0)} no cartão · ${usd(stats.todayFreeUsd ?? stats.todayCostUsd)} saíram da cota grátis (valor de tabela, não cobrado)` : "Gastos"}
        >
          cartão hoje <b>{stats ? usd(stats.todayBilledUsd ?? 0) : "…"}</b>
        </Link>
        <Link
          href="/usage"
          className="nav-cta"
          title={stats?.zeroCost === false ? "Modelos pagos liberados (ZERO_COST=false) — confira os gastos" : "Custo zero: o app recusa qualquer geração que cobraria no cartão"}
        >
          {stats?.zeroCost === false ? "Pagos liberados" : "✦ Custo zero"}
        </Link>
        {me?.user && (
          <span className="nav-user" title={`${me.user.email} · ${me.user.role === "admin" ? "admin" : "editor"}`}>
            <span className="nav-avatar" aria-hidden>
              {me.user.name.trim().charAt(0).toUpperCase()}
            </span>
            <button className="btn ghost sm" onClick={logout}>
              Sair
            </button>
          </span>
        )}
      </div>
    </header>
  );
}
