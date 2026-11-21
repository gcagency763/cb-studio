#!/bin/bash
# CB Studio — liga o MiniMax H3 na GPU própria (Modal, 4× H100). EXPERIMENTAL. Duplo clique no Finder.
# Antes: aceitar a licença em https://huggingface.co/MiniMaxAI/MiniMax-H3 e criar um token (read) no Hugging Face.
set -e
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
ENVF="$ROOT/.env"
VENV="$ROOT/infra/gpu/.venv"

echo "== CB Studio · MiniMax H3 na GPU própria =="
command -v python3 >/dev/null || { echo "Precisa do Python 3 (python.org) e rode de novo."; read -r; exit 1; }
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade "modal==1.6.4"
M="$VENV/bin/modal"
"$M" profile current >/dev/null 2>&1 || { echo "→ Vai abrir o navegador pra entrar no Modal."; "$M" setup; }

TOKEN="$(grep -E '^G2_GPU_TOKEN=' "$ENVF" 2>/dev/null | cut -d= -f2- || true)"
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 24)"
"$M" secret create g2-gpu "G2_GPU_TOKEN=$TOKEN" --force >/dev/null

echo "Cole o token do Hugging Face (não aparece na tela) e aperte Enter:"
read -r -s HFT
[ -n "$HFT" ] || { echo "sem token, parei."; read -r; exit 1; }
"$M" secret create g2-hf "HF_TOKEN=$HFT" --force >/dev/null
unset HFT
echo "→ tokens guardados no Modal"

echo "→ baixando o H3 + Turbo pro volume (~120 GB, só na 1ª vez; pode levar 30–60 min, sem GPU)…"
"$M" run "$ROOT/infra/gpu/g2_h3.py::download"

echo "→ publicando…"
"$M" deploy "$ROOT/infra/gpu/g2_h3.py" | tee /tmp/g2-h3-deploy.log
URL="$(grep -oE 'https://[A-Za-z0-9._-]*g2-h3-api[A-Za-z0-9._-]*\.modal\.run' /tmp/g2-h3-deploy.log | head -1)"
[ -n "$URL" ] || { echo "não achei a URL no log do deploy — veja /tmp/g2-h3-deploy.log"; read -r; exit 1; }

touch "$ENVF"
grep -v -E '^(G2_GPU_H3_URL|G2_GPU_TOKEN)=' "$ENVF" > "$ENVF.tmp" || true
printf 'G2_GPU_H3_URL=%s\nG2_GPU_TOKEN=%s\n' "$URL" "$TOKEN" >> "$ENVF.tmp"
mv "$ENVF.tmp" "$ENVF"
curl -fsS "$URL/health" >/dev/null && echo "✓ H3 no ar: $URL" || echo "! publicado; o teste de saúde ainda não respondeu — tente em 1 min: curl $URL/health"
echo
echo "Reinicie o CB Studio. O modelo 'MiniMax H3 (GPU própria)' aparece no seletor de vídeo."
echo "Importante: limite de gasto no modal.com → Settings → Usage (4× H100 custam ~US\$ 16/h enquanto ligadas)."
read -r -p "Enter pra fechar"
