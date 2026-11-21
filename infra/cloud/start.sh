#!/usr/bin/env bash
# sobe API + worker + site no mesmo container; se um cair, o container reinicia inteiro (a plataforma religa)
set -euo pipefail
cd /app
mkdir -p "${STORAGE_DIR:-/data/storage}"

API_PORT=4000
WEB_PORT="${PORT:-3000}"
export API_URL="http://127.0.0.1:${API_PORT}"

if [ "${AUTH_REQUIRED:-true}" = "true" ] && [ -z "${ADMIN_EMAIL:-}" ]; then
  echo "[g2] aviso: AUTH_REQUIRED=true sem ADMIN_EMAIL/ADMIN_PASSWORD — se o banco estiver vazio ninguém consegue entrar"
fi

PORT=$API_PORT pnpm --filter @g2/api exec tsx src/server.ts &
API=$!
# o worker espera a API aplicar as migrações
sleep 6
pnpm --filter @g2/api exec tsx src/worker.ts &
WORKER=$!
pnpm --filter @g2/web exec next start -p "$WEB_PORT" -H 0.0.0.0 &
WEB=$!

trap 'kill $API $WORKER $WEB 2>/dev/null' TERM INT
wait -n $API $WORKER $WEB
echo "[g2] um dos processos saiu — reiniciando o container"
kill $API $WORKER $WEB 2>/dev/null || true
exit 1
