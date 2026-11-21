# CLAUDE.md — CB Studio (o "Higgsfield da G2")

> Documento de contexto do projeto inteiro. Leia antes de mexer em qualquer coisa.
> Escrito em 14/11/2026, atualizado em 21/11/2026 (renomeado de G2 Studio para CB Studio). Preços e rankings foram conferidos nas datas indicadas e **mudam**:
> antes de afirmar qualquer número pra alguém, confira de novo na fonte.

---

## 0. Pra outro Claude: comece aqui

Você está recebendo este projeto no meio do caminho. Em 5 minutos:

1. **Leia as regras de ouro (seção 2).** A mais importante: **nada que cobre no cartão sem o Zanzoti aprovar antes**,
   sabendo o valor e pra que é. Você **nunca** digita cartão, senha ou chave. Assinatura, crédito e chave de API
   são feitos pela pessoa (seção 21); você guia clique a clique e confere depois.
2. **Veja se o app está no ar:** ferramenta MCP `studio_status` ou `GET http://localhost:4000/health`.
   Se não responder, peça pra pessoa dar duplo clique em `Iniciar CB Studio.command`.
3. **Pra fazer vídeo:** siga a seção 22 (receita pronta, de graça e com H3).
4. **O que está em andamento agora:** seção 23 (vídeo do Zé com o Victor, voz do Victor, H3 na fal).
5. **O que falta e depende de alguém:** seção 19.

Como você controla o estúdio:
- **MCP `cb-studio`** (53 ferramentas, seção 8): o jeito mais fácil, se o Claude estiver no Mac do Zanzoti.
- **API HTTP** `http://localhost:4000/v1` (seção 6): mesma coisa, via `curl`/`fetch`.
- **Arquivos no Mac:** pasta `~/cb-studio`.

---

## 1. O que é

Estúdio de vídeo com IA da **G2 Educação**. É um app próprio, feito pra substituir o uso do Higgsfield
pela equipe de edição. Cobre o mesmo tipo de trabalho, só que com custo medido e controlado.

Fluxo principal: **tema → roteiro → imagem de cada cena → animação → narração com a voz clonada do Cirilo →
legenda karaokê → cards → trilha → MP4 9:16**.

Também faz:
- **Cortes** de aulas e lives (transcrição local + IA escolhe os trechos);
- **Dublagem** com a própria voz;
- **Carrossel**;
- **Anúncios em lote** (vários ganchos, um vídeo por gancho);
- **Clone falando** (foto + voz);
- **Publicar** no Instagram, YouTube Shorts e Meta Ads.

Pode ser controlado pelo **Claude via MCP** (53 ferramentas).

- **Dono técnico:** Guilherme Zanzoti (co-fundador, infra). Quem aprova gasto é o **Guilherme Cirilo**, o expert da G2.
- **Repositório:** `github.com/gcagency763/cb-studio` (**público**). Antes se chamava G2 Studio (`suportearrobaplugu/g2-studio`, privado); subiu aqui sem o histórico de commits em 21/11/2026.
- **Onde roda hoje:** no Mac do Zanzoti, em `~/cb-studio`.
- **Tamanho:** ~17 mil linhas (TS/TSX/SQL/Python), 80 commits.

---

## 2. Regras de ouro (valem pra qualquer Claude ou pessoa mexendo aqui)

1. **Custo zero por padrão.** Nada que cobre no cartão roda sem o Zanzoti aprovar *antes*, sabendo o valor e
   pra que é ("nada mesmo": compra, crédito, plano, pacote, teste pago). O app tem `ZERO_COST=true` como padrão
   e recusa (HTTP 402) qualquer geração que iria pro cartão, mesmo com `allowPaid`.
2. **Chaves e tokens nunca aparecem na tela, no chat nem no git.** Ficam só no `.env`, que o próprio usuário
   preenche. Scripts de setup podem gravar no `.env` sem mostrar o valor.
3. **Ativações, aceite de termos e cartão são com o usuário.** Claude não clica em "ativar modelo pago",
   não aceita licença nem põe cartão.
4. **Números têm que estar certos.** Quando for explicar custo ou ranking pro Cirilo, use só número medido
   ou com fonte. Se não tem número publicado, diga isso. Não estime e apresente como fato.
5. **Ao citar um pull request, mande o link do PR.**
6. **Fale simples, em português.** Quem usa são editores, não programadores.

---

## 3. Onde roda e como liga

### No Mac (hoje)

| O quê | Onde / porta |
|---|---|
| Site (Next.js 15) | http://localhost:3000 |
| API (Fastify) | http://localhost:4000 (rotas em `/v1/...`, arquivos em `/storage/...`) |
| Worker (BullMQ) | processo à parte, mesmas filas do Redis |
| Postgres 16 | Docker (OrbStack) → `localhost:5433` (usuário/senha/banco `g2/g2/g2studio`) |
| Redis 7 | Docker → `localhost:6380` |
| Whisper (transcrição) | Docker `onerahmet/openai-whisper-asr-webservice` → `localhost:9000` (CPU, grátis) |
| Arquivos gerados | `~/cb-studio/storage/{images,videos,audios,renders,uploads,transcripts,cuts,carousel}` |
| Logs | `~/cb-studio/.logs/{api,worker,web,whisper}.log` |
| MCP pro Claude Desktop | `apps/mcp` (stdio), registrado por `Conectar ao Claude.command` |

Atalhos de duplo clique na raiz:

| Arquivo | Faz |
|---|---|
| `Iniciar CB Studio.command` | abre o OrbStack, sobe Postgres/Redis/Whisper, `pnpm install`, mata processos velhos, sobe API/worker/web, abre o navegador |
| `Parar CB Studio.command` | para tudo |
| `Configurar Voz.command` | grava a chave do Seed Speech no `.env` |
| `Conectar ao Claude.command` | registra o MCP no Claude Desktop (depois feche e abra o Claude) |
| `infra/gpu/Ligar GPU.command` | publica o Wan 2.2 na GPU própria (Modal). **Gasta. Só com aprovação** |
| `infra/gpu/Ligar H3.command` | publica o MiniMax H3 na GPU própria (Modal, 4× H100). **Gasta. Só com aprovação** |

- A API e o worker rodam com `tsx watch`: mudou o código, recarregam sozinhos.
- As **migrações rodam no boot da API**.
- Reiniciar tudo (Iniciar) só é preciso quando entra dependência nova no `package.json`.

### Rodando na mão

```bash
cp .env.example .env              # preencher ARK_API_KEY, SEED_SPEECH_API_KEY…
pnpm install
docker compose up -d postgres redis whisper
pnpm --filter @g2/api dev         # API :4000 (aplica migrações)
pnpm --filter @g2/api worker      # worker
pnpm --filter @g2/web dev         # site :3000
pnpm --filter @g2/mcp dev         # MCP stdio (ou `http` → :4100/mcp)
```

Verificar tipos: `npx tsc --noEmit -p .` dentro de `apps/api`, `apps/web`, `apps/mcp` e `packages/providers`.

### Na nuvem (preparado, ainda não ligado)

Ver a seção 13.

---

## 4. Arquitetura e pastas

