"use client";

import { useEffect, useState } from "react";
import { api, uploadFile, usd, type Me, type TeamUser } from "@/lib/api";
import { useToast } from "@/components/Toasts";
import { loadModels, type CatalogModel } from "@/lib/models";

type Usage = { providers: { byteplus: boolean; seedaudio: boolean; fal: boolean; seedance2: boolean; elevenlabs?: boolean; gpu?: boolean; instagram?: boolean; metaAds?: boolean; youtube?: boolean }; voiceFreeMinutes: number; maxJobCostUsd: number };

const PROVIDERS = [
  {
    id: "byteplus",
    name: "BytePlus ModelArk",
    what: "Seedream (imagem) e Seedance 1.0 (vídeo) — cota grátis, modo “só crédito grátis” ligado: quando acaba, os modelos pausam, nada vai pro cartão.",
    cost: "US$ 0 (cota grátis)",
    env: "ARK_API_KEY",
    steps: ["console.byteplus.com → ModelArk → API Keys", "copie a chave e cole no .env como ARK_API_KEY=…", "duplo clique em Iniciar CB Studio.command"],
    link: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey",
    key: "byteplus" as const,
  },
  {
    id: "seedance2",
    name: "Seedance 2.5 / 2.0 (BytePlus)",
    what: "Fala com boca sincronizada, áudio nativo, até 30 s. É o motor do Cinema Studio do Higgsfield — 27% mais barato por API.",
    cost: "fundo de reserva de US$ 30 (vira saldo, consumido por uso: 5 s em 1080p ≈ US$ 2,84)",
    env: "ARK_ALLOW_SEEDANCE_2=true",
    steps: ["console.byteplus.com → Billing → Reserve fund → US$ 30", "ModelArk → Model activation → ative dreamina-seedance-2-5", "no .env: ARK_ALLOW_SEEDANCE_2=true e reinicie"],
    link: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement",
    key: "seedance2" as const,
  },
  {
    id: "seedaudio",
    name: "Seed Audio (BytePlus Seed Speech)",
    what: "Narração em português e clonagem de voz. 60 min grátis; depois US$ 0,15/min — o app trava em 55 min (VOICE_FREE_MINUTES) pra não cobrar.",
    cost: "US$ 0 até 60 min · depois US$ 0,15/min",
    env: "SEED_SPEECH_API_KEY",
    steps: ["console.byteplus.com/voice → API Key → criar", "duplo clique em Configurar Voz.command e cole a chave"],
    link: "https://console.byteplus.com/voice/new/setting/apikeys?projectName=default",
    key: "seedaudio" as const,
  },
  {
    id: "fal",
    name: "fal.ai",
    what: "MiniMax H3 e H3 Max (o motor padrão de vídeo: nível Seedance 2.5, US$ 0,30 por plano de 5 s), Kling 2.5 turbo / 2.6 / 3.0 / 3.0 turbo / 4.0, GPT Image 2.5 Sunburst e 2.6, Nano Banana 2.1, Grok Imagine, upscale estilo Magnific, OmniHuman / Kling Avatar (clone), Sync Lipsync.",
    cost: "pré-pago, mínimo US$ 10 de crédito (≈ 33 planos de 5 s no MiniMax H3 ou 160 imagens Nano Banana 2.1)",
    env: "FAL_KEY",
    steps: ["fal.ai → Billing → add credits (US$ 10) com o cartão", "fal.ai → Keys → create key", "no .env: FAL_KEY=… e reinicie"],
    link: "https://fal.ai/dashboard/keys",
    key: "fal" as const,
  },
  {
    id: "gpu",
    name: "GPU própria (Modal)",
    what: "Modelos abertos numa GPU alugada por segundo (liga quando você gera, desliga sozinha): Wan 2.2 (~US$ 0,14 por plano de 5 s) e, experimental, o MiniMax H3 em 4× H100 (Ligar H3.command).",
    cost: "por segundo de GPU · o Modal dá US$ 30/mês grátis (≈ 200 planos) — ponha um limite de gasto no Modal",
    env: "G2_GPU_URL + G2_GPU_TOKEN",
    steps: ["modal.com → criar conta → Settings → Usage → limite de gasto (ex.: US$ 30)", "duplo clique em infra/gpu/Ligar GPU.command (faz login, baixa o modelo e publica)", "ele escreve G2_GPU_URL e G2_GPU_TOKEN no .env — reinicie o CB Studio"],
    link: "https://modal.com/settings",
    key: "gpu" as const,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    what: "O narrador v4 de todos os vídeos no Higgsfield, clonagem instantânea de voz e efeitos sonoros (o papel do Mirelo).",
    cost: "plano Starter US$ 5/mês (libera clonagem) · ~US$ 0,30 por 1k caracteres",
    env: "ELEVENLABS_API_KEY",
    steps: ["elevenlabs.io → Subscription → Starter", "Profile → API Keys → create", "no .env: ELEVENLABS_API_KEY=… (opcional ELEVENLABS_VOICE_ID) e reinicie"],
    link: "https://elevenlabs.io/app/settings/api-keys",
    key: "elevenlabs" as const,
  },
];

