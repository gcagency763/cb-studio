# CB Studio — Estúdio de vídeo IA da G2 Educação

O "Higgsfield da G2": tema → roteiro → imagem cena a cena → animação → narração clonada → legenda karaokê → MP4, com todos os modelos que a equipe usa no Higgsfield disponíveis por API, controlável pelo Claude (MCP) e com custo medido em tempo real.

```
apps/web            Next.js 15 — Explorar, Imagem, Vídeo, Áudio, Quadrinhos, Clone, Cortes, Biblioteca, Gastos, Provedores, Tudo que dá pra fazer
apps/api            Fastify + BullMQ — API, filas (generation / render / edit), worker, guardas de custo, linha de produção dos projetos
apps/mcp            servidor MCP (stdio + HTTP): 33 ferramentas pra Claude Desktop / Claude Code / Cowork
packages/providers  catálogo de modelos + adapters submit / poll / download (BytePlus, Seed Audio, fal.ai, ElevenLabs)
packages/db         migrações SQL (Postgres)
```

## No Mac (uso diário)

| arquivo | o que faz |
|---|---|
| `Iniciar CB Studio.command` | sobe Postgres/Redis/Whisper (OrbStack), API, worker e web; abre http://localhost:3000 |
| `Parar CB Studio.command` | para tudo |
| `Configurar Voz.command` | cola a chave do Seed Speech no `.env` |
| `Conectar ao Claude.command` | registra o MCP no Claude Desktop (depois: ⌘Q e abrir o Claude) |

Chaves ficam só no `.env` (nunca no git). Veja `.env.example`.

## Regra nº 1 — custo
- Nada vai pro cartão sem confirmação com o valor na tela (app) ou `confirmPaid: true` (MCP).
- `MAX_JOB_COST_USD` (padrão **0,50**): a API responde **402** acima disso sem `allowPaid: true`.
- Modelos pagos (fal.ai, ElevenLabs, Seedance 2.x) ficam **travados** até existir a chave/crédito; o motivo aparece no app.
- BytePlus em **Free Credits Only Mode**: quando a cota grátis acaba, o modelo pausa — não cobra.
- Seed Audio: 60 min grátis; o app trava em `VOICE_FREE_MINUTES` (55) pra não cobrar US$ 0,15/min.

## O que faz hoje (grátis, cartão US$ 0)
- **Quadrinhos**: roteiro com as regras da G2 (Seed 2.1), imagens Seedream 4.5, vídeos Seedance 1.0 fast, narração Seed Audio (voz clonada, WAV), legenda karaokê, cards, trilha com ducking, MP4 9:16.
- **Cortes**: aula/live → transcrição local (Whisper no Docker) → Seed 2.1 escolhe os trechos → clipes 9:16 legendados com gancho e nota. **Só legendar** também.
- **Clone**: foto + voz clonada + texto → pessoa falando (OmniHuman / Kling Avatar / Seedance 2.5 — pagos, travados até liberar).
- **Gastos**: por dia, por modelo, cotas grátis, o que foi pro cartão.
- **MCP**: "faz um quadrinho sobre X com a voz do Cirilo e me manda o MP4".

Mapa completo (pronto · em breve · planejado · ideias de Higgsfield, Runway, Pika, HeyGen, OpusClip…): http://localhost:3000/roadmap ou `GET /v1/capabilities`.

## Rodando na mão

```bash
cp .env.example .env          # ARK_API_KEY, SEED_SPEECH_API_KEY…
pnpm install
docker compose up -d postgres redis whisper
pnpm --filter @g2/api dev     # API em :4000 (roda as migrações)
pnpm --filter @g2/api worker  # worker das filas
pnpm --filter @g2/web dev     # UI em :3000
pnpm --filter @g2/mcp dev     # MCP (stdio) — ou `http` pra expor em :4100/mcp
```

## Transcrição (Cortes)
Serviço `whisper` no `docker-compose.yml` (faster-whisper em CPU, arm64). `WHISPER_MODEL=small` (padrão, rápido) · `medium` · `large-v3-turbo` (melhor em PT, ~3× mais lento). A primeira vez baixa a imagem (~1,8 GB) e o modelo. Transcrições ficam em `storage/transcripts/` e são reaproveitadas.

## Cortes, legenda, dublagem
Whisper local (Docker) + Seed 2.1 + FFmpeg: cortes virais com nota, legenda karaokê, edição automática (pausas, “ééé”, zoom), b-roll gerado, **reenquadre que segue quem fala** (detector de rosto pico em JS puro, `apps/api/assets/facefinder`), ajuste de corte na mão e **dublagem** pra inglês/espanhol/… com a voz do próprio vídeo (Seed Audio, cota grátis).

## Publicar direto
Botão “Publicar” no vídeo final e nos cortes: **Instagram Reels** (token do Meta no `.env`), **YouTube Shorts** (conecta o canal uma vez em Provedores → Publicar, OAuth em modo de teste do Google Cloud) e **Meta Ads** (vídeo na conta de anúncios). Tudo custo zero — é configuração.

## Próximos (ver /roadmap)
TikTok (app precisa de aprovação) · dublagem · música gerada · motion transfer, troca de objeto, restyle, extend, upscale de vídeo (modelos pagos) · infra pra time (login, servidor, gasto por pessoa).