```
apps/web            Next.js 15 (App Router) — a interface
apps/api            Fastify 5 + BullMQ — API, filas, worker, guardas de custo, linha de produção, render FFmpeg
apps/mcp            servidor MCP (stdio + HTTP) com 53 ferramentas
packages/providers  catálogo de modelos + adaptadores submit/poll/download por provedor
packages/db         migrações SQL do Postgres (001…016)
infra/gpu           GPU própria no Modal (Wan 2.2 e MiniMax H3) — experimental
infra/cloud         start.sh do container + LEIA-ME.md (deploy Railway)
Dockerfile          imagem única pra nuvem (site + API + worker)
railway.json        config da Railway
docker-compose.yml  Postgres, Redis e Whisper locais
scripts/            smoke-byteplus.sh (teste rápido da chave)
storage/            arquivos gerados (fora do git)
.patches/           patches .diff aplicados no Mac (histórico de entrega)
```

### `apps/api/src`

| Arquivo | Responsabilidade |
|---|---|
| `server.ts` | sobe o Fastify; CORS; hook de login (`AUTH_REQUIRED`); serve `/storage` (baixa do bucket se faltar no disco); registra rotas em `/v1`; `bootstrapAdmin()` |
| `worker.ts` | 3 filas: **generation** (concorrência `GENERATION_CONCURRENCY`, padrão 8), **render** (1), **edit** (1). Confere a narração depois que fica pronta (`checkTake`), limpa órfãos, limpa o cache do disco a cada hora quando há bucket |
| `lib/env.ts` | variáveis da API (zod); lê o `.env` da raiz |
| `lib/db.ts` | acesso ao Postgres (`postgres` lib): jobs, projetos, cenas, uploads; grava `created_by` de quem pediu |
| `lib/queue.ts` | filas BullMQ |
| `lib/generate.ts` | escolhe o provedor (`plan`), **guarda de custo** (`guard`), enfileira (`enqueue`) |
| `lib/pipeline.ts` | linha de produção do projeto: o que falta, lote de imagem/vídeo/voz, **narração contínua**, plano parado, montagem do pedido de render |
| `lib/render.ts` | render FFmpeg: clipes, cards, legenda karaokê (ASS), trilha com ducking, áudio da tomada contínua, loudnorm |
| `lib/take.ts` | `splitTake` (corta a tomada contínua por cena) e `checkTake` (confere se a voz falou o roteiro todo e a velocidade) |
| `lib/extend.ts` | estender vídeo (último frame + i2v), `stillClip` (imagem → clipe com zoom lento) |
| `lib/script.ts` | roteiro automático (Seed 2.1): estilos `epic`, `comic`, `anime`, `cinematic`…, regras da G2, saída validada |
| `lib/edit.ts` | Cortes: Whisper → Seed 2.1 escolhe trechos → clipes 9:16 legendados; edição automática (pausas, "ééé", zoom) |
| `lib/reframe.ts` + `lib/pico.ts` | reenquadre 9:16 seguindo o rosto de quem fala (detector pico em JS puro, `apps/api/assets/facefinder`) |
| `lib/dub.ts` | dublagem: transcreve, traduz no tempo da fala, fala com a voz clonada, troca o áudio |
| `lib/carousel.ts` | carrossel de imagens (Seedream) |
| `lib/ads.ts` | anúncios em lote: produto + oferta → ganchos → um quadrinho por gancho |
| `lib/publish.ts` / `lib/youtube.ts` | Instagram Reels, Meta Ads (advideos), YouTube Shorts (OAuth + upload resumível) |
| `lib/refs.ts` | transforma referências `/storage/...` em data URL / arquivo pros provedores |
| `lib/storage.ts` | disco local + **bucket S3/R2 opcional** (disco vira cache), `trimCache` |
| `lib/auth.ts` | login: senha `scrypt`, sessão em cookie `g2s` (token salvo como sha256), `AsyncLocalStorage` com o usuário atual, token de máquina |
| `lib/llm.ts` | chamadas de texto (Seed 2.1 via ModelArk, compatível com OpenAI) |
| `lib/capabilities.ts` | mapa "o que dá pra fazer" (pronto / planejado / ideia), usado em `/roadmap` e no MCP |
| `lib/migrate.ts` | aplica `packages/db/migrations/*.sql` em ordem |
| `routes/*.ts` | rotas HTTP (lista na seção 6) |

### `packages/providers/src`

| Arquivo | O quê |
|---|---|
| `catalog.ts` | **catálogo de todos os modelos** (id, nome, tipo, provedor, preço, resoluções, durações, dicas) + `catalogWithAvailability(env)`, que diz o que está travado e por quê + `zeroCost()` |
| `byteplus/` | Seedance (vídeo), Seedream (imagem), Seed 2.1 (texto) — ModelArk `ap-southeast-1` |
| `seedaudio/` | Seed Audio 1.0 (voz clonada, SFX, música instrumental) — BytePlus Voice |
| `fal/` | fal.ai: MiniMax H3/H3 Max, Kling 2.5→4.0, GPT Image, Nano Banana, OmniHuman, Kling Avatar, Sync Lipsync, upscale |
| `elevenlabs/` | ElevenLabs v4 + SFX (pago, travado) |
| `gpu/` | GPU própria (Modal): Wan 2.2 e MiniMax H3, mesmo contrato HTTP `/jobs` |
| `index.ts` | `providersFromEnv()` — liga cada provedor só se a chave existir |
| `types.ts` | `GenRequest`, `Kind` (`image`, `video`, `audio`, `sfx`, `avatar`, `lipsync`, `upscale`), etc. |

### `apps/web/app` (páginas)

`/explore` (início) · `/image` · `/video` · `/audio` · `/projects` e `/projects/[id]` (a **mesa de produção**:
cenas, variações, plano parado, tomada de narração com conferência, render) · `/carousel` · `/clone` ·
`/cuts` (cortes, legendar, dublar) · `/ads` · `/library` · `/usage` (gastos e cotas) · `/settings`
(provedores, GPU própria, publicar, MCP, **Equipe**) · `/roadmap` · `/login`.

Componentes: `TopNav` (chip "✦ Custo zero", gasto no cartão hoje, usuário/sair), `CommandPalette`,
`Publish`, `NewVoiceModal`, `CaptionPreview`, `Toasts`.

- **Fontes:** Sora + Bricolage Grotesque ficam em `apps/web/app/fonts` (woff2 no projeto). O build não depende do Google.
- **Proxy:** o site chama a API pelo mesmo endereço (`/api/*` → `${API_URL}/v1/*` e `/storage/*`, via rewrites do Next).
  É isso que faz o cookie de login funcionar. O `proxyTimeout` é de 15 min por causa de uploads grandes.

---

## 5. Fluxos principais

### 5.1 Projeto (quadrinho / novela)

1. **Roteiro:** `POST /v1/script`. O Seed 2.1 escreve as cenas, cada uma com narração, prompt de imagem e prompt de movimento.
   A ficha de personagem (`character_sheet`) mantém o mesmo rosto em todas as cenas.
2. **Imagens:** Seedream 4.5, em lote, pela cota grátis. Dá pra gerar variações por cena e escolher uma.
3. **Vídeo:** imagem → vídeo.
   - O padrão grátis é `seedance-1-0-pro-fast-251015:720p`.
   - Com `FAL_KEY` e **sem** custo zero, o padrão passa a ser `minimax-h3:720p`.
   - Botão **"Plano parado"**: a imagem vira clipe com zoom lento, local e de graça. Use quando a IA errar.
