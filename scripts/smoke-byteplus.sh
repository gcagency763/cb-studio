#!/usr/bin/env bash
# Smoke test BytePlus ModelArk — roda com a chave SÓ no seu ambiente.
#
#   export ARK_API_KEY="..."          # ou coloque no .env e rode: set -a; . ./.env; set +a
#   bash scripts/smoke-byteplus.sh            # imagem (Seedream) + vídeo 480p 5s (Seedance 1.0 pro)
#   bash scripts/smoke-byteplus.sh image      # só imagem
#   bash scripts/smoke-byteplus.sh video      # só vídeo
#
# Consumo: só cota grátis (Free Credits Only Mode ligado na conta).
set -euo pipefail

: "${ARK_API_KEY:?defina ARK_API_KEY no ambiente (não cole em chat nem commite)}"
BASE="${ARK_BASE_URL:-https://ark.ap-southeast.bytepluses.com/api/v3}"
IMG_MODEL="${ARK_IMAGE_MODEL:-seedream-4-5-251128}"
VID_MODEL="${ARK_VIDEO_MODEL:-seedance-1-0-pro-250528}"
MODE="${1:-all}"
OUT="${SMOKE_OUT:-./storage/smoke}"; mkdir -p "$OUT"

auth=(-H "Authorization: Bearer $ARK_API_KEY" -H "Content-Type: application/json")

if [[ "$MODE" == "all" || "$MODE" == "image" ]]; then
  echo "▶ imagem ($IMG_MODEL)…"
  resp=$(curl -sS "$BASE/images/generations" "${auth[@]}" -d @- <<EOF
{"model":"$IMG_MODEL","prompt":"Comic book style, bold ink outlines, halftone shading: a young Brazilian entrepreneur at a desk at night, laptop glowing, shipping boxes around, warm rim light, vertical composition","size":"1440x2560","response_format":"url","watermark":false}
EOF
)
  url=$(echo "$resp" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("data",[{}])[0].get("url",""))' 2>/dev/null || true)
  if [[ -z "$url" ]]; then echo "✖ imagem falhou:"; echo "$resp"; exit 1; fi
  curl -sS "$url" -o "$OUT/image.png"; echo "✔ imagem salva em $OUT/image.png"
fi

if [[ "$MODE" == "all" || "$MODE" == "video" ]]; then
  echo "▶ vídeo ($VID_MODEL) 9:16 480p 5s…"
  resp=$(curl -sS "$BASE/contents/generations/tasks" "${auth[@]}" -d @- <<EOF
{"model":"$VID_MODEL","content":[{"type":"text","text":"Comic book style, vertical video. A young Brazilian entrepreneur at a desk at night, laptop glowing, packages stacked around; he smiles as a sale notification lights the screen. Slow push-in, bold ink outlines, halftone shading, cinematic. --ratio 9:16 --resolution 480p --duration 5 --watermark false"}]}
EOF
)
  task=$(echo "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)
  if [[ -z "$task" ]]; then echo "✖ submit falhou:"; echo "$resp"; exit 1; fi
  echo "  task $task — aguardando…"
  for i in $(seq 1 60); do
    sleep 5
    st=$(curl -sS "$BASE/contents/generations/tasks/$task" "${auth[@]}")
    status=$(echo "$st" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
    printf "  [%02d] %s\n" "$i" "$status"
    if [[ "$status" == "succeeded" ]]; then
      vurl=$(echo "$st" | python3 -c 'import sys,json;print(json.load(sys.stdin)["content"]["video_url"])')
      curl -sS "$vurl" -o "$OUT/video.mp4"; echo "✔ vídeo salvo em $OUT/video.mp4"
      echo "$st" | python3 -c 'import sys,json;print("  usage:",json.load(sys.stdin).get("usage"))'
      exit 0
    fi
    if [[ "$status" == "failed" || "$status" == "cancelled" ]]; then echo "✖ falhou:"; echo "$st"; exit 1; fi
  done
  echo "✖ timeout"; exit 1
fi
