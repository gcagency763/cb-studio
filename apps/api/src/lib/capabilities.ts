/**
 * Mapa de capacidades do CB Studio: o que já dá pra fazer, o que vem em seguida e
 * de onde veio cada ideia (Higgsfield e outras plataformas gringas).
 * Servido em GET /capabilities — alimenta a página "Tudo que dá pra fazer", o Explorar e o MCP.
 */
export type Area = "quadrinhos" | "imagem" | "video" | "audio" | "clone" | "edicao" | "anuncios" | "publicar" | "controle";
export type Status = "pronto" | "em-breve" | "planejado" | "ideia";

export type Capability = {
  id: string;
  title: string;
  desc: string;
  area: Area;
  status: Status;
  /** rota no app quando está pronto */
  href?: string;
  /** como fazemos / faríamos (modelo, API, biblioteca) */
  via?: string;
  /** quem tem isso hoje (referência) */
  from?: string[];
  /** custo típico por uso */
  cost?: string;
  /** 1 = próximo sprint (grátis/local), 2 = precisa provedor pago, 3 = longo prazo */
  phase?: 1 | 2 | 3;
  /** ferramenta do MCP que cobre isso */
  mcp?: string;
};

export const AREAS: Record<Area, { label: string; desc: string }> = {
  quadrinhos: { label: "Quadrinhos", desc: "tema → vídeo pronto com narração e legenda" },
  imagem: { label: "Imagem", desc: "cenas, personagens, produtos, upscale" },
  video: { label: "Vídeo", desc: "animar, estender, reenquadrar, editar" },
  audio: { label: "Áudio", desc: "narração, vozes, efeitos, música, dublagem" },
  clone: { label: "Clone", desc: "pessoas reais falando sem gravar" },
  edicao: { label: "Edição", desc: "cortes, legendas, zooms, b-roll, montagem" },
  anuncios: { label: "Anúncios", desc: "criativos em escala a partir do produto" },
  publicar: { label: "Publicar", desc: "sair do estúdio direto pras redes e pros anúncios" },
  controle: { label: "Controle", desc: "pelo Claude, por API, custos e cotas" },
};