4. **Narração contínua:** `POST /v1/projects/:id/narration`.
   - Uma **única tomada** do Seed Audio com o texto de todas as cenas. Fim da voz "travada" nas emendas.
   - `splitTake` alinha as palavras por letras e encurta as pausas entre cenas pra ≤ 0,22 s.
   - `checkTake` confere se falou tudo (diff de palavras) e a velocidade: acima de 5 palavras/s é "rápida demais", abaixo de 2,8 é "lenta".
   - Ajustes: `speech_rate` e `narration_style` no projeto.
5. **Render:** `POST /v1/projects/:id/render`, FFmpeg local, custo zero.
   - Clipes esticados até no máximo 1,12×.
   - Legenda karaokê em blocos de até 46 caracteres. Não quebra número, valor nem unidade ("cinquenta e cinco milhões de reais").
   - Cards com botão, trilha com ducking e loudnorm (≈ −16 LUFS).
   - Saída: MP4 1080×1920.

### 5.2 Cortes

Upload da aula ou live → Whisper local → o Seed 2.1 escolhe os trechos com gancho e dá nota → clipes 9:16 com
legenda karaokê e reenquadre no rosto → ajuste manual do corte (`/cuts/:jobId/rerender`). Também tem
"só legendar" e **dublagem** (`/dub`).

### 5.3 Outros

- Estender vídeo e ampliar (lanczos + nitidez + 60 fps opcional, grátis).
- Editar imagem: fundo branco, trocar fundo, outpaint, nova luz (Seedream i2i).
- Carrossel e textos de anúncio.
- Revisão de viralidade (`/review`).
- Recriar a partir de um vídeo de referência (`/script/from-video`).

---

## 6. API (`/v1`)

