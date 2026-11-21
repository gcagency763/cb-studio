# CB Studio na nuvem — um container só: site (Next) + API + worker, dividindo o mesmo disco.
# Railway/Render/Fly leem este arquivo sozinhos. Postgres e Redis vêm como serviços à parte.
FROM node:22-bookworm-slim

# ffmpeg com libass (legendas) + fontes compatíveis com Arial (Liberation Sans)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-liberation fontconfig ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# dependências primeiro (cache do build)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/mcp/package.json apps/mcp/
COPY packages/db/package.json packages/db/
COPY packages/providers/package.json packages/providers/
RUN pnpm install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# o site chama a API dentro do próprio container
ENV API_URL=http://127.0.0.1:4000
RUN pnpm --filter @g2/web build

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    STORAGE_DIR=/data/storage \
    AUTH_REQUIRED=true \
    COOKIE_SECURE=true
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "infra/cloud/start.sh"]
