"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError, type Me } from "@/lib/api";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/explore";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // já entrou (ou o login está desligado, como no Mac): segue direto
  useEffect(() => {
    api<Me>("/auth/me")
      .then((m) => {
        if (!m.authRequired || m.user) router.replace(next);
      })
      .catch(() => {});
  }, [next, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      location.href = next.startsWith("/") ? next : "/explore";
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Não deu pra entrar. Confira a conexão e tente de novo.");
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-mark" style={{ width: 40, height: 40 }}>
          G<sup>2</sup>
        </div>
        <div>
          <h1>Entrar no CB Studio</h1>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Use o e-mail e a senha que o admin da equipe criou pra você.
          </p>
        </div>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="login-err" role="alert">{err}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Esqueceu a senha? Peça pro admin trocar em Provedores → Equipe.
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
