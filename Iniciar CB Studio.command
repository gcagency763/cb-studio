#!/bin/bash
# Sobe Postgres/Redis (OrbStack), API, worker e web do CB Studio. Duplo clique pra abrir.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.orbstack/bin:$PATH"
mkdir -p .logs
echo "▶ CB Studio — subindo serviços…"
open -a OrbStack 2>/dev/null; sleep 4
docker compose up -d postgres redis
# transcrição local (Cortes) — sobe em segundo plano; a 1ª vez baixa a imagem (~1,8 GB) e o modelo
nohup docker compose up -d whisper > .logs/whisper.log 2>&1 &
# instala dependências novas (MCP etc.) — rápido quando nada mudou
pnpm install --prefer-offline >/dev/null 2>&1 || true
# mata pai E filhos (tsx watch deixa o node filho vivo com o .env antigo)
for pat in "src/server.ts" "src/worker.ts" "next dev" "next-server" "next-router-worker"; do pkill -f "$pat" 2>/dev/null; done; sleep 2
for pat in "src/server.ts" "src/worker.ts" "next-server"; do pkill -9 -f "$pat" 2>/dev/null; done; sleep 1
nohup pnpm --filter @g2/api dev    > .logs/api.log    2>&1 &
nohup pnpm --filter @g2/api worker > .logs/worker.log 2>&1 &
nohup pnpm --filter @g2/web dev    > .logs/web.log    2>&1 &
sleep 8
echo
echo "✔ API    → http://localhost:4000/health"
echo "✔ Web    → http://localhost:3000"
echo "  logs em .logs/ (api.log, worker.log, web.log)"
echo
echo "Pode fechar esta janela — os serviços continuam rodando."
echo "Pra parar: duplo clique em 'Parar CB Studio.command'."
sleep 3
open http://localhost:3000
