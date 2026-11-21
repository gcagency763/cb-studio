#!/bin/bash
# Pede a chave do Seed Speech numa janela, grava no .env e reinicia o CB Studio.
cd "$(dirname "$0")"
KEY=$(osascript -e 'text returned of (display dialog "Cole aqui a API Key do Seed Speech (BytePlus → Seed Speech → API Key → ícone do olho → copiar):" default answer "" with title "CB Studio — chave de voz" buttons {"Cancelar","Salvar"} default button "Salvar" with hidden answer)' 2>/dev/null)
if [ -z "$KEY" ]; then
  osascript -e 'display alert "Nada salvo." message "A chave ficou vazia ou você cancelou."'
  exit 0
fi
KEY=$(echo "$KEY" | tr -d '[:space:]')
touch .env
if grep -q '^SEED_SPEECH_API_KEY=' .env; then
  sed -i '' "s|^SEED_SPEECH_API_KEY=.*|SEED_SPEECH_API_KEY=$KEY|" .env
else
  printf '\nSEED_SPEECH_API_KEY=%s\n' "$KEY" >> .env
fi
grep -q '^VOICE_FREE_MINUTES=' .env || printf 'VOICE_FREE_MINUTES=55\n' >> .env
osascript -e 'display notification "Chave de voz salva. Reiniciando o CB Studio…" with title "CB Studio"'
open "Iniciar CB Studio.command"