export const CAPABILITIES: Capability[] = [
  // ───────────── pronto ─────────────
  { id: "comic-pipeline", area: "quadrinhos", status: "pronto", href: "/projects", mcp: "create_project · produce · render_project", title: "Tema → vídeo pronto", desc: "Roteiro com ficha de personagem, imagem cena a cena, animação, narração clonada, legenda karaokê e cards — o fluxo do TDV_VENDA71.", via: "Seed 2.1 (roteiro) + Seedream 4.5 + Seedance 1.0/2.5 + Seed Audio + FFmpeg", from: ["Higgsfield Content Factory", "Faceless Studio"], cost: "R$ 7–13 por vídeo de 1 min na cota grátis" },
  { id: "script", area: "quadrinhos", status: "pronto", href: "/projects", mcp: "write_script", title: "Roteirista com as regras da G2", desc: "Números por extenso, cenas de 4–5 s com uma ação, mão de perfil, sem reflexos, ficha repetida em toda imagem, gancho nos 3 primeiros segundos.", via: "ModelArk Seed 2.1 turbo", cost: "~US$ 0,005 por roteiro" },
  { id: "styles", area: "quadrinhos", status: "pronto", href: "/projects", title: "5 estilos visuais", desc: "Épico ilustrado (o que mais vendeu), quadrinhos, anime, cinemático, flat/motion — a mesma cena em qualquer estilo." },
  { id: "karaoke", area: "quadrinhos", status: "pronto", href: "/projects", title: "Legenda karaokê sincronizada", desc: "Palavra atual em dourado, caixa alta, contorno — igual aos anúncios que convertem. Pré-visualização ao vivo na mesa.", via: "timestamps por palavra do Seed Audio + libass", from: ["Submagic", "Captions"] },
  { id: "cards", area: "quadrinhos", status: "pronto", href: "/projects", title: "Cards de abertura e chamada", desc: "Título, linha menor e botão dourado, com fundo gerado — pra abrir o vídeo e fechar com o CTA." },
  { id: "music-duck", area: "quadrinhos", status: "pronto", href: "/projects", title: "Trilha com ducking", desc: "Música de fundo abaixa sozinha quando a narração entra.", via: "FFmpeg sidechain" },
  { id: "image-gen", area: "imagem", status: "pronto", href: "/image", mcp: "generate_image", title: "Imagem com o modelo que você escolher", desc: "Seedream 4.5 (grátis), GPT Image 2.5 Sunburst / 2.6 Flare e Sunburst, Nano Banana 2.1 com até 14 referências, Nano Banana Pro, GPT Image 1.5.", via: "BytePlus + fal.ai", from: ["Higgsfield"], cost: "US$ 0 (Seedream) · US$ 0,04–0,15 (pagos)" },
  { id: "refs", area: "imagem", status: "pronto", href: "/image", title: "Mesmo personagem em todas as cenas", desc: "Ficha do personagem no prompt + referências de imagem (Nano Banana 2.1 substitui o Soul ID).", from: ["Higgsfield Soul ID", "Kling Elements", "Vidu"] },
  { id: "upscale", area: "imagem", status: "pronto", href: "/image", mcp: "upscale_image", title: "Melhorar imagem (estilo Magnific)", desc: "Upscale criativo até 4× com controle de criatividade e semelhança.", via: "fal.ai Clarity Upscaler", cost: "US$ 0,03/MP", from: ["Magnific", "Krea Enhance"] },
  { id: "video-gen", area: "video", status: "pronto", href: "/video", mcp: "generate_video", title: "Animar com Seedance, Kling ou Grok", desc: "Seedance 1.0 (grátis), 2.0 mini/fast e 2.5 (fala sincronizada, 30 s), Kling 2.5 turbo / 2.6 / 3.0 Pro / 3.0 Turbo / 4.0, Grok Imagine 1.5. Preço na tela antes de gerar.", via: "BytePlus + fal.ai", from: ["Higgsfield"] },
  { id: "first-last", area: "video", status: "pronto", href: "/video", title: "Frame inicial + final", desc: "Mão com objeto, troca de cenário, qualquer transição controlada (Kling 3.0 Pro).", from: ["Kling", "Luma keyframes", "Veo Flow"] },
  { id: "talking-seedance", area: "clone", status: "pronto", href: "/clone", mcp: "clone_person", title: "Pessoa falando pela foto + voz", desc: "Foto + voz clonada + texto → a pessoa falando com a boca sincronizada (OmniHuman 1.5, Kling Avatar, Seedance 2.5 com áudio de referência).", via: "fal.ai + BytePlus", from: ["Higgsfield Cinema Studio", "HeyGen Avatar IV", "Hedra"], cost: "US$ 0,12–0,16/s" },
  { id: "lipsync", area: "clone", status: "pronto", href: "/clone", mcp: "lipsync", title: "Arrumar a boca de um vídeo pronto", desc: "Troca a fala de um vídeo gravado por outra narração mantendo o rosto.", via: "fal.ai Sync Lipsync 2 / 2 Pro", cost: "US$ 3–5/min", from: ["Sync Labs", "HeyGen"] },
  { id: "voice-clone", area: "audio", status: "pronto", href: "/audio", mcp: "create_voice · generate_narration", title: "Clonar voz com autorização", desc: "10–30 s de áudio viram a voz do expert; o cadastro registra quem autorizou. Narração em português com timestamps.", via: "Seed Audio 1.0 (60 min grátis) · ElevenLabs v4 (0,8 / 0,9)", from: ["ElevenLabs", "Higgsfield Audio"] },
  { id: "sfx", area: "audio", status: "pronto", href: "/audio", mcp: "generate_sfx", title: "Efeitos sonoros por texto (grátis)", desc: "“Porta batendo”, “caixa registradora”, “uau de plateia” — o papel do Mirelo. Agora pelo Seed Audio, na cota grátis de voz (ElevenLabs fica como alternativa paga).", via: "Seed Audio 1.0 (som de cena sem fala) · ElevenLabs SFX", cost: "US$ 0 (cota de voz)" },
  { id: "library", area: "controle", status: "pronto", href: "/library", mcp: "list_library", title: "Biblioteca de tudo", desc: "Imagens, vídeos, pessoas, áudios, vídeos finais e uploads — reaproveite qualquer coisa como referência." },
  { id: "usage", area: "controle", status: "pronto", href: "/usage", mcp: "studio_status", title: "Gastos e cotas em tempo real", desc: "O que foi pro cartão, o que saiu da cota grátis, por modelo e por dia. Cartão US$ 0 até você liberar." },
  { id: "guards", area: "controle", status: "pronto", href: "/settings", title: "Travas de custo", desc: "Modelos pagos travados até ter chave; confirmação com valor antes de cobrar; limite por geração; cota de voz grátis." },
  { id: "mcp", area: "controle", status: "pronto", href: "/settings", mcp: "todas", title: "Controlar pelo Claude (MCP)", desc: "Claude Desktop, Claude Code ou Cowork criam projetos, geram, montam e publicam — com as mesmas travas de custo.", via: "apps/mcp (stdio + HTTP)", from: ["Higgsfield MCP", "Supercomputer"] },
  { id: "cmdk", area: "controle", status: "pronto", href: "/explore", title: "⌘K e atalhos", desc: "Ir pra qualquer lugar, abrir projeto, escolher modelo; ↑↓ troca cena na mesa." },

  // ───────────── fase 1: grátis ou quase, próximo sprint ─────────────
  { id: "cuts", area: "edicao", status: "pronto", href: "/cuts", mcp: "make_cuts", title: "Cortes virais de vídeo longo", desc: "Aula ou live de 1 h → até 10 cortes de 15–90 s com gancho na tela, legenda karaokê, reenquadre 9:16 e nota de viralidade por corte.", via: "Whisper local (Docker) + Seed 2.1 escolhe os trechos + FFmpeg", from: ["OpusClip", "Submagic", "Captions"], cost: "US$ 0" },
  { id: "auto-captions", area: "edicao", status: "pronto", href: "/cuts", mcp: "caption_video · transcribe", title: "Legenda automática em vídeo gravado", desc: "Sobe o vídeo do expert, sai legendado no estilo karaokê da G2 (frases curtas, palavra atual em dourado, caixa alta), com gancho opcional no topo.", via: "Whisper local + libass", from: ["Submagic", "CapCut", "Captions"], cost: "US$ 0" },
  { id: "auto-edit", area: "edicao", status: "pronto", href: "/cuts", mcp: "caption_video(cutSilence, cutFillers, zooms)", title: "Edição automática: tira pausas, vícios e dá zoom", desc: "Remove silêncios e os “ééé”, “hum”, “né” de muleta e repetições (o Seed 2.1 marca na revisão da transcrição; a legenda acompanha o novo tempo) e dá punch-in de 8% nas frases fortes — nos cortes e no “Só legendar”. B-roll gerado incluso.", via: "transcrição + Seed 2.1 + FFmpeg (select/aselect, scale por frame)", from: ["Descript (remove filler words)", "Captions AI Edit", "Submagic"], cost: "US$ 0" },
  { id: "broll", area: "edicao", status: "pronto", href: "/cuts", mcp: "caption_video(broll) · make_cuts(broll)", title: "B-roll gerado nas palavras-chave", desc: "Seed 2.1 escolhe as frases com objeto, lugar ou número e o Seedream gera a imagem (foto real, épico, quadrinhos…), que entra por 2–3 s por cima da fala — em “Só legendar” e nos cortes. Efeitos sonoros nos pontos de virada: quando a ElevenLabs estiver ligada.", via: "Seed 2.1 + Seedream (cota grátis) + FFmpeg overlay", from: ["Submagic", "Captions"], cost: "US$ 0,04 por imagem (cota grátis)" },
  { id: "reframe", area: "video", status: "pronto", href: "/cuts", mcp: "caption_video", title: "Reenquadrar 9:16 · 1:1 seguindo quem fala", desc: "O mesmo vídeo pra Reels, feed e YouTube — o recorte segue o rosto de quem fala (detector local em JS, a câmera só se move quando a pessoa sai do quadro) ou corta o centro fixo. Em Cortes e em “Só legendar”.", via: "FFmpeg + pico (detector de rosto, sem GPU)", from: ["Higgsfield Reframe", "OpusClip"], cost: "US$ 0" },
  { id: "draft-mode", area: "video", status: "pronto", href: "/projects", mcp: "produce(kind=video, mode=upgrade)", title: "Rascunho 480p → final em 720p/1080p", desc: "Escolha o motor em 480p pra aprovar o movimento gastando metade dos tokens; troque pra 720p/1080p e clique “Refazer N em …” — só as cenas aprovadas são regeradas. Funciona com o Seedance 1.0 grátis e com os pagos.", via: "motor por projeto (modelo:resolução) + lote 'upgrade'", from: ["Higgsfield Seedance Draft Mode"], cost: "480p ≈ metade dos tokens do 720p" },
  { id: "grid", area: "imagem", status: "pronto", href: "/projects", title: "Grade de variações", desc: "4 versões alternativas da imagem de qualquer cena na mesa de edição; clica na melhor e ela entra no lugar (o vídeo regera depois).", via: "lote no Seedream (cota grátis)", from: ["Higgsfield Grid Mode", "Midjourney"], cost: "US$ 0,16 por 4 (cota grátis)" },
  { id: "video-analysis", area: "quadrinhos", status: "pronto", href: "/projects?novo=1", mcp: "recreate_from_video", title: "Recriar um vídeo de referência", desc: "Manda o vídeo que performou (seu ou de concorrente): o estúdio transcreve, entende gancho, batidas e CTA, e escreve o roteiro novo com o seu tema na mesma estrutura — direto no Quadrinhos.", via: "Whisper local + Seed 2.1 → roteiro", from: ["Higgsfield Video Analysis", "Ad Reference"], cost: "US$ 0" },
  { id: "virality", area: "quadrinhos", status: "pronto", href: "/projects", mcp: "review_virality", title: "Nota de viralidade antes de publicar", desc: "Gancho, ritmo, clareza da oferta e CTA avaliados com nota 0–10, melhorias concretas e o gancho reescrito — na mesa de edição e em qualquer transcrição.", via: "Seed 2.1 sobre roteiro ou transcrição", from: ["Higgsfield Virality Predictor", "OpusClip"], cost: "US$ 0" },
  { id: "dubbing", area: "audio", status: "pronto", href: "/cuts?tab=dub", mcp: "dub_video", title: "Dublar pro inglês, espanhol (e mais) com a sua voz", desc: "O mesmo vídeo em outra língua: transcreve, traduz no tempo da fala, fala com a voz de quem está no vídeo e troca o áudio — legenda traduzida opcional. Sem custo (cota grátis de voz). Boca refeita é o lipsync, que é pago.", via: "Whisper local + Seed 2.1 + Seed Audio (clone da própria voz) + FFmpeg", from: ["ElevenLabs Dubbing", "HeyGen Translate", "Higgsfield Dubbing"], cost: "US$ 0 (cota de voz)" },
  { id: "music", area: "audio", status: "pronto", href: "/projects", mcp: "generate_sfx(prompt com 'music')", title: "Trilha sonora gerada (experimental)", desc: "Música instrumental no clima do vídeo, com a duração do projeto, sem direito autoral de terceiros — pelo Seed Audio na cota grátis (qualidade varia; ElevenLabs Music fica como opção paga). Botão “Gerar trilha” em Legenda e trilha.", via: "Seed Audio 1.0 (modo instrumental) · ElevenLabs Music (pago)", from: ["Suno", "ElevenLabs Music", "Higgsfield Music"], cost: "US$ 0 (cota de voz)" },
  { id: "ads-studio", area: "anuncios", status: "pronto", href: "/ads", mcp: "ads_hooks · ads_create · ads_produce", title: "Anúncios em escala a partir do produto", desc: "Produto + oferta → ganchos com ângulos diferentes → um quadrinho por gancho (mesma ficha de personagem), produzidos em lote na cota grátis — pra testar no Meta Ads qual gancho vende.", via: "Seed 2.1 + Quadrinhos em lote", from: ["Higgsfield Ads Studio", "Arcads", "Creatify"], cost: "US$ 0 com o motor grátis" },
  { id: "ad-multiplier", area: "anuncios", status: "planejado", phase: 2, title: "Multiplicar um anúncio que funcionou", desc: "Troca produto, pessoa, cenário e gancho de um anúncio vencedor e gera 10 irmãos.", via: "Genjutsu-like: Kling 4.0 edit de clipe + Nano Banana swaps", from: ["Higgsfield Ad Multiplier", "Genjutsu", "Pika Swaps"] },
  { id: "ugc", area: "anuncios", status: "planejado", phase: 2, title: "UGC com ator de IA", desc: "Depoimento de “aluna” segurando o produto, câmera de celular, em 9:16 — com consentimento e rótulo de IA.", via: "AI Influencer (ficha + Nano Banana) + Clone", from: ["Arcads", "Creatify", "Higgsfield AI Influencer"] },
  { id: "brand-logo", area: "edicao", status: "pronto", href: "/settings#brand", mcp: "set_brand_logo", title: "Logo da marca nos vídeos", desc: "PNG com fundo transparente no canto dos cortes, legendas e dublagens (posição, tamanho e opacidade em Provedores → Marca; dá pra desligar por vídeo).", via: "FFmpeg overlay", from: ["CapCut", "Submagic (brand kit)"], cost: "pago na fal (Nano Banana + Kling Avatar/OmniHuman) ou Seedance 2.5" },
  { id: "carousel", area: "imagem", status: "pronto", href: "/carousel", mcp: "make_carousel", title: "Carrossel pro Instagram", desc: "Tema → capa com gancho, um ponto por slide e CTA, arte gerada no estilo escolhido e texto composto (1080×1350 ou 1:1) + legenda e hashtags. Zip pronto pra postar.", via: "Seed 2.1 + Seedream (cota grátis) + FFmpeg (ASS)", from: ["Canva Magic Design", "Predis.ai", "Higgsfield Marketing Studio"], cost: "US$ 0 (cota do Seedream)" },
  { id: "post-copy", area: "publicar", status: "pronto", href: "/cuts", mcp: "write_copy", title: "Legenda, título e hashtags escritos pelo que o vídeo diz", desc: "No botão Publicar: “Escrever com IA” lê a transcrição do corte (ou o roteiro do quadrinho) e escreve gancho, legenda, CTA e hashtags — Instagram, YouTube, TikTok ou texto de anúncio.", via: "Seed 2.1 (cota grátis de texto)", from: ["OpusClip (AI captions)", "Submagic"], cost: "US$ 0" },
  { id: "publish", area: "publicar", status: "pronto", href: "/settings#publish", mcp: "publish_instagram", title: "Publicar Reels direto do estúdio", desc: "Botão Publicar no vídeo final e nos cortes: posta o Reels com legenda na conta do Instagram. Precisa só de um token do Meta no .env (configuração, não custo).", via: "Instagram Graph API (upload resumível, sem URL pública)", from: ["Higgsfield Social Connectors", "Pippit"], cost: "US$ 0" },
  { id: "to-ads", area: "publicar", status: "pronto", href: "/settings#publish", mcp: "publish_meta_ads", title: "Subir como criativo no Meta Ads", desc: "O MP4 vai pra conta de anúncios com nome padronizado; o criativo é montado no Gerenciador ou pelo Claude com o MCP do Meta Ads.", via: "Marketing API advideos", from: ["Higgsfield Click-to-Ad"], cost: "US$ 0" },
  { id: "youtube", area: "publicar", status: "pronto", href: "/settings#publish", mcp: "publish_youtube", title: "Publicar no YouTube Shorts", desc: "Mesmo botão Publicar: sobe o MP4 no seu canal como Short (título, descrição, público/não listado/privado). Conecta o canal uma vez com a conta Google — sem aprovação do Google pro próprio canal.", via: "YouTube Data API v3 (OAuth do canal + upload resumível)", from: ["Higgsfield Social Connectors"], cost: "US$ 0" },
  { id: "tiktok", area: "publicar", status: "planejado", phase: 2, title: "Publicar no TikTok", desc: "Mesmo botão Publicar levando pro TikTok, com agendamento.", via: "TikTok Content Posting API (o app precisa de aprovação do TikTok — leva semanas)", from: ["Higgsfield Social Connectors"] },
  { id: "batch", area: "controle", status: "pronto", href: "/ads", mcp: "ads_produce · ads_render", title: "Produção em lote", desc: "Uma campanha inteira na fila: imagens → vozes → vídeos → montagem de todos os anúncios, com o custo total antes e tudo-ou-nada por projeto.", via: "fila BullMQ + linha de produção na API", from: ["Content Factory"] },
  { id: "schedule", area: "controle", status: "pronto", href: "/settings#mcp", mcp: "prompt 'rotina'", title: "Rotina diária pelo Claude", desc: "Tarefa agendada no Claude com o prompt 'rotina' do MCP: toda manhã escreve 3 roteiros do tema da semana, gera imagens e narração (grátis), dá a nota e deixa pra você aprovar.", via: "tarefas agendadas do Claude + MCP", from: ["Supercomputer AI Employees"], cost: "US$ 0" },

  // ───────────── fase 2–3: ideias fortes de outras plataformas ─────────────
  { id: "motion-transfer", area: "video", status: "planejado", phase: 2, title: "Transferir movimento (Genjutsu / Act-Two)", desc: "Você grava o gesto no celular; o personagem ilustrado repete o movimento e a expressão.", via: "Kling Motion Control (fal.ai)", from: ["Higgsfield Genjutsu", "Runway Act-Two", "Kling Motion Control"] },
  { id: "object-swap", area: "video", status: "planejado", phase: 2, title: "Trocar objeto ou produto num vídeo", desc: "O mesmo vídeo com outro produto na mão, outra roupa, outro cenário.", via: "Kling 4.0 edit · Wan VACE", from: ["Genjutsu", "Runway Aleph", "Pika Swaps"] },
  { id: "restyle", area: "video", status: "planejado", phase: 2, title: "Redesenhar um vídeo gravado em outro estilo", desc: "Aula gravada vira anime, quadrinho ou épico mantendo o movimento (Shorts Studio).", via: "Wan VACE / Gemini Omni Flash", from: ["Higgsfield Shorts Studio", "Genjutsu Restyle", "Krea Video Restyle"] },
  { id: "extend", area: "video", status: "pronto", href: "/video", mcp: "extend_video", title: "Estender um vídeo (+5 s / +10 s)", desc: "Botão “Estender” no vídeo: tira o último frame, o Seedance 1.0 continua a cena na cota grátis com o mesmo movimento e o FFmpeg emenda. Pode dar um solavanco em movimento rápido; o Kling extend (pago) é mais suave.", via: "FFmpeg + Seedance 1.0 i2v (cota grátis) · Kling extend (fal, pago) como opção", from: ["Grok Imagine extension", "Luma Extend", "Veo Flow"], cost: "pago na fal (Wan VACE)" },
  { id: "video-upscale", area: "video", status: "pronto", href: "/video", mcp: "upscale_video", title: "Ampliar vídeo pra 1080p / 4K (+60 fps)", desc: "Botão “Ampliar” no vídeo: lanczos + nitidez, 60 fps por interpolação opcional — grátis e local, bom pra YouTube/TV. Upscale com IA que recria detalhe (Topaz / FLUX Video Upscaler) continua pago na fal.", via: "FFmpeg (lanczos, unsharp, minterpolate) · fal.ai Topaz (pago)", from: ["Higgsfield FLUX 3 Upscaler", "Topaz"], cost: "US$ 0" },
  { id: "remove-bg", area: "imagem", status: "pronto", href: "/image", mcp: "generate_image(referenceImages)", title: "Fundo branco, trocar fundo, expandir e reacender", desc: "Com uma referência na página Imagem, o menu “Editar” preenche a edição: fundo branco de produto, trocar fundo, expandir pra 16:9/9:16 (outpaint), nova luz, limpar texto/objetos, mesma cena no estilo épico — o Seedream edita a imagem na cota grátis. Fundo transparente (PNG com alpha) ainda não: é o birefnet da fal (pago).", via: "Seedream 4.5 (image-to-image)", from: ["Higgsfield Layers", "Photoroom", "Canva Magic Expand"], cost: "US$ 0 (cota do Seedream)" },
  { id: "vibe-motion", area: "quadrinhos", status: "planejado", phase: 2, title: "Motion graphics por texto (estilo flat)", desc: "Gráficos animados, números subindo, setas, títulos cinéticos — gerados como código, sem modelo de vídeo.", via: "Remotion (React) gerado pelo Claude", from: ["Higgsfield Vibe Motion", "AI Motion Designer"] },
  { id: "camera-presets", area: "video", status: "pronto", href: "/video", title: "Presets de câmera e emoção", desc: "Push-in, dolly, órbita, crash zoom, handheld, drone, lentes 35/85 mm e emoções do personagem com um clique — entram no prompt no vocabulário que os modelos entendem.", via: "prompts curados (funcionam no Seedance 1.0 grátis e nos pagos)", from: ["Higgsfield Cinema Studio 4.0", "Director Panel"], cost: "US$ 0" },
  { id: "effects", area: "video", status: "ideia", phase: 3, title: "Efeitos virais", desc: "Explosão, derretimento, 360°, troca de roupa — presets de um clique.", from: ["Higgsfield Effects 2.0", "Pikaffects"] },
  { id: "canvas", area: "controle", status: "ideia", phase: 3, title: "Canvas de fluxos", desc: "Quadro infinito ligando roteiro → imagem → vídeo → render como nós reutilizáveis.", from: ["Higgsfield Canvas", "ComfyUI", "Krea"] },
  { id: "interactive-avatar", area: "clone", status: "ideia", phase: 3, title: "Avatar que responde aluno ao vivo", desc: "O expert clonado tira dúvidas em vídeo em tempo real no WhatsApp ou na área de membros.", from: ["HeyGen Interactive Avatar", "Hedra Live"] },
  { id: "plugins", area: "controle", status: "ideia", phase: 3, title: "Dentro do CapCut / Premiere / DaVinci", desc: "Gerar e trocar cenas sem sair do editor.", from: ["Higgsfield plugins (DaVinci, Premiere, AE, Photoshop, Figma)"] },
  { id: "3d", area: "video", status: "ideia", phase: 3, title: "Cena 3D reaproveitável", desc: "Loja, quarto ou escritório em 3D pra filmar de qualquer ângulo com o mesmo personagem.", from: ["Higgsfield 3D Jutsu", "Scene Builder", "Krea Stage"] },
  { id: "team", area: "controle", status: "pronto", href: "/settings#team", title: "Estúdio pra equipe (login, gasto por pessoa, pronto pra nuvem)", desc: "Login por e-mail e senha, admin cadastra editores e vê o gasto do mês de cada um. Arquivos num bucket (R2 ou Railway) com o disco como cache; um Dockerfile só sobe site + API + worker. Liga com AUTH_REQUIRED=true na nuvem; no Mac fica desligado.", via: "Sessões com cookie (scrypt) + Railway (Docker) + bucket S3/R2", from: ["Higgsfield Team / Enterprise"], cost: "US$ 0 no Mac · Railway ~US$ 5–30/mês na nuvem" },
];

