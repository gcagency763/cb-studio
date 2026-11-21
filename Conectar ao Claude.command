#!/bin/bash
# Liga o CB Studio ao Claude Desktop (MCP). Duplo clique, depois reinicie o Claude.
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
ROOT="$(pwd)"
echo "▶ instalando o MCP (pnpm install)…"
pnpm install --filter @g2/mcp >/dev/null 2>&1 || pnpm install >/dev/null 2>&1
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")"
[ -f "$CFG" ] || echo '{}' > "$CFG"
node - "$CFG" "$ROOT" <<'JS'
const fs = require("fs");
const [cfgPath, root] = process.argv.slice(2);
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8") || "{}"); } catch { cfg = {}; }
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers["cb-studio"] = { command: `${root}/apps/mcp/bin/cb-studio-mcp`, args: [], env: { G2_API_URL: "http://localhost:4000/v1", G2_STUDIO_URL: "http://localhost:3000" } };
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
console.log("✔ cb-studio adicionado em " + cfgPath);
JS
echo
echo "Agora feche e abra o Claude Desktop. Na conversa, procure o conector 'cb-studio'."
echo "Teste: pergunte ao Claude \"qual o status do CB Studio?\""
echo
echo "Pra usar no Claude Code: claude mcp add cb-studio -- \"$ROOT/apps/mcp/bin/cb-studio-mcp\""
sleep 5