| Grupo | Rotas |
|---|---|
| Geração | `POST /generate` · `POST /estimate` · `GET /jobs/:id` · `GET /models` · `GET /providers` · `GET /styles` |
| Projetos | `GET/POST /projects` · `GET/PATCH/DELETE /projects/:id` · `PUT /projects/:id/scenes` · `PATCH /projects/:id/scenes/:sceneId` · `GET /projects/:id/status` · `POST /projects/:id/estimate` · `POST /projects/:id/generate` · `POST /projects/:id/render` · `GET/POST /projects/:id/narration` · `POST /projects/:id/scenes/:sceneId/still` · `GET/POST /projects/:id/scenes/:sceneId/variations` |
| Roteiro e texto | `POST /script` · `POST /script/from-video` · `POST /copy` · `POST /review` |
| Edição | `POST /transcribe` · `GET /transcripts/:jobId` · `GET /transcripts/:jobId/export` · `POST /caption` · `POST /cuts` · `POST /cuts/:jobId/rerender` · `POST /dub` · `POST /edit/start` · `GET /edit/jobs` · `GET /edit/status` · `POST /videos/:jobId/extend` · `POST /videos/:jobId/upscale` |
| Render avulso | `POST /render` |
| Biblioteca e voz | `GET /library` · `POST /uploads` · `GET/POST /voices` · `GET/DELETE /voices/:id` · `GET/PUT /brand` · `POST /carousel` |
| Anúncios | `GET/POST /ads` · `GET /ads/:id` · `POST /ads/hooks` · `POST /ads/:id/estimate` · `POST /ads/:id/produce` · `POST /ads/:id/render` |
| Publicar | `GET /publish/status` · `POST /publish/instagram` · `POST /publish/meta-ads` · `POST /publish/youtube` · `GET /publish/youtube/auth` · `GET /publish/youtube/callback` · `DELETE /publish/youtube` |
| Gastos | `GET /stats` (inclui `todayBilledUsd`, `todayFreeUsd`, `zeroCost`) · `GET /usage` · `GET /capabilities` |
| Login | `GET /auth/me` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/password` · `GET/POST /auth/users` · `PATCH /auth/users/:id` |

Fora do `/v1`: `GET /health` e `GET /storage/*`.

---

## 7. Banco (Postgres) — `packages/db/migrations`

| Migração | Conteúdo |
|---|---|
| 001_init | `jobs` (kind, provider, request, status, output_url, estimated_cost_usd, usage…) |
| 002_render | render |
| 003_projects | `projects`, `scenes` |
| 004_audio | narração e vozes |
| 005_cards_music | cards e trilha |
| 006 / 007 | novos tipos de job (edição) |
| 008 | recriar e revisão |
| 009 | campanhas |
| 010 | publicar |
| 011 | configurações (marca) |
| 012 | dublagem |
| 013 | carrossel |
| 014_narration_style | `narration_style`, `speech_rate` |
| 015_narration_take | `projects.narration_job_id` |
| 016_auth | `users`, `sessions`, `jobs.created_by`, `projects.created_by` |

Todas já foram aplicadas no Mac.

---

## 8. MCP (Claude controlando o estúdio) — `apps/mcp/src/server.ts`

**53 ferramentas:**

- **Status e catálogo:** `studio_status`, `list_models`, `capabilities`, `estimate_cost`
- **Geração:** `generate_image`, `generate_video`, `generate_narration`, `generate_sfx`, `upscale_image`, `clone_person`, `lipsync`
- **Transcrição e cortes:** `transcribe`, `get_transcript`, `caption_video`, `rerender_cut`, `dub_video`, `make_cuts`, `recreate_from_video`, `review_virality`
- **Anúncios:** `ads_hooks`, `ads_create`, `ads_status`, `ads_produce`, `ads_render`
- **Publicar:** `publish_instagram`, `publish_meta_ads`, `publish_youtube`
- **Vídeo e imagem:** `extend_video`, `upscale_video`, `make_carousel`, `set_brand_logo`, `write_copy`
- **Vozes e biblioteca:** `list_voices`, `create_voice`, `list_library`, `get_job`, `wait_job`, `upload_file`
- **Projetos:** `list_projects`, `get_project`, `create_project`, `write_script`, `update_project`, `edit_scene`,
  `narrate_project`, `still_scene`, `add_scene`, `remove_scene`, `estimate_project`, `produce`, `wait_project`,
  `render_project`, `delete_project`

Outros detalhes:
- Variáveis: `G2_API_URL` (padrão `http://localhost:4000/v1`). Se o app estiver na nuvem com login, use também `G2_API_TOKEN` (= `API_TOKEN` do servidor).
- Ferramentas pagas pedem `confirmPaid: true`.
- O Claude Desktop só enxerga ferramentas novas depois de fechar e abrir o app.

---

## 9. Modelos e preços (catálogo do app, `packages/providers/src/catalog.ts`)

Os preços são de tabela (USD), conferidos em nov/2026. "Travado" = não roda sem a chave ou crédito e sem `ZERO_COST=false`.

### Vídeo (preço por segundo)

| Modelo | Provedor | 480p | 720p | 1080p | Situação |
|---|---|---|---|---|---|
| Seedance 1.0 fast | BytePlus | 0,0107 | 0,0216 | 0,0486 | **grátis (cota)** — padrão; só imagem→vídeo |
| Seedance 1.0 pro | BytePlus | 0,0267 | 0,054 | 0,1215 | **grátis (cota)** |
| Seedance 1.5 pro | BytePlus | 0,0119 | 0,0259 | 0,0583 | **indisponível**: a BytePlus parou de ativar ("stopping new purchases") |
| Seedance 2.0 mini | BytePlus | 0,034 | 0,0756 | — | travado: reserva de US$ 30 na BytePlus |
| Seedance 2.0 fast | BytePlus | 0,054 | 0,121 | 0,272 | travado: reserva de US$ 30 |
| **Seedance 2.5** | BytePlus | 0,126 | 0,253 | 0,569 | travado: reserva de US$ 30 — o único que fez boca sincronizada com a fala nos nossos testes |
| **MiniMax H3** | fal | 0,05 | 0,06 (768p) | — | travado (fal) — 2K custa 0,13/s e 4K 0,16/s |
| MiniMax H3 Max | fal | 0,05 | 0,08 (768p) | — | travado (fal) |
| Kling 2.5 turbo / 2.6 | fal | — | 0,07 | 0,07 | travado (2.6 com áudio: 0,14) |
| Kling 3.0 / 3.0 turbo | fal | — | 0,112 / 0,14 | idem | travado (3.0 com áudio: 0,168) |
| Kling 4.0 | fal | — | 0,157 | 0,235 | travado |
| Grok Imagine 1.5 | fal | 0,08 | 0,14 | 0,25 | travado |
| Wan 2.2 (GPU própria) | Modal | 0,0103 | 0,0274 | — | travado (GPU) — estimativa |
| MiniMax H3 (GPU própria) | Modal | 0,015 | 0,03 | — | travado (GPU) — estimativa, medir no 1º lote |

### Imagem (preço por imagem)

| Modelo | Valor | Situação |
|---|---|---|
| Seedream 4.5 | US$ 0,04 | grátis (cota de 200) |
| Seedream 4.0 | US$ 0,03 | grátis (cota de 200) |
| GPT Image 2.5 / 2.6 Sunburst | US$ 0,06 / 0,055 | fal, travado |
| GPT Image 2.6 Flare | US$ 0,055 | fal, travado |
| GPT Image 1.5 | US$ 0,05 a 0,20 | fal, travado |
| Nano Banana 2.1 | US$ 0,06 | fal, travado |
| Nano Banana Pro | US$ 0,15 (4K: 0,30) | fal, travado |
| Upscale criativo (Clarity) | US$ 0,03 por megapixel | fal, travado |

### Voz, avatar, lipsync

| Modelo | Valor | Situação |
|---|---|---|
| Seed Audio 1.0 (voz clonada do Cirilo, SFX, música) | US$ 0,15/min depois do grátis | grátis (60 min) |
| ElevenLabs v4 | ~US$ 0,45/min | travado (plano Starter US$ 5/mês) |
| OmniHuman 1.5 | US$ 0,16/s | fal, travado |
| Kling Avatar 2 | US$ 0,115/s | fal, travado |
| Sync Lipsync 2 | US$ 3/min | fal, travado |

**Medida real de tokens do Seedance:** 720p 9:16 com 5 s = **103.818 tokens**. Preço por mil tokens:
1.0 fast US$ 0,001 · 1.0 pro US$ 0,0025 · 2.5 entre US$ 0,0107 e 0,0117.

---

## 10. Contas, cotas grátis e situação

| Conta | Situação (13/11/2026) |
|---|---|
| **BytePlus ModelArk** (`ap-southeast-1`) | Chave no `.env`. **Free Credits Only Mode ligado**: quando a cota acaba, o modelo pausa, não cobra |
| Cota Seedance 1.0 fast | 2.000.000 tokens; usado 1.505.031 → sobra ~495 mil (≈ 4 clipes de 5 s em 720p) |
| Cota Seedance 1.0 pro | 2.000.000 tokens; usado 1.870.440 → sobra ~129 mil (≈ 1 clipe) |
| Cota Seedream 4.5 | 200 imagens; usado 117 → sobra 83 |
| Cota Seedream 4.0 / 5.0 lite | 200 / 50 imagens |
| Seed 2.1 (texto) | 500 mil tokens grátis (campanha de novos usuários) |
| **Seed Audio** | 60 min grátis; usado ~10,6 min. A trava do app é `VOICE_FREE_MINUTES=55`; com custo zero, nunca passa de 60 |
| Seedance 2.x | Exige **US$ 30 de reserva** (créditos que não expiram) ou pacote. **Não ativado** |
| Seedance 1.5 pro | **Não dá pra ativar** (BytePlus: "stopping new purchases") |
| **fal.ai** | Sem conta/crédito. Pré-pago, mínimo **US$ 10** (≈ 33 clipes de 5 s no H3 a 768p). Aguarda aprovação |
| ElevenLabs | Desligado (Starter US$ 5/mês, opcional) |
| **Higgsfield** | Plano **Ultra** com **614 créditos** (já pagos). Tem o MiniMax H3, só em 2K. Usar créditos só com autorização |
| Modal (GPU) | Sem conta. Tem US$ 30/mês de crédito grátis. Aguarda aprovação |
| Railway | Sem conta. Aguarda aprovação do Cirilo |
| **Cartão** | **US$ 0 cobrado até hoje** |

---

## 11. Guardas de custo (como o app impede gasto)

| Guarda | O que faz |
|---|---|
| `ZERO_COST=true` (padrão) | Modelos de fal, ElevenLabs, GPU e Seedance 2.x aparecem **travados**, e a API responde **402** se alguém tentar. Voz nunca passa dos 60 min grátis. Só desliga com `ZERO_COST=false`, depois de aprovar o gasto |
| `MAX_JOB_COST_USD=0.50` | Job acima disso precisa de `allowPaid: true` |
| `allowPaid` / `confirmPaid` | O app mostra o valor e pede confirmação. O MCP exige `confirmPaid: true` |
| BytePlus Free Credits Only Mode | Fim da cota = pausa, não cobra |
| `VOICE_FREE_MINUTES=55` | Trava a narração antes de virar cobrança |
| Painel `/usage` e chip no topo | Mostra o gasto nominal (preço de tabela) separado do que foi **de fato pro cartão** (`billedToCard`) |

---

## 12. Login da equipe e arquivos

- **Login:**
  - `AUTH_REQUIRED=false` no Mac (abre direto); `true` na nuvem.
  - O primeiro admin nasce de `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` no primeiro boot.
  - O admin cadastra editores, troca senha e tira acesso em **Provedores → Equipe**, onde também vê o gasto do mês por pessoa.
  - Senha com `scrypt`; sessão em cookie HttpOnly `g2s` de 30 dias (`SESSION_DAYS`).
  - Automação/MCP: `Authorization: Bearer <API_TOKEN>`.
- **Arquivos:**
  - Sem `S3_*`, tudo fica em `storage/`.
  - Com bucket (Cloudflare R2 ou bucket da Railway), cada arquivo salvo também sobe pro bucket e o disco vira **cache**: se faltar, baixa na hora.
  - O worker limpa o cache de hora em hora acima de `STORAGE_CACHE_GB` (padrão 3), e só apaga do disco o que confirmou estar no bucket.
  - Testado com um S3 simulado (moto).

---

## 13. Nuvem (sem VPS) — preparado, falta aprovar

A VPS deixou de ser opção. Recomendação: **Railway + bucket**.

- **`Dockerfile`:** um container só, com Node 22, ffmpeg com libass e fontes Liberation (compatíveis com Arial).
  - Builda o site.
  - Roda `infra/cloud/start.sh`, que sobe API (:4000), worker e site (`$PORT`); se um cair, o container reinicia.
- **`railway.json`:** build pelo Dockerfile, healthcheck em `/login`.
- **Serviços na Railway:** Postgres, Redis, Bucket e o app.
  - Whisper opcional: imagem `onerahmet/openai-whisper-asr-webservice`, com `WHISPER_URL=http://<serviço>.railway.internal:9000`.
- **Passo a passo:** `infra/cloud/LEIA-ME.md`.
- **Testado aqui:**
  - build de produção do site;
  - `start.sh` com login e bucket ligados;
  - login, cookie, upload, `/storage` sem login → 401;
  - arquivo apagado do disco voltando do bucket.
- **Não testado:** o build da imagem Docker, porque o Docker Hub é bloqueado neste ambiente. Ele é montado na própria Railway.

**Preços da Railway** (conferidos em 13/11/2026):
- Hobby: US$ 5/mês com US$ 5 de uso incluso. Pro: US$ 20/mês com US$ 20 incluso.
- Uso: US$ 20 por vCPU/mês e US$ 10 por GB de RAM/mês, cobrado por segundo.
- Volume: US$ 0,15/GB/mês; no Hobby o limite é **5 GB**, por isso os arquivos vão pro bucket.
- Bucket Railway: US$ 0,015/GB/mês, sem custo de saída.
- Cloudflare R2: US$ 0,015/GB/mês, sem custo de saída.

**Opções que foram pro PDF do Cirilo** (`G2-Studio-o-que-precisa-de-cartao.pdf`, câmbio R$ 5,51 + IOF 3,5%):

| Opção | Custo aproximado |
|---|---|
| A — Railway + R2 | ≈ US$ 30/mês |
| B — Vercel + Render + R2 | ≈ US$ 70/mês |
| C — Railway + Supabase + R2 | — |

---

## 14. GPU própria (a ideia do Cirilo) — o que foi feito e a conclusão

**A ideia:** em vez de pagar API, alugar GPU por segundo e rodar um modelo aberto.

**O que foi construído** (`infra/gpu`, tudo **experimental e desligado**):

1. **`g2_video.py` — Wan 2.2 I2V A14B + LoRA Lightning (4 passos)** no **Modal** (serverless, H100).
   - Liga quando o app pede e desliga depois de 2 min parada. Não é VPS.
   - Pesos (~60 GB) ficam no volume `g2-hf-cache`.
   - API: `POST /jobs` → `{id}` e `GET /jobs/{id}` → `video_b64`, com `Bearer G2_GPU_TOKEN`.
   - Modelo no app: `wan-2.2-gpu`.
2. **`g2_h3.py` — MiniMax H3** com vLLM-Omni em **4× H100**.
   - LoRA Turbo `lightx2v/Minimax-h3-Turbo` (`v1.0_768p`, 4 passos, flow_shift 6).
   - Pesos ~120 GB no volume `g2-h3-weights`.
   - Precisa aceitar a licença no Hugging Face (`MiniMaxAI/MiniMax-H3`, repositório fechado).
   - Modelo no app: `minimax-h3-gpu`.
3. **Provedor `packages/providers/src/gpu`:**
   - Calcula o custo pelos segundos de GPU.
   - Tamanhos: Wan em múltiplos de 16; H3 9:16 em 768×1344 (720p) e 480×832 (480p).
   - Testado contra um servidor falso.
4. **`Ligar GPU.command` / `Ligar H3.command`:** login no Modal, criam o segredo, baixam os pesos, publicam e gravam a URL no `.env`.
   - Recomendação: pôr limite de gasto de US$ 30 no Modal.

**Preços de GPU pesquisados (nov/2026):**

| Onde | Preço |
|---|---|
| Modal | H100 US$ 3,95/h · L40S US$ 1,95/h · US$ 30/mês grátis |
| RunPod serverless | 4090 US$ 1,34/h · L40S US$ 1,75/h |
| RunPod pod | 4090 US$ 0,89/h |
| Vast.ai | 4090 mediana US$ 0,507/h |
| Wan 2.2 pronto em API (referência) | Replicate US$ 0,11 por 5 s 720p · fal Wan 2.2 turbo US$ 0,10 por vídeo |

**Conclusão (explicada pro Cirilo):** no volume da G2 (~250 clipes/mês), **GPU própria não sai muito mais
barato** que API pronta.
- Paga também o tempo de ligar a máquina e de carregar o modelo, a manutenção e o risco de erro.
- O Seedance 2.5 é **fechado** e não dá pra rodar em GPU própria.
- O H3 na própria GPU precisa de 4× H100 (~US$ 15,80/h só de GPU no Modal; ~US$ 17,80/h com CPU/RAM).
- Só compensa com muito volume e em lote.

**Decisão: usar o MiniMax H3 por API (fal).**

---

## 15. Comparativo de modelos (Artificial Analysis, imagem→vídeo, versão 2.1, 35 modelos — conferido em 13/11/2026)

| Posição | Modelo | Pontos |
|---|---|---|
| 1º | Seedance 2.5 | 1161 |
| 2º | Utopai X | 1151 |
| 3º | Seedance 2.0 | 1140 |
| **4º** | **MiniMax H3 (768p)** | **1133** |
| 9º | MiniMax H3 Max | 1115 |
| 23º | Kling 3.0 1080p | 1000 (âncora da escala) |
| 27º | Veo 3.1 | 955 |

Em texto→vídeo o H3 fica **à frente**: 3º com 1161, contra 1155 do Seedance 2.5.

- **Seedance 1.0 e 1.5 não estão no ranking atual.** O 1.0 foi 1º em junho de 2025, na escala antiga
  (a página dele mostra 1142,66). Essa nota **não pode ser comparada** com a de hoje, porque a escala mudou.
- **H3 × 2.5:** ~4× mais barato (cena de 5 s: US$ 0,30 contra ~US$ 1,27 em 720p). Fica 28 pontos atrás em imagem→vídeo.
  Pra cena com fala e boca sincronizada, o 2.5 continua sendo o seguro (o H3 ainda não foi testado nisso).
- **H3 × 1.0 pro:** mesmo preço (US$ 0,06/s contra US$ 0,054/s), uma geração mais novo (ago/2026 contra jun/2025).
  Os erros do Ep 1 vieram do 1.0.
- **Licença do H3** (MiniMax H3 Community License, 02/08/2026):
  - pesos não podem ser usados nos EUA, na União Europeia, no Reino Unido e na Coreia do Sul;
  - empresa com mais de US$ 20 mi/ano de faturamento precisa de autorização;
  - telas que usam o H3 mostram "MiniMax H3".
- **Ainda não testamos o H3 de verdade.** Falta fal (US$ 10) ou créditos do Higgsfield, nos dois casos com aprovação.

---

## 16. Caso real: Novela do Cirilo — Ep 1 "Todo real deixa rastro"

- **Projeto:** `24b8dafa-ede2-42b6-9d57-841f355711ff`.
  - 28 cenas (26 de vídeo + 2 cards), estilo `cinematic` (semi-realista, neon magenta/ciano), voz "Cirilo".
  - Narração contínua (tomada `f4f304db-a23a-4d8b-acd2-1c1812c318ca`): 297 palavras, 4,5 palavras/s.
- **Versões:**
  - v1 e v2: narração por cena, com emendas travadas.
  - v3: tomada contínua, 67,2 s (`renders/a1c9aca1…`).
  - **v4 (atual):** `renders/b8824dc5-63ef-4537-a55b-e7219a629c84.mp4`, 67,2 s, −16,7 LUFS.
- **Erros que o Seedance 1.0 cometeu e como foram resolvidos na v4:**
  - bolsa dentro de bolsa e número de bolsas mudando;
  - olho brilhando rosa;
  - "BANFD EN" na placa do banco;
  - torre do Banco Central se deformando;
  - analista virando desenho;
  - coisas caindo dentro da bolsa de dinheiro;
  - **Solução:** as 6 cenas viraram **plano parado com zoom lento** (custo zero).
    Os originais ficaram em `storage/videos/_originais_ep1/`.
- **Lições pros prompts:**
  - sempre "No text, no letters, no numbers…";
  - placa só com "BANCO" quando precisa;
  - "natural dark brown irises (no glowing eyes)";
  - notas de real "light-blue Brazilian 100-real banknotes… never US dollars";
  - movimento "Fast-paced, energetic real-time motion, no slow motion";
  - nada de objeto se transformando;
  - quando o modelo erra, **plano parado** em vez de gerar de novo.
- **Próximo passo combinado:** refazer o Ep 1 no **MiniMax H3**, usando a mesma tomada de narração, quando a fal for aprovada.

---

## 17. Variáveis de ambiente (todas)

Modelo completo em `.env.example`.

| Grupo | Variáveis |
|---|---|
| BytePlus | `ARK_API_KEY`, `ARK_BASE_URL`, `ARK_VIDEO_MODEL`, `ARK_VIDEO_MODEL_FAST`, `ARK_IMAGE_MODEL`, `ARK_TEXT_MODEL`, `ARK_ALLOW_SEEDANCE_2`, `ARK_ALLOW_SEEDANCE_15` |
| Voz | `SEED_SPEECH_API_KEY`, `SEED_SPEECH_BASE_URL`, `VOICE_FREE_MINUTES`, `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL`, `ELEVENLABS_VOICE_ID` |
| Pagos | `FAL_KEY`, `GOOGLE_API_KEY` (fase 2) |
| Custo | `ZERO_COST` (padrão true), `MAX_JOB_COST_USD`, `GENERATION_CONCURRENCY` |
| Infra | `DATABASE_URL`, `REDIS_URL`, `PORT`, `STORAGE_DIR`, `FFMPEG_PATH`, `NODE_ENV` |
| Bucket | `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL`, `STORAGE_CACHE_GB` |
| Login | `AUTH_REQUIRED`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `API_TOKEN`, `SESSION_DAYS`, `COOKIE_SECURE` |
| Whisper | `WHISPER_URL`, `WHISPER_MODEL`, `WHISPER_LANGUAGE`, `WHISPER_POLISH` |
| Publicar | `META_ACCESS_TOKEN`, `IG_USER_ID`, `META_AD_ACCOUNT_ID`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `PUBLIC_API_URL` |
| GPU própria | `G2_GPU_URL`, `G2_GPU_TOKEN`, `G2_GPU_USD_PER_HOUR`, `G2_GPU_SEC_720`, `G2_GPU_SEC_480`, `G2_GPU_H3_URL`, `G2_GPU_H3_USD_PER_HOUR`, `G2_GPU_H3_SEC` |
| Site / MCP | `API_URL` (site → API), `G2_API_URL`, `G2_API_TOKEN` (MCP) |

---

## 18. Como desenvolver aqui

- **Adicionar um modelo:**
  1. Entrada em `packages/providers/src/catalog.ts` (id, kind, provider, `gate`, price, resoluções, durações, note/tip).
  2. Montar o corpo do pedido no adaptador do provedor.
  3. Se for pago, o `gate` (`fal`, `reserve`, `elevenlabs`, `gpu`) já faz o custo zero travar.
- **Adicionar uma rota:** arquivo em `apps/api/src/routes`, registrar em `server.ts` com prefixo `/v1`, tipar o retorno em `apps/web/lib/api.ts`.
- **Mudar o banco:** nova migração numerada em `packages/db/migrations` (roda no boot). Nunca editar uma que já foi aplicada.
- **Testar sem gastar:**
  - aponte o provedor pra um servidor falso (foi assim com a GPU);
  - use S3 falso (`moto_server`) pro bucket;
  - use Postgres e Redis locais.
- **Commits:** em português, curtos, dizendo o que muda pro usuário.
- **Entrega no Mac** (quando o Claude trabalha num container na nuvem):
  1. Commit no container.
  2. `git diff <base> HEAD --binary > NNNN.diff`.
  3. Copiar o arquivo pra `~/cb-studio/.patches/`.
  4. `git apply --check` e `git apply`; commit no Mac.
  - No Mac, o `.gitignore` é diferente: use `--exclude=.gitignore` se der conflito.
  - Arquivos `.lock` que sobrarem no `.git` são movidos pra `.git/stale-*`.

---

## 19. Pendências (o que depende de alguém)

| Pendência | Quem |
|---|---|
| Testar o **MiniMax H3**: créditos do Higgsfield (pedir orçamento antes) ou fal US$ 10 + `FAL_KEY` | aprovação do Zanzoti |
| Refazer o Ep 1 no H3 com a tomada f4f304db | depois do item acima |
| Subir na **Railway** (Postgres, Redis, Bucket, app) seguindo `infra/cloud/LEIA-ME.md` | aprovação do Cirilo |
| Reabrir o app Claude no Mac (ferramentas novas do MCP e extensão do Chrome) | Zanzoti |
| GPU própria (Modal) | só se um dia o volume justificar |

**Planejado no roadmap:**
- multiplicar anúncio vencedor;
- UGC com ator de IA;
- TikTok (o app precisa de aprovação do TikTok);
- transferir movimento;
- trocar objeto no vídeo;
- redesenhar vídeo em outro estilo;
- motion graphics por texto (Remotion, grátis).

Os pagos dependem de fal.

---

## 20. Histórico de decisões (resumo)

| Quando | Decisão |
|---|---|
| Início | Motor grátis = BytePlus (Seedance 1.0, Seedream, Seed 2.1, Seed Audio) em Free Credits Only Mode |
| Ep 1 v1/v2 | Narração por cena ficava travada nas emendas → **narração contínua** (uma tomada) com conferência automática |
| Nov/2026 | Seedance 1.5 pro descartado: a BytePlus não ativa mais |
| Nov/2026 | Seedance 2.x: só com US$ 30 de reserva, ainda não aprovado |
| Nov/2026 | GPU própria construída e testada com servidor falso; conclusão: **não compensa no volume atual** |
| 13/11/2026 | **MiniMax H3 escolhido** como equivalente barato do Seedance 2.5 (via fal); integrado e travado até aprovação |
| 13/11/2026 | VPS descartada → nuvem com Railway + bucket; login da equipe feito |
| 13/11/2026 | **Modo custo zero** como padrão do app |
| 13/11/2026 | Ep 1 v4: 6 cenas com erro trocadas por plano parado (US$ 0) |

---

## 21. Assinaturas e chaves — o que a PESSOA faz (Claude só guia e confere)

Regra: Claude nunca digita cartão, senha ou chave, nem clica em "comprar", "ativar modelo pago" ou "aceitar termos".
Antes de qualquer gasto, diga **quanto custa, em dólar e em reais, e pra que é**, e espere o "sim".
Conta em reais: US$ × 5,51 × 1,035 (IOF), câmbio de nov/2026 — confira o do dia.

| O quê | Site | Custo | Pra que serve | Depois de fazer |
|---|---|---|---|---|
| **BytePlus ModelArk** (já existe) | https://console.byteplus.com/ark | grátis (cotas) | Seedance 1.0, Seedream, Seed 2.1, Seed Audio | Chave já está no `.env` (`ARK_API_KEY`). Manter **Free Credits Only Mode** ligado |
| **fal.ai** (conta já existe, saldo US$ 0) | créditos: https://fal.ai/dashboard/usage-billing/credits · chave: https://fal.ai/dashboard/keys | pré-pago, mínimo **US$ 10** (~R$ 57) ≈ 33 cenas de 5 s no H3 | **MiniMax H3** (e Kling, GPT Image, Nano Banana…) | Pessoa cola `FAL_KEY=` no `.env`, troca `ZERO_COST=false`, roda `Iniciar CB Studio.command`. Deixar **Auto top-up OFF** e alerta de saldo em US$ 3 |
| Seedance 2.5 (opcional) | https://console.byteplus.com/ark | reserva de **US$ 30** (não expira) | o único com boca sincronizada à fala | `ARK_ALLOW_SEEDANCE_2=true` + `ZERO_COST=false` |
| Railway (nuvem, opcional) | https://railway.com | Hobby **US$ 5/mês** (US$ 5 de uso incluso) | equipe usar de fora do escritório | seguir `infra/cloud/LEIA-ME.md` |
| Cloudflare R2 (opcional) | https://dash.cloudflare.com → R2 | US$ 0,015/GB/mês | guardar os arquivos na nuvem | `S3_*` no `.env` |
| Modal (GPU, não recomendado agora) | https://modal.com | US$ 30/mês grátis; H3 ~US$ 17,80/h | GPU própria (seção 14) | `Ligar H3.command`; limite de gasto US$ 30 |
| Hugging Face (só pra GPU) | https://huggingface.co/MiniMaxAI/MiniMax-H3 | grátis | aceitar a licença do H3 | token read no `Ligar H3.command` |
| ElevenLabs (opcional) | https://elevenlabs.io | US$ 5/mês | voz alternativa | `ELEVENLABS_API_KEY` |
| Instagram / Meta Ads | https://business.facebook.com/settings/system-users | grátis | publicar direto | `META_ACCESS_TOKEN`, `IG_USER_ID`, `META_AD_ACCOUNT_ID` |
| YouTube Shorts | https://console.cloud.google.com/apis/credentials | grátis | publicar direto | `YOUTUBE_CLIENT_ID/SECRET`, depois Provedores → Publicar → Conectar YouTube |
| GitHub | https://github.com/gcagency763/cb-studio | grátis | código do app (repositório público) | pra o Claude enviar código direto, conectar a conta gcagency763 no Claude |
| Higgsfield (já existe) | https://higgsfield.ai | plano Ultra, **614 créditos** já pagos | testar o H3 (só 2K) sem cartão | gerar só com autorização e orçamento antes |

Depois que a pessoa mexer no `.env`: confira com `studio_status` (provedor `fal: true`) e `list_models kind=video`
(o `minimax-h3` tem que aparecer com `locked: null`).

---

## 22. Receita: fazer um vídeo (quadrinho/novela) do começo ao fim

### Caminho A — de graça (cota da BytePlus + plano parado)
Cotas restantes em 16/11: Seedream 4.5 ≈ 83 imagens · Seedance 1.0 fast ≈ 4 clipes de 5 s · 1.0 pro ≈ 1 clipe ·
voz ≈ 49 min. **Vídeo de IA grátis está quase no fim**: no caminho A, a maioria das cenas vira **plano parado**
(imagem com zoom lento, local, US$ 0). Fica bom pra quadrinho.

### Caminho B — com MiniMax H3 (fal, depois da aprovação)
Mesmos passos; o vídeo de cada cena sai no H3: US$ 0,06/s em 768p ≈ US$ 0,30 por cena de 5 s.
Um vídeo de ~55 s ≈ US$ 3,30 (≈ US$ 5 contando refações). **Sempre estime antes (passo 5) e mostre o valor.**

### Passo a passo (MCP; o equivalente HTTP vem depois)
1. `create_project` — título, `style` (`comic`, `epic`, `anime`, `cinematic`…).
2. `write_script` — tema + nº de cenas (ou monte as cenas na mão com `add_scene`/`edit_scene`: `script` = narração,
   `imagePrompt`, `motionPrompt`, `durationSec`). Defina a **ficha de personagem** (`update_project` → `character_sheet`)
   pra manter os rostos iguais.
3. Voz: `list_voices`; `update_project` com `voice_id`. Voz nova: `upload_file` (10–30 s limpos) → `create_voice`
   (exige `consentName` = quem autorizou).
4. `produce` com `kind: "image"` → imagens de todas as cenas (cota grátis). Confira cada uma; refaça as ruins
   (variações) antes de animar.
5. `estimate_project` com `kind: "video"` → mostra o custo. Se for pago, **pergunte antes**.
6. Vídeo: `produce` com `kind: "video"` (pago: `allowPaid: true` só depois do sim), **ou** `still_scene` em cada cena
   (plano parado, grátis). Use plano parado também quando a IA errar (texto torto, objeto se transformando, olho brilhando).
7. `narrate_project` → **uma tomada contínua** de toda a narração. Confira o `check` (falou tudo? velocidade 2,8–5 palavras/s).
   Se falhar, ajuste `speech_rate`/`narration_style` com `update_project` e gere de novo.
8. `render_project` (`wait: true`) → MP4 9:16 com legenda karaokê, cards e trilha. Custo zero.
9. Confira o vídeo (tire quadros com ffmpeg e olhe). Entregue o arquivo de `storage/renders/<id>.mp4`.

### Mesmo fluxo via HTTP
```bash
API=http://localhost:4000/v1
# 1) projeto
curl -s -X POST $API/projects -H 'content-type: application/json' -d '{"title":"O dia que a usina ligou","style":"comic"}'
# 2) roteiro automático (ou PUT $API/projects/<id>/scenes com a lista de cenas)
curl -s -X POST $API/script -H 'content-type: application/json' \
  -d '{"projectId":"<id>","theme":"...","scenes":8,"style":"comic","characterSheet":"Zé: ... / Victor: ..."}'
# cenas na mão: {"scenes":[{"script":"narração","image_prompt":"...","motion_prompt":"...","duration_sec":5}, {"type":"card","card":{"text":"COMENTE SAFRA","button":"COMENTAR"}}]}
# 3) voz
curl -s -X POST $API/uploads -F file=@amostra.wav            # → url /storage/uploads/...
curl -s -X POST $API/voices -H 'content-type: application/json' \
  -d '{"name":"Victor","referenceUrl":"/storage/uploads/...","consentName":"Nome completo"}'
curl -s -X PATCH $API/projects/<id> -H 'content-type: application/json' -d '{"voice_id":"<voiceId>"}'
# 4–6) estimar e gerar (kind: image | video | audio). Pago exige "allowPaid":true (só depois do sim)
curl -s -X POST $API/projects/<id>/estimate -H 'content-type: application/json' -d '{"kind":"video"}'
curl -s -X POST $API/projects/<id>/generate -H 'content-type: application/json' -d '{"kind":"image"}'
curl -s -X PATCH $API/projects/<id> -H 'content-type: application/json' -d '{"video_model":"minimax-h3:720p"}'  # caminho B
curl -s -X POST $API/projects/<id>/scenes/<sceneId>/still -H 'content-type: application/json' -d '{"zoom":1.12}'  # plano parado
# 7) narração contínua e conferência
curl -s -X POST $API/projects/<id>/narration -H 'content-type: application/json' -d '{}'
curl -s $API/projects/<id>/narration      # job + check
# 8) render
curl -s -X POST $API/projects/<id>/render
curl -s $API/projects/<id>/status         # o que falta / url do render
```
Geração avulsa: `POST /v1/generate` com `{"request":{"kind":"video","prompt":"...","model":"minimax-h3","firstFrame":"/storage/images/x.png","resolution":"720p","durationSec":5,"ratio":"9:16"},"allowPaid":true}`.
Campos de imagem: `prompt`, `model`, `size`, `referenceImages[]`, `seed`. Áudio: `text`, `voiceRef`, `style`, `speechRate`, `format`.

### Regras de prompt que funcionam (aprendidas no Ep 1)
- Sempre terminar com: **"Sem texto, sem letras, sem números, sem balões escritos"** (ou em inglês "No text, no letters…").
  Texto na tela (preço, "COMENTE X", logo) entra na **edição**/cards do render, nunca na imagem.
