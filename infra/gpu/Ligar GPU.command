#!/bin/bash
# CB Studio — liga a GPU própria (Wan 2.2 no Modal). Duplo clique no Finder.
# 1) login no Modal  2) cria a senha entre o app e a GPU  3) baixa o modelo  4) publica  5) escreve no .env
set -e
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
ENVF="$ROOT/.env"
VENV="$ROOT/infra/gpu/.venv"

echo "== CB Studio · GPU própria (Modal) =="
command -v python3 >/dev/null || { echo "Precisa do Python 3 (instale pelo python.org) e rode de novo."; read -r; exit 1; }
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade "modal==1.6.4"
M="$VENV/bin/modal"

if ! "$M" profile current >/dev/null 2>&1; then
  echo "→ Vai abrir o navegador pra entrar na sua conta do Modal."
  "$M" setup
fi
WS="$("$M" profile current)"
echo "→ conta Modal: $WS"

# senha entre o app e a GPU (fica só no .env e no Modal — não aparece na tela)
TOKEN="$(grep -E '^G2_GPU_TOKEN=' "$ENVF" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 24)"
"$M" secret create g2-gpu "G2_GPU_TOKEN=$TOKEN" --force >/dev/null
echo "→ senha da GPU criada"

echo "→ baixando o modelo pro volume do Modal (~60 GB, só na primeira vez; 10–20 min, sem GPU)…"
"$M" run "$ROOT/infra/gpu/g2_video.py::download"

echo "→ publicando…"
"$M" deploy "$ROOT/infra/gpu/g2_video.py" | tee /tmp/g2-gpu-deploy.log
URL="$(grep -oE 'https://[A-Za-z0-9._-]*g2-video-api[A-Za-z0-9._-]*\.modal\.run' /tmp/g2-gpu-deploy.log | head -1)"
[ -n "$URL" ] || URL="https://${WS}--g2-video-api.modal.run"

touch "$ENVF"
grep -v -E '^(G2_GPU_URL|G2_GPU_TOKEN)=' "$ENVF" > "$ENVF.tmp" || true
printf 'G2_GPU_URL=%s\nG2_GPU_TOKEN=%s\n' "$URL" "$TOKEN" >> "$ENVF.tmp"
mv "$ENVF.tmp" "$ENVF"
echo "→ .env atualizado (G2_GPU_URL e G2_GPU_TOKEN)"

if curl -fsS "$URL/health" >/dev/null; then
  echo "✓ GPU no ar: $URL"
else
  echo "! publicado, mas o teste de saúde não respondeu ainda — tente de novo em 1 min: curl $URL/health"
fi
echo
echo "Agora reinicie o CB Studio (Iniciar CB Studio.command). O modelo 'Wan 2.2 (GPU própria)' aparece no seletor de vídeo."
echo "Importante: no modal.com → Settings → Usage, ponha um limite de gasto (ex.: US\$ 30) pra nunca passar do crédito grátis."
read -r -p "Enter pra fechar"