export const STATUS_LABEL: Record<Status, string> = { pronto: "pronto", "em-breve": "em breve", planejado: "planejado", ideia: "ideia" };

export function capabilities() {
  const byStatus = (s: Status) => CAPABILITIES.filter((c) => c.status === s).length;
  return { areas: AREAS, statusLabel: STATUS_LABEL, counts: { pronto: byStatus("pronto"), "em-breve": byStatus("em-breve"), planejado: byStatus("planejado"), ideia: byStatus("ideia") }, items: CAPABILITIES };
}

/** versão em markdown (pro MCP e pro Claude ler) */
export function capabilitiesMarkdown() {
  const lines: string[] = ["# CB Studio — tudo que dá pra fazer", ""];
  for (const status of ["pronto", "em-breve", "planejado", "ideia"] as Status[]) {
    const items = CAPABILITIES.filter((c) => c.status === status);
    if (!items.length) continue;
    lines.push(`## ${STATUS_LABEL[status]} (${items.length})`, "");
    for (const c of items) {
      const bits = [c.href ? `app: ${c.href}` : null, c.mcp ? `mcp: ${c.mcp}` : null, c.via ? `via: ${c.via}` : null, c.cost ? `custo: ${c.cost}` : null, c.from?.length ? `referência: ${c.from.join(", ")}` : null].filter(Boolean);
      lines.push(`- **${c.title}** (${AREAS[c.area].label}) — ${c.desc}${bits.length ? ` _(${bits.join(" · ")})_` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