- Mesma descrição de personagem, palavra por palavra, em todas as cenas; rosto real = foto de referência.
- Movimento: "movimento rápido e natural em tempo real, sem câmera lenta, sem objetos se transformando".
- Dinheiro brasileiro: "notas azul-claro de 100 reais, nunca dólares". Olhos: "íris castanho-escuras naturais, sem brilho".
- Uma ação por cena; cenas de 4–6 s.
- Errou? **Plano parado** em vez de gastar refazendo.

---

## 23. Trabalho em andamento (21/11/2026)

### Vídeo "O DIA QUE A USINA LIGOU" (com o Victor) — anúncio da Imersão Operação Safra Regular 2027
- Roteiro em 8 cenas (~55 s), estilo **quadrinho**: o Zé (piloto de drone que cobra barato e se enrola com documentação)
  → a usina pede ANAC, Anatel, DECEA, MAPA, Ibama, Crea e Defesa Agropecuária → o Zé soterrado em papel
  → o Victor (agrônomo) organiza tudo → contrato "SAFRA 2027" → CTA: imersão gratuita **10/12, 20h**, "comente SAFRA".
- O usuário pode estar fazendo as imagens no **Artlist** (Studio: personagem por foto + ângulos; estilo vai no campo
  Visual Style; vídeo de referência até 3 × 2–15 s, 15 s no total). Prompts prontos (copiar e colar):

