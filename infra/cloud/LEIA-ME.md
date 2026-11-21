# CB Studio na nuvem (Railway)

Um serviço só roda o site, a API e o worker juntos (arquivo `Dockerfile` na raiz). Do lado da Railway entram mais dois
serviços prontos: **Postgres** e **Redis**. Os arquivos (vídeos, imagens, áudios) ficam num **bucket** — o disco do
container é só cache e pode ser pequeno.

## O que criar no projeto da Railway

1. **New → Database → PostgreSQL** e **New → Database → Redis**.
2. **New → Bucket** (ou um bucket no Cloudflare R2). Anote endpoint, nome, access key e secret.
3. **New → GitHub Repo → cb-studio**. A Railway acha o `Dockerfile` e o `railway.json` sozinha.
4. No serviço do app, aba **Variables**:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | o primeiro admin (criado sozinho no primeiro boot) |
| `API_TOKEN` | um texto aleatório longo — é o que o MCP usa (`G2_API_TOKEN`) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | do bucket |
| `S3_REGION` | `auto` (R2) ou a região que o bucket mostrar |
| `ARK_API_KEY` e as outras chaves | as mesmas do `.env` do Mac |

Já vêm ligadas no Dockerfile: `AUTH_REQUIRED=true`, `COOKIE_SECURE=true`, `STORAGE_DIR=/data/storage`.

5. **Settings → Networking → Generate Domain**. Entre com o admin e cadastre a equipe em Provedores → Equipe.

## Transcrição (Cortes e legenda automática)

Usa o Whisper. Na nuvem é mais um serviço: **New → Docker Image** `onerahmet/openai-whisper-asr-webservice`
com `ASR_ENGINE=faster_whisper` e `ASR_MODEL=small`, e no app `WHISPER_URL=http://<nome-do-serviço>.railway.internal:9000`.
Sem ele, todo o resto funciona; só Cortes e legenda automática ficam parados.

## Preços da Railway (conferidos em 13/11/2026)

- Plano Hobby: US$ 5/mês, com US$ 5 de uso incluso. Pro: US$ 20/mês, com US$ 20 incluso.
- Uso: US$ 20 por vCPU/mês e US$ 10 por GB de RAM/mês (cobrado por segundo).
- Disco (volume): US$ 0,15 por GB/mês — no Hobby o limite é 5 GB, por isso os arquivos vão pro bucket.
- Bucket da Railway: US$ 0,015 por GB/mês, sem custo de saída.

Nada disso é ligado sem a aprovação do Cirilo — criar conta e pôr cartão é com vocês.
