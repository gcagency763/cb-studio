# @g2/mcp — CB Studio pelo Claude

Servidor MCP que expõe o estúdio inteiro (imagem, vídeo, narração, clone, quadrinhos, render, biblioteca, gastos) para o Claude Desktop, Claude Code, Cowork ou qualquer cliente MCP.

## Ligar ao Claude Desktop

Duplo clique em **`Conectar ao Claude.command`** (raiz do repo) e reinicie o Claude. Ele grava em `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cb-studio": {
      "command": "/CAMINHO/cb-studio/apps/mcp/bin/cb-studio-mcp",
      "env": { "G2_API_URL": "http://localhost:4000/v1", "G2_STUDIO_URL": "http://localhost:3000" }
    }
  }
}
```

Claude Code: `claude mcp add cb-studio -- /CAMINHO/cb-studio/apps/mcp/bin/cb-studio-mcp`

HTTP (pra outros agentes): `pnpm --filter @g2/mcp http` → `POST http://localhost:4100/mcp`

O CB Studio precisa estar rodando (`Iniciar CB Studio.command`).

## Regra do cartão

Nada vai pro cartão sem o usuário autorizar o valor. Toda ferramenta que gera estima antes; se o custo é cobrado (fal.ai, ElevenLabs, Seedance 2.x), ela devolve o valor e **não executa** até ser chamada com `confirmPaid: true` — que o Claude só passa depois do sim explícito do usuário. Modelos grátis (Seedream 4.5, Seedance 1.0 fast, Seed Audio até 60 min) rodam direto.

## Ferramentas

| grupo | ferramentas |
|---|---|
| status | `studio_status`, `list_models`, `capabilities`, `estimate_cost` |
| gerar | `generate_image`, `generate_video`, `generate_narration`, `generate_sfx`, `upscale_image` |
| clone | `clone_person`, `lipsync`, `list_voices`, `create_voice` |
| vídeo gravado | `transcribe`, `get_transcript`, `caption_video`, `dub_video`, `make_cuts`, `rerender_cut`, `recreate_from_video`, `review_virality` |
| anúncios em escala | `ads_hooks`, `ads_create`, `ads_status`, `ads_produce`, `ads_render` |
| vídeo | `extend_video`, `upscale_video` |
| carrossel | `make_carousel` |
| publicar | `set_brand_logo`, `write_copy`, `publish_instagram`, `publish_youtube`, `publish_meta_ads` |
| biblioteca | `list_library`, `get_job`, `wait_job`, `upload_file` |
| quadrinhos | `list_projects`, `get_project`, `create_project`, `write_script`, `update_project`, `edit_scene`, `add_scene`, `remove_scene`, `estimate_project`, `produce`, `wait_project`, `render_project`, `delete_project` |

Recursos: `g2://capabilities` (tudo que dá pra fazer), `g2://models`, `g2://tips` (regras de produção). Prompts: `quadrinho`, `clone`, `rotina` (texto pronto pra tarefa agendada diária).

## Exemplo

> "Faz um quadrinho sobre a aluna que vendeu 300 peças na Shopee sem estoque, estilo épico, com a voz do Cirilo, e me manda o MP4."

O Claude chama `create_project` → mostra o roteiro → `produce(image)` → `produce(audio)` → `produce(video)` (pergunta o valor se for pago) → `render_project` → link.