```
ESTILO (usar em todas as cenas): História em quadrinhos colorida, traço preto grosso, cores chapadas e vibrantes com sombreado em retícula, expressões exageradas e engraçadas, clima de interior do Brasil, formato vertical 9:16. Sem texto, sem letras, sem balões escritos.
PERSONAGENS:
- Zé: homem do campo de uns 30 anos, pele morena, bigode, boné vermelho torto, camiseta cinza suada.
- Victor: agrônomo, com o mesmo rosto das fotos de referência (óculos, bigode, cabelo curto escuro). Roupa de peão: camisa xadrez de manga comprida dobrada até o cotovelo, calça jeans, cinto de couro com fivela grande, botas de couro marrom e chapéu de palha.
CENA 1: Lavoura ao amanhecer, drone agrícola branco voando baixo; o Zé segura o controle com cara de cansado.
CENA 2: O Zé olhando o celular com cara de aperto, suor voando da testa, mão na cabeça.
CENA 3: O Zé entrega um papelzinho a um sujeito de terno e óculos escuros que sai correndo com uma maleta, deixando poeira.
CENA 4: Close no Zé com o celular vibrando e brilhando na mão, olhos arregalados. Tela sem nada escrito.
CENA 5: Pilha gigante de papéis caindo do céu no meio da lavoura; só o boné vermelho do Zé aparece no topo.
CENA 6: O Victor, sorrindo, puxa o Zé pelo braço para fora da pilha, prancheta na outra mão.
CENA 6B: Close numa prancheta com 7 linhas (só traços) e um check verde-limão grande em cada uma.
CENA 7: Escritório de usina com canaviais na janela; o Zé de polo azul e pasta organizada aperta a mão de um engenheiro de capacete branco; o Victor faz joinha ao fundo.
CENA 8: O Victor na beira da lavoura olhando para a câmera, sorrindo, apontando para baixo; fundo verde-limão; parte de baixo livre.
MOVIMENTO: Movimento rápido e natural em tempo real, expressões exageradas de desenho animado, câmera se aproximando devagar, sem câmera lenta, sem objetos se transformando, sem texto.
```
- Textos de tela (na edição): "R$ 50/ha 😓", "– R$ 4.000 🤡", "USINA" no celular, "❌ FORA DA COTAÇÃO",
  "✅ CONTRATO FECHADO", "SAFRA 2027", "COMENTE "SAFRA" 👇", rodapé "Imersão gratuita · 10/12 · 20h", logo da Imersão.