export default function SettingsPage() {
  const [u, setU] = useState<Usage | null>(null);
  const [models, setModels] = useState<CatalogModel[]>([]);
  useEffect(() => {
    api<Usage>("/usage").then(setU).catch(() => {});
    loadModels().then(setModels).catch(() => {});
  }, []);
  const active = (k: keyof Usage["providers"]) => !!u?.providers[k];

  return (
    <div className="page-pad" style={{ display: "grid", gap: 22, maxWidth: 1000 }}>
      <div>
        <h1 className="page" style={{ margin: 0 }}>
          Provedores
        </h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          O que está ligado, o que cada um libera e o passo a passo pra ativar. Chaves ficam só no seu <code>.env</code> — o app nunca mostra nem envia pra lugar nenhum.
        </p>
      </div>

      <div className="prov-grid">
        {PROVIDERS.map((p) => {
          const on = active(p.key);
          const unlocks = models.filter((m) => (p.key === "gpu" ? m.provider === "gpu" : p.key === "fal" ? m.provider === "fal" : p.key === "seedance2" ? m.gate === "reserve" : p.key === "elevenlabs" ? m.provider === "elevenlabs" : p.key === "seedaudio" ? m.provider === "seedaudio" : m.provider === "byteplus" && !m.gate));
          return (
            <section key={p.id} className={`prov ${on ? "on" : ""}`}>
              <div className="prov-head">
                <span className={`status-dot ${on ? "ok" : ""}`} />
                <b>{p.name}</b>
                <span className={`badge ${on ? "free" : "locked"}`}>{on ? "ativo" : "não configurado"}</span>
              </div>
              <p>{p.what}</p>
              <div className="kv">
                <span>Custo</span>
                <b style={{ textAlign: "right" }}>{p.cost}</b>
              </div>
              <div className="kv">
                <span>Variável</span>
                <code>{p.env}</code>
              </div>
              {unlocks.length > 0 && (
                <div className="prov-models">
                  {unlocks.map((m) => (
                    <span key={m.id} className="badge">
                      {m.name}
                    </span>
                  ))}
                </div>
              )}
              {!on && (
                <ol className="prov-steps">
                  {p.steps.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <a className={`btn ${on ? "" : "primary"} sm`} href={p.link} target="_blank" rel="noreferrer">
                  {on ? "Abrir console" : "Abrir e ativar"}
                </a>
              </div>
            </section>
          );
        })}
      </div>

      <section className="area mcp-card" id="publish">
        <div className="area-head">
          <h2>Publicar direto (Instagram Reels · Meta Ads)</h2>
          <span className={`badge ${u?.providers.instagram || u?.providers.metaAds ? "free" : "locked"}`}>{u?.providers.instagram ? "Instagram ativo" : u?.providers.metaAds ? "Meta Ads ativo" : "não configurado"}</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Com um token do Meta no <code>.env</code>, o botão “Publicar” (vídeo final, cortes) posta o Reels e sobe o vídeo na conta de anúncios. Não custa nada — é só configuração na sua conta do Meta.
        </p>
        <ol className="prov-steps">
          <li>
            business.facebook.com → Configurações → Usuários → Usuários do sistema → criar (admin) e “Atribuir ativos”: a página do Instagram e a conta de anúncios
          </li>
          <li>
            gerar token com as permissões <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>pages_read_engagement</code> (e <code>ads_management</code> pro Meta Ads) — token de usuário do sistema não expira
          </li>
          <li>
            no <code>.env</code>: <code>META_ACCESS_TOKEN=…</code>, <code>IG_USER_ID=…</code> (id da conta profissional do Instagram) e <code>META_AD_ACCOUNT_ID=act_…</code>; reinicie
          </li>
        </ol>
        <div className="muted" style={{ fontSize: 12 }}>
          Sem isso, o MP4 baixa normal e o Claude pode subir o criativo pelo MCP do Meta Ads que já está conectado na sua conta.
        </div>
      </section>

      <YouTubeCard configured={!!u?.providers.youtube} />

      <TeamCard />
      <BrandCard />

      <section className="area mcp-card" id="mcp">
        <div className="area-head">
          <h2>Controle pelo Claude (MCP)</h2>
          <span className="badge free">51 ferramentas</span>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          No Claude Desktop, Claude Code ou Cowork: “faz um quadrinho sobre X com a voz do Cirilo e me manda o MP4”. O Claude cria o projeto, gera, monta e devolve o link — e pergunta antes de qualquer custo no cartão, igual ao app.
        </p>
        <ol className="prov-steps">
          <li>
            com o CB Studio rodando, duplo clique em <code>Conectar ao Claude.command</code> (na pasta cb-studio)
          </li>
          <li>feche e abra o Claude Desktop — o conector “cb-studio” aparece na conversa</li>
          <li>
            teste: <i>“qual o status do CB Studio?”</i> · depois <i>“faz um quadrinho sobre…”</i>
          </li>
        </ol>
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>Configuração manual (claude_desktop_config.json) e Claude Code</summary>
          <pre className="code">{`{
  "mcpServers": {
    "cb-studio": {
      "command": "/CAMINHO/cb-studio/apps/mcp/bin/cb-studio-mcp",
      "env": { "G2_API_URL": "http://localhost:4000/v1", "G2_STUDIO_URL": "http://localhost:3000" }
    }
  }
}

# Claude Code
claude mcp add cb-studio -- /CAMINHO/cb-studio/apps/mcp/bin/cb-studio-mcp`}</pre>
        </details>
        <div className="muted" style={{ fontSize: 12 }}>
          Ferramentas: status e cotas, modelos, estimar custo, gerar imagem/vídeo/narração/efeito, upscale, clone de pessoa, lipsync, vozes, biblioteca, upload, projetos (roteiro, cenas, produzir em lote, render). Tudo que dá pra fazer está em <a href="/roadmap">Tudo que dá pra fazer</a>.
        </div>
      </section>

      <section className="area">
        <div className="area-head">
          <h2>Travas de segurança</h2>
        </div>
        <div className="kv">
          <span>Custo máximo por geração sem confirmação extra</span>
          <b>US$ {u?.maxJobCostUsd ?? 0.5} · MAX_JOB_COST_USD</b>
        </div>
        <div className="kv">
          <span>Minutos de voz antes de travar (Seed Audio)</span>
          <b>{u?.voiceFreeMinutes ?? 55} min · VOICE_FREE_MINUTES</b>
        </div>
        <div className="kv">
          <span>Modelos pagos</span>
          <b>sempre pedem confirmação com o valor antes de gerar</b>
        </div>
      </section>
    </div>
  );
}

type YtStatus = { configured: boolean; connected: boolean; channel: { id: string; title: string } | null };

/** YouTube Shorts: OAuth do canal (uma vez) — a API guarda o token; aqui só conecta/desconecta. */
function YouTubeCard({ configured }: { configured: boolean }) {
  const [st, setSt] = useState<YtStatus | null>(null);
  const load = () => api<{ youtube: YtStatus }>("/publish/status").then((r) => setSt(r.youtube)).catch(() => setSt({ configured, connected: false, channel: null }));
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const disconnect = async () => {
    await api("/publish/youtube", { method: "DELETE" });
    load();
  };
  return (
    <section className="area mcp-card" id="youtube">
      <div className="area-head">
        <h2>Publicar no YouTube Shorts</h2>
        <span className={`badge ${st?.connected ? "free" : "locked"}`}>{st === null ? "…" : st.connected ? `canal: ${st.channel?.title ?? "conectado"}` : st.configured ? "falta conectar o canal" : "não configurado"}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        O botão “Publicar” sobe o MP4 no seu canal como Short (público, não listado ou privado). Não custa nada e não precisa de aprovação do Google — o app roda em modo de teste só pro seu canal.
      </p>
      {!st?.configured && (
        <ol className="prov-steps">
          <li>
            console.cloud.google.com → novo projeto → “APIs e serviços” → ativar <b>YouTube Data API v3</b>
          </li>
          <li>
            “Tela de consentimento OAuth” → externo → adicionar seu e-mail como <b>usuário de teste</b>
          </li>
          <li>
            “Credenciais” → criar ID do cliente OAuth → tipo <b>Aplicativo da Web</b> → URI de redirecionamento autorizado: <code>http://localhost:4000/v1/publish/youtube/callback</code>
          </li>
          <li>
            no <code>.env</code>: <code>YOUTUBE_CLIENT_ID=…</code> e <code>YOUTUBE_CLIENT_SECRET=…</code>; reinicie o estúdio e volte aqui
          </li>
        </ol>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {st?.configured && !st.connected && (
          <a className="btn primary sm" href="/api/publish/youtube/auth" target="_blank" rel="noreferrer">
            Conectar YouTube ›
          </a>
        )}
        {st?.connected && (
          <>
            <a className="btn sm" href="https://studio.youtube.com" target="_blank" rel="noreferrer">
              Abrir YouTube Studio
            </a>
            <button className="btn sm" onClick={disconnect}>
              Desconectar
            </button>
          </>
        )}
        {!st?.configured && (
          <a className="btn sm" href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">
            Abrir Google Cloud
          </a>
        )}
      </div>
    </section>
  );
}

type BrandLogo = { url: string; position?: "top-left" | "top-right" | "bottom-left" | "bottom-right"; size?: number; opacity?: number };
type Brand = { logo?: BrandLogo | null; name?: string };

/** Marca: logo que carimba cortes, legendas e dublagens (PNG com fundo transparente) */
function BrandCard() {
  const [brand, setBrand] = useState<Brand | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ brand: Brand }>("/brand").then((r) => setBrand(r.brand)).catch(() => setBrand({}));
  }, []);
  const save = async (patch: Partial<Brand>) => {
    const r = await api<{ brand: Brand }>("/brand", { method: "PUT", body: JSON.stringify(patch) });
    setBrand(r.brand);
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const up = await uploadFile(f);
      await save({ logo: { url: up.url, position: brand?.logo?.position ?? "top-right", size: brand?.logo?.size ?? 0.14, opacity: brand?.logo?.opacity ?? 0.85 } });
    } finally {
      setBusy(false);
    }
  };
  const logo = brand?.logo ?? null;
  return (
    <section className="area mcp-card" id="brand">
      <div className="area-head">
        <h2>Marca (logo nos vídeos)</h2>
        <span className={`badge ${logo ? "free" : "locked"}`}>{brand === null ? "…" : logo ? "logo ativo" : "sem logo"}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Um PNG com fundo transparente entra no canto dos cortes, legendas e dublagens (dá pra desligar por vídeo). Não custa nada.
      </p>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        {logo && (
          <div style={{ width: 120, height: 68, background: "repeating-conic-gradient(#333 0 25%, #444 0 50%) 0 0/16px 16px", borderRadius: 8, display: "grid", placeItems: "center", padding: 6 }}>
            <img src={logo.url} alt="logo" style={{ maxWidth: "100%", maxHeight: "100%", opacity: logo.opacity ?? 0.85 }} />
          </div>
        )}
        <label className="btn sm" style={{ cursor: "pointer" }}>
          {busy ? "Enviando…" : logo ? "Trocar PNG" : "Escolher PNG"}
          <input type="file" accept="image/png,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {logo && (
          <>
            <select className="select" value={logo.position ?? "top-right"} onChange={(e) => save({ logo: { ...logo, position: e.target.value as BrandLogo["position"] } })} style={{ width: 170 }}>
              <option value="top-right">canto superior direito</option>
              <option value="top-left">canto superior esquerdo</option>
              <option value="bottom-right">inferior direito (acima da legenda)</option>
              <option value="bottom-left">inferior esquerdo</option>
            </select>
            <label className="muted" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              tamanho <input type="range" min={5} max={40} value={Math.round((logo.size ?? 0.14) * 100)} onChange={(e) => setBrand({ ...brand, logo: { ...logo, size: +e.target.value / 100 } })} onMouseUp={(e) => save({ logo: { ...logo, size: +(e.target as HTMLInputElement).value / 100 } })} />
            </label>
            <label className="muted" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
              opacidade <input type="range" min={10} max={100} value={Math.round((logo.opacity ?? 0.85) * 100)} onChange={(e) => setBrand({ ...brand, logo: { ...logo, opacity: +e.target.value / 100 } })} onMouseUp={(e) => save({ logo: { ...logo, opacity: +(e.target as HTMLInputElement).value / 100 } })} />
            </label>
            <button className="btn ghost sm" onClick={() => save({ logo: null })}>
              Remover
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** Equipe: cada editor entra com e-mail e senha (vale quando o app está na nuvem com AUTH_REQUIRED=true) */
function TeamCard() {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<TeamUser[] | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "editor" as "editor" | "admin" });
  const [busy, setBusy] = useState(false);
  const load = () => api<{ users: TeamUser[] }>("/auth/users").then((r) => setUsers(r.users)).catch(() => setUsers([]));
  useEffect(() => {
    api<Me>("/auth/me").then(setMe).catch(() => {});
    load();
  }, []);
  const isAdmin = !me?.authRequired || me.user?.role === "admin";
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/auth/users", { method: "POST", body: JSON.stringify(form) });
      toast(`${form.name} pode entrar com ${form.email}`);
      setForm({ name: "", email: "", password: "", role: "editor" });
      load();
    } catch (err: any) {
      toast(err.message ?? "não deu pra adicionar", "bad");
    } finally {
      setBusy(false);
    }
  };
  const patch = async (u: TeamUser, body: Record<string, unknown>, done: string) => {
    try {
      await api(`/auth/users/${u.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast(done);
      load();
    } catch (err: any) {
      toast(err.message ?? "não deu", "bad");
    }
  };
  const resetPw = (u: TeamUser) => {
    const pw = prompt(`Senha nova pra ${u.name} (8+ caracteres). Passe pra pessoa por um canal seguro.`);
    if (pw && pw.length >= 8) patch(u, { password: pw }, "senha trocada — a pessoa precisa entrar de novo");
  };
  if (me && me.authRequired && !isAdmin) return null;
  return (
    <section className="area mcp-card" id="team">
      <div className="area-head">
        <h2>Equipe</h2>
        <span className={`badge ${me?.authRequired ? "free" : "locked"}`}>{me === null ? "…" : me.authRequired ? "login ligado" : "login desligado neste computador"}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Cada editor entra com o próprio e-mail e senha, e o gasto do mês aparece por pessoa. No Mac o login fica desligado; na nuvem ele liga com <code>AUTH_REQUIRED=true</code>.
      </p>
      {users && users.length > 0 && (
        <table className="team-table">
          <thead>
            <tr>
              <th>Pessoa</th>
              <th className="hide-sm">Papel</th>
              <th className="num hide-sm">Gerações no mês</th>
              <th className="num">Gasto no mês</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.disabled ? "off" : ""}>
                <td>
                  <b>{u.name}</b>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {u.email}
                    {u.disabled ? " · sem acesso" : ""}
                  </div>
                </td>
                <td className="hide-sm">{u.role === "admin" ? "Admin" : "Editor"}</td>
                <td className="num hide-sm">{u.month_jobs}</td>
                <td className="num">{usd(u.month_usd)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className="btn ghost sm" onClick={() => resetPw(u)}>
                    Trocar senha
                  </button>
                  <button className="btn ghost sm" onClick={() => patch(u, { disabled: !u.disabled }, u.disabled ? `${u.name} voltou a ter acesso` : `${u.name} não entra mais`)}>
                    {u.disabled ? "Devolver acesso" : "Tirar acesso"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {users && users.length === 0 && <p className="muted" style={{ margin: 0 }}>Ninguém cadastrado ainda. O primeiro admin nasce do <code>ADMIN_EMAIL</code> e <code>ADMIN_PASSWORD</code> do .env, ou adicione aqui.</p>}
      <form className="team-form" onSubmit={add}>
        <div className="field">
          <label htmlFor="tm-name">Nome</label>
          <input id="tm-name" className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tm-email">E-mail</label>
          <input id="tm-email" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tm-pw">Senha inicial</label>
          <input id="tm-pw" className="input" type="text" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tm-role">Papel</label>
          <select id="tm-role" className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "editor" | "admin" })}>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="btn primary" disabled={busy}>
          {busy ? "Adicionando…" : "Adicionar pessoa"}
        </button>
      </form>
    </section>
  );
}