- Vozes: narração e falas do Victor com a **voz clonada dele**; a usina com uma voz formal diferente.
- Custo estimado no H3 (fal): ~US$ 3,30 (~R$ 19); com refações ~US$ 5 (~R$ 28). Imagens e voz: cota grátis.

### Voz do Victor (integrante novo da equipe, autorizou o uso da voz)
- Amostra limpa pronta: `~/cb-studio/storage/uploads/voz-integrante-referencia.wav` (29,2 s, voz separada da música
  com o modelo UVR Kim_Vocal_2 rodando local, −18 LUFS). Origem: 2 vídeos do Instagram dele.
- **Falta:** o app estar aberto + o **nome completo** dele (campo `consentName`). Depois: `upload_file` → `create_voice`
  → gerar uma frase de teste e mandar pro usuário comparar.

### MiniMax H3 na fal
- Conta fal existe, **saldo US$ 0**. Aguardando a pessoa pôr US$ 10, criar a chave, colar `FAL_KEY` e `ZERO_COST=false`.
- Primeira coisa depois: 1 cena de teste (US$ 0,30) pra aprovar a qualidade antes da equipe usar.

### Custo por mês esperado com H3
~250 clipes de 5 s × US$ 0,30 = **US$ 75/mês (~R$ 430)**, contra ~US$ 300/mês no Seedance 2.5.
GPU própria: ~US$ 40–55/mês (estimativa, nunca rodada) — não compensa o trabalho nesse volume.

---

## 24. Separar voz de música (grátis, sem internet além do GitHub)

Usado na voz do Victor. Em qualquer máquina com Python:
```bash
pip install onnxruntime soundfile numpy
curl -L -o Kim_Vocal_2.onnx https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/Kim_Vocal_2.onnx
ffmpeg -i video.mp4 -vn -ac 1 -ar 44100 audio.wav
python3 sep_vocals.py Kim_Vocal_2.onnx audio.wav voz.wav    # script em scripts/sep_vocals.py
ffmpeg -i voz.wav -af "atrim=0:29,loudnorm=I=-18:TP=-1.5" -ar 44100 -ac 1 amostra.wav
```
Amostra boa pra clonar: 10–30 s, só a pessoa falando, cortada numa pausa.
