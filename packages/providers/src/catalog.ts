/**
 * Catálogo único de modelos do CB Studio.
 * A API usa pra escolher o provedor/estimar custo; a web usa pra montar os seletores.
 * Preços em USD (nov/2026) — conferidos nas páginas oficiais (fal.ai / BytePlus).
 */

export type CatalogKind = "image" | "video" | "audio" | "avatar" | "upscale" | "lipsync" | "sfx";
export type ProviderName = "byteplus" | "fal" | "seedaudio" | "elevenlabs" | "gpu";
export type Res = "480p" | "720p" | "1080p";

export interface CatalogModel {
  /** id usado em request.model */
  id: string;
  name: string;
  provider: ProviderName;
  kind: CatalogKind;
  badges: { text: string; tone?: "top" | "free" | "locked" }[];
  note?: string;
  /** preço: vídeo/avatar por segundo (por resolução), imagem por unidade, áudio por minuto, upscale por megapixel */
  price: { perSec?: Partial<Record<Res, number>>; perImage?: number; perMin?: number; perMp?: number };
  resolutions?: Res[];
  /** durações permitidas (s) */
  durations?: number[];
  /** precisa de primeiro frame (só imagem→vídeo) */
  needsFirstFrame?: boolean;
  /** gera áudio nativo junto do vídeo */
  nativeAudio?: boolean;
  /** o que trava o modelo: chave paga (fal), fundo de reserva (BytePlus) */
  gate?: "fal" | "reserve" | "elevenlabs" | "gpu";
  /** aceita último frame (quadro inicial + final — mão com objeto) */
  endFrame?: boolean;
  /** aceita áudio de referência pra pessoa falar com a boca certa */
  audioRef?: boolean;
  /** dica do nosso guia (PDF "Modelos que usamos no Higgsfield") */
  tip?: string;
  /** endpoints na fal (imagem→vídeo / texto→vídeo / único) */
  fal?: { i2v?: string; t2v?: string; endpoint?: string; family: "kling" | "kling4" | "nano" | "gpt" | "clarity" | "kling-avatar" | "omnihuman" | "grok" | "synclip" | "h3" };
  /** cota grátis conhecida (texto informativo) */
  free?: string;
}

export const CATALOG: CatalogModel[] = [
  // ───────── vídeo — BytePlus ModelArk (cota grátis, modo "só crédito grátis") ─────────
  {
    id: "seedance-1-0-pro-fast-251015",
    name: "Seedance 1.0 fast",
    provider: "byteplus",
    kind: "video",
    badges: [{ text: "TOP custo", tone: "top" }, { text: "até 1080p" }, { text: "até 10 s" }, { text: "2M tokens grátis", tone: "free" }],
    note: "só imagem→vídeo · o mais barato que existe · ~US$ 0,24 por 5 s em 1080p",
    tip: "serve pra planos simples (andar, olhar, câmera chegando no rosto). Ação encadeada, luz específica ou fala: Seedance 2.5",
    price: { perSec: { "480p": 0.0107, "720p": 0.0216, "1080p": 0.0486 } },
    resolutions: ["480p", "720p", "1080p"],
    durations: [3, 4, 5, 6, 8, 10],
    needsFirstFrame: true,
    free: "2M tokens",
  },
  {
    id: "wan-2.2-gpu",
    name: "Wan 2.2 (GPU própria)",
    provider: "gpu",
    kind: "video",
    badges: [{ text: "mais barato", tone: "top" }, { text: "720p" }, { text: "5 s" }, { text: "código aberto" }],
    note: "Wan 2.2 14B com Lightning (4 passos) na nossa GPU por segundo (Modal) · ~US$ 0,14 por plano de 5 s em 720p, sai dos US$ 30/mês grátis do Modal",
    tip: "só anima imagem (gere a imagem da cena antes). Qualidade na faixa do Seedance 1.0/1.5; planos-chave num modelo melhor",
    price: { perSec: { "480p": 0.0103, "720p": 0.0274 } },
    resolutions: ["720p", "480p"],
    durations: [5],
    needsFirstFrame: true,
    gate: "gpu",
  },
  {
    id: "seedance-1-5-pro-251215",
    name: "Seedance 1.5 pro",
    provider: "byteplus",
    kind: "video",
    badges: [{ text: "até 1080p" }, { text: "4–12 s" }, { text: "BytePlus não ativa mais", tone: "locked" }],
    note: "movimento mais rápido e fiel que o 1.0 · texto→vídeo e imagem→vídeo · ~US$ 0,13 por 5 s em 720p (sem som)",
    tip: "aceita cortes dentro do mesmo plano (\"cut to\"): dá ritmo de Reels sem gastar outro plano. Aqui sai sem som — a voz é a narração do projeto",
    price: { perSec: { "480p": 0.0119, "720p": 0.0259, "1080p": 0.0583 } },
    resolutions: ["480p", "720p", "1080p"],
    durations: [4, 5, 6, 8, 10, 12],
    free: "2M tokens",
  },
  {
    id: "seedance-1-0-pro-250528",
    name: "Seedance 1.0 pro",
    provider: "byteplus",
    kind: "video",
    badges: [{ text: "1080p" }, { text: "texto→vídeo" }, { text: "2M tokens grátis", tone: "free" }],
    note: "texto→vídeo e imagem→vídeo · ~US$ 0,61 por 5 s em 1080p",
    price: { perSec: { "480p": 0.0267, "720p": 0.054, "1080p": 0.1215 } },
    resolutions: ["480p", "720p", "1080p"],
    durations: [3, 4, 5, 6, 8, 10],
    free: "2M tokens",
  },
  {
    id: "dreamina-seedance-2-5-260628",
    name: "Seedance 2.5",
    provider: "byteplus",
    kind: "video",
    badges: [{ text: "cinema", tone: "top" }, { text: "1080p" }, { text: "até 30 s" }, { text: "áudio nativo" }, { text: "US$ 30 reserva", tone: "locked" }],
    note: "o único que entregou fala com boca sincronizada · aceita áudio de referência · ~US$ 2,84 por 5 s em 1080p (Higgsfield: US$ 3,92)",
    tip: "gere a narração antes e passe como áudio de referência: a pessoa fala com a boca certa. Use nos momentos-chave; planos de passagem no 1.0 fast",
    price: { perSec: { "480p": 0.126, "720p": 0.253, "1080p": 0.569 } },
    resolutions: ["480p", "720p", "1080p"],
    durations: [4, 5, 6, 8, 10, 12, 15, 20, 30],
    nativeAudio: true,
    endFrame: true,
    audioRef: true,
    gate: "reserve",
  },
  {
    id: "dreamina-seedance-2-0-mini-260615",
    name: "Seedance 2.0 mini",
    provider: "byteplus",
    kind: "video",
    badges: [{ text: "720p" }, { text: "4–15 s" }, { text: "áudio nativo" }, { text: "US$ 30 reserva", tone: "locked" }],
    note: "barato pra diálogo animado · ~US$ 0,38 por 5 s em 720p · (boca saiu fora de sincronia no nosso teste)",
    price: { perSec: { "480p": 0.034, "720p": 0.0756 } },
    resolutions: ["480p", "720p"],
    durations: [4, 5, 6, 8, 10, 12, 15],
    nativeAudio: true,
    gate: "reserve",
  },
  {
    id: "dreamina-seedance-2-0-fast-260128",
    name: "Seedance 2.0 fast",
    provider: "byteplus",
    kind: "video",
    badges: [{ text: "1080p" }, { text: "4–15 s" }, { text: "áudio nativo" }, { text: "US$ 30 reserva", tone: "locked" }],
    note: "meio-termo entre o 2.0 mini e o 2.5 · ~US$ 1,36 por 5 s em 1080p",
    price: { perSec: { "480p": 0.054, "720p": 0.121, "1080p": 0.272 } },
    resolutions: ["480p", "720p", "1080p"],
    durations: [4, 5, 6, 8, 10, 12, 15],
    nativeAudio: true,
    gate: "reserve",
  },

  // ───────── vídeo — Kling via fal.ai (pré-pago, mínimo US$ 10) ─────────
  {
    id: "kling-2.5-turbo",
    name: "Kling 2.5 turbo pro",
    provider: "fal",
    kind: "video",
    badges: [{ text: "melhor custo", tone: "top" }, { text: "1080p" }, { text: "5–10 s" }, { text: "US$ 0,35 / 5 s", tone: "locked" }],
    note: "qualidade Kling por US$ 0,07/s · sem áudio (a narração entra na montagem)",
    price: { perSec: { "720p": 0.07, "1080p": 0.07 } },
    resolutions: ["1080p"],
    durations: [5, 10],
    gate: "fal",
    fal: { family: "kling", i2v: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", t2v: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video" },
  },
  {
    id: "kling-2.6",
    name: "Kling 2.6 pro",
    provider: "fal",
    kind: "video",
    badges: [{ text: "1080p" }, { text: "5–10 s" }, { text: "áudio nativo" }, { text: "US$ 0,35–0,70 / 5 s", tone: "locked" }],
    note: "US$ 0,07/s mudo · US$ 0,14/s com áudio nativo",
    price: { perSec: { "720p": 0.07, "1080p": 0.07 } },
    resolutions: ["1080p"],
    durations: [5, 10],
    nativeAudio: true,
    gate: "fal",
    fal: { family: "kling", i2v: "fal-ai/kling-video/v2.6/pro/image-to-video", t2v: "fal-ai/kling-video/v2.6/pro/text-to-video" },
  },
  {
    id: "kling-3.0-turbo",
    name: "Kling 3.0 turbo pro",
    provider: "fal",
    kind: "video",
    badges: [{ text: "1080p" }, { text: "3–15 s" }, { text: "US$ 0,70 / 5 s", tone: "locked" }],
    note: "US$ 0,14/s · rápido",
    price: { perSec: { "720p": 0.14, "1080p": 0.14 } },
    resolutions: ["1080p"],
    durations: [3, 4, 5, 6, 8, 10, 12, 15],
    needsFirstFrame: true,
    gate: "fal",
    fal: { family: "kling", i2v: "fal-ai/kling-video/v3/turbo/pro/image-to-video" },
  },
  {
    id: "kling-3.0",
    name: "Kling 3.0 pro",
    provider: "fal",
    kind: "video",
    badges: [{ text: "1080p" }, { text: "3–15 s" }, { text: "áudio nativo" }, { text: "US$ 0,56–0,84 / 5 s", tone: "locked" }],
    note: "o padrão das animações sem fala · US$ 0,112/s mudo · US$ 0,168/s com áudio · quadro inicial + final",
    tip: "mão com objeto (pegar, soltar, abrir): gere a imagem de início e de fim e use os dois quadros, com a mão de perfil. Nenhum plano acima de ~3 s",
    price: { perSec: { "720p": 0.112, "1080p": 0.112 } },
    resolutions: ["1080p"],
    durations: [3, 4, 5, 6, 8, 10, 12, 15],
    nativeAudio: true,
    endFrame: true,
    gate: "fal",
    fal: { family: "kling", i2v: "fal-ai/kling-video/v3/pro/image-to-video", t2v: "fal-ai/kling-video/v3/pro/text-to-video" },
  },
  {
    id: "minimax-h3",
    name: "MiniMax H3",
    provider: "fal",
    kind: "video",
    badges: [{ text: "nível Seedance 2.5", tone: "top" }, { text: "768p" }, { text: "5–15 s" }, { text: "US$ 0,30 / 5 s", tone: "locked" }],
    note: "4º no ranking imagem→vídeo (Artificial Analysis), 28 pontos atrás do Seedance 2.5 e 3–4× mais barato · US$ 0,06/s em 768p · US$ 0,05/s em 480p",
    tip: "o vídeo segue o formato da imagem da cena (9:16 fica 9:16). Licença: telas que usam o H3 mostram “MiniMax H3”",
    price: { perSec: { "480p": 0.05, "720p": 0.06 } },
    resolutions: ["720p", "480p"],
    durations: [5, 6, 8, 10, 12, 15],
    endFrame: true,
    // texto→vídeo do H3 só sai em 2K a US$ 0,26/s — aqui sempre anima a imagem da cena
    needsFirstFrame: true,
    gate: "fal",
    fal: { family: "h3", i2v: "minimax/h3/image-to-video" },
  },
  {
    id: "minimax-h3-gpu",
    name: "MiniMax H3 (GPU própria)",
    provider: "gpu",
    kind: "video",
    badges: [{ text: "experimental" }, { text: "768p" }, { text: "4–15 s" }, { text: "Turbo 4 passos" }],
    note: "o mesmo H3 rodando em 4× H100 no Modal, cobrado por segundo · estimativa ~US$ 0,15 por plano de 5 s (medir no 1º lote); ligar a máquina leva alguns minutos — gere o episódio inteiro de uma vez",
    tip: "só anima imagem. Licença: telas que usam o H3 mostram “MiniMax H3”",
    price: { perSec: { "480p": 0.015, "720p": 0.03 } },
    resolutions: ["720p", "480p"],
    durations: [4, 5, 6, 8, 10, 12, 15],
    needsFirstFrame: true,
    gate: "gpu",
  },
  {
    id: "minimax-h3-max",
    name: "MiniMax H3 Max",
    provider: "fal",
    kind: "video",
    badges: [{ text: "H3 refinado pela fal" }, { text: "768p" }, { text: "5–15 s" }, { text: "US$ 0,40 / 5 s", tone: "locked" }],
    note: "versão do H3 pós-treinada pela fal pra seguir melhor o prompt e ficar mais bonita · US$ 0,08/s em 768p · US$ 0,05/s em 480p",
    tip: "use nos planos-chave quando o H3 normal não acertar o movimento",
    price: { perSec: { "480p": 0.05, "720p": 0.08 } },
    resolutions: ["720p", "480p"],
    durations: [5, 6, 8, 10, 12, 15],
    endFrame: true,
    needsFirstFrame: true,
    gate: "fal",
    fal: { family: "h3", i2v: "minimax/h3-max/image-to-video" },
  },
  {
    id: "kling-4.0",
    name: "Kling 4.0",
    provider: "fal",
    kind: "video",
    badges: [{ text: "1080p" }, { text: "3–30 s" }, { text: "áudio nativo" }, { text: "US$ 1,18 / 5 s", tone: "locked" }],
    note: "US$ 0,157/s em 720p · US$ 0,235/s em 1080p · (no Higgsfield está em promoção: ~US$ 0,80 / 5 s)",
    price: { perSec: { "720p": 0.157, "1080p": 0.235 } },
    resolutions: ["720p", "1080p"],
    durations: [3, 4, 5, 6, 8, 10, 12, 15, 20, 30],
    nativeAudio: true,
    gate: "fal",
    fal: { family: "kling4", i2v: "kling/v4/image-to-video", t2v: "kling/v4/text-to-video" },
  },

  {
    id: "grok-imagine-1.5",
    name: "Grok Imagine 1.5 (xAI)",
    provider: "fal",
    kind: "video",
    badges: [{ text: "o mais barato" }, { text: "1–15 s" }, { text: "US$ 0,40 / 5 s", tone: "locked" }],
    note: "US$ 0,08/s em 480p · 0,14/s em 720p · 0,25/s em 1080p · nunca testamos em 3D",
    price: { perSec: { "480p": 0.08, "720p": 0.14, "1080p": 0.25 } },
    resolutions: ["480p", "720p", "1080p"],
    durations: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
    needsFirstFrame: true,
    gate: "fal",
    fal: { family: "grok", i2v: "xai/grok-imagine-video/v1.5/image-to-video" },
  },

  // ───────── imagem ─────────
  {
    id: "seedream-4-5-251128",
    name: "Seedream 4.5",
    provider: "byteplus",
    kind: "image",
    badges: [{ text: "TOP", tone: "top" }, { text: "2K" }, { text: "200 grátis", tone: "free" }],
    note: "texto→imagem e imagem→imagem, 2K, texto legível · US$ 0,04",
    price: { perImage: 0.04 },
    free: "200 imagens",
  },
  {
    id: "seedream-4-0-250828",
    name: "Seedream 4.0",
    provider: "byteplus",
    kind: "image",
    badges: [{ text: "2K" }, { text: "200 grátis", tone: "free" }],
    note: "mais barato, ótimo pra storyboard · US$ 0,03",
    price: { perImage: 0.03 },
    free: "200 imagens",
  },
  {
    id: "gpt-image-2.5-sunburst",
    name: "GPT Image 2.5 Sunburst",
    provider: "fal",
    kind: "image",
    badges: [{ text: "3D / animação", tone: "top" }, { text: "2K" }, { text: "US$ 0,04–0,08", tone: "locked" }],
    note: "o principal pra 3D: fichas de personagem e cenas das novelas · (a variante Flare sai fotográfica: evitar no 3D)",
    tip: "sempre passe a ficha do personagem como referência. Sem ela, sai outra pessoa",
    price: { perImage: 0.06 },
    gate: "fal",
    fal: { family: "gpt", endpoint: "openai/gpt-image-2.5/sunburst/text-to-image", i2v: "openai/gpt-image-2.5/sunburst/edit" },
  },
  {
    id: "gpt-image-2.6-flare",
    name: "GPT Image 2.6 Flare (foto real)",
    provider: "fal",
    kind: "image",
    badges: [{ text: "realista", tone: "top" }, { text: "até 4K" }, { text: "US$ 0,04–0,06", tone: "locked" }],
    note: "fotos realistas (reacts, anúncios realistas) · fica muito real",
    tip: "qualidade média basta quando o vídeo final for 720p",
    price: { perImage: 0.055 },
    gate: "fal",
    fal: { family: "gpt", endpoint: "openai/gpt-image-2.6/flare/text-to-image", i2v: "openai/gpt-image-2.6/flare/edit" },
  },
  {
    id: "gpt-image-2.6-sunburst",
    name: "GPT Image 2.6 Sunburst",
    provider: "fal",
    kind: "image",
    badges: [{ text: "ilustração" }, { text: "até 4K" }, { text: "US$ 0,04–0,06", tone: "locked" }],
    note: "versão 2.6 da variante Sunburst (mais ilustrada)",
    price: { perImage: 0.055 },
    gate: "fal",
    fal: { family: "gpt", endpoint: "openai/gpt-image-2.6/sunburst/text-to-image", i2v: "openai/gpt-image-2.6/sunburst/edit" },
  },
  {
    id: "nano-banana-2.1",
    name: "Nano Banana 2.1 (Google)",
    provider: "fal",
    kind: "image",
    badges: [{ text: "rosto fiel", tone: "top" }, { text: "até 14 referências" }, { text: "até 4K" }, { text: "US$ 0,04–0,06", tone: "locked" }],
    note: "rosto de pessoa real com fotos de referência (faz o papel do Soul ID) · o rosto que ficou mais fiel nos 30 hooks",
    tip: "mande 3–10 fotos limpas da pessoa como referência; o modelo mantém até 4 personagens consistentes",
    price: { perImage: 0.06 },
    gate: "fal",
    fal: { family: "nano", endpoint: "google/nano-banana-2.1", i2v: "google/nano-banana-2.1/edit" },
  },
  {
    id: "nano-banana-pro",
    name: "Nano Banana Pro (Google)",
    provider: "fal",
    kind: "image",
    badges: [{ text: "realismo", tone: "top" }, { text: "até 4K" }, { text: "edita com referência" }, { text: "US$ 0,15", tone: "locked" }],
    note: "o melhor em pessoas reais e texto na imagem · US$ 0,15 (4K: 0,30) · via fal.ai",
    price: { perImage: 0.15 },
    gate: "fal",
    fal: { family: "nano", endpoint: "fal-ai/nano-banana-pro", i2v: "fal-ai/nano-banana-pro/edit" },
  },
  {
    id: "gpt-image-1.5",
    name: "GPT Image 1.5 (antigo)",
    provider: "fal",
    kind: "image",
    badges: [{ text: "ilustração" }, { text: "US$ 0,05–0,20", tone: "locked" }],
    note: "ótimo em estilo ilustrado/quadrinhos · US$ 0,05 (médio) · US$ 0,20 (alto) · via fal.ai",
    price: { perImage: 0.2 },
    gate: "fal",
    fal: { family: "gpt", endpoint: "fal-ai/gpt-image-1.5", i2v: "fal-ai/gpt-image-1.5/edit" },
  },

  // ───────── upscale / estilo Magnific ─────────
  {
    id: "clarity-upscaler",
    name: "Upscale criativo (estilo Magnific)",
    provider: "fal",
    kind: "upscale",
    badges: [{ text: "2–4×" }, { text: "detalhe/realismo" }, { text: "US$ 0,03 / MP", tone: "locked" }],
    note: "aumenta resolução e inventa detalhe (pele, tecido, textura) como o Magnific · ~US$ 0,25 por imagem 2K→4K",
    price: { perMp: 0.03 },
    gate: "fal",
    fal: { family: "clarity", endpoint: "fal-ai/clarity-upscaler" },
  },

  // ───────── avatar / clone de pessoa (foto + voz → vídeo falando) ─────────
  {
    id: "omnihuman-1.5",
    name: "OmniHuman 1.5 (ByteDance)",
    provider: "fal",
    kind: "avatar",
    badges: [{ text: "TOP", tone: "top" }, { text: "1080p" }, { text: "até 30 s" }, { text: "US$ 0,16 / s", tone: "locked" }],
    note: "foto + áudio → pessoa falando com gestos e emoção · 720p até 60 s · via fal.ai",
    price: { perSec: { "720p": 0.16, "1080p": 0.16 } },
    resolutions: ["720p", "1080p"],
    gate: "fal",
    fal: { family: "omnihuman", endpoint: "fal-ai/bytedance/omnihuman/v1.5" },
  },
  {
    id: "kling-avatar-2",
    name: "Kling AI Avatar 2 pro",
    provider: "fal",
    kind: "avatar",
    badges: [{ text: "lip-sync" }, { text: "US$ 0,115 / s", tone: "locked" }],
    note: "foto + áudio → rosto falando (lip-sync) · via fal.ai",
    price: { perSec: { "720p": 0.115, "1080p": 0.115 } },
    resolutions: ["1080p"],
    gate: "fal",
    fal: { family: "kling-avatar", endpoint: "fal-ai/kling-video/ai-avatar/v2/pro" },
  },

  // ───────── lip-sync em vídeo pronto (plano B da boca) ─────────
  {
    id: "sync-lipsync-2",
    name: "Sync Lipsync 2 / 2-pro",
    provider: "fal",
    kind: "lipsync",
    badges: [{ text: "arruma a boca" }, { text: "US$ 3 / min", tone: "locked" }],
    note: "vídeo pronto + áudio → boca sincronizada · lipsync-2-pro custa 1,67× · via fal.ai",
    price: { perMin: 3 },
    gate: "fal",
    fal: { family: "synclip", endpoint: "fal-ai/sync-lipsync/v2" },
  },

  // ───────── voz ─────────
  {
    id: "seed-audio-1.0",
    name: "Seed Audio 1.0",
    provider: "seedaudio",
    kind: "audio",
    badges: [{ text: "TOP", tone: "top" }, { text: "pt-BR" }, { text: "clona voz" }, { text: "60 min grátis", tone: "free" }],
    note: "o mesmo motor de voz do Higgsfield · depois do grátis US$ 0,15/min",
    price: { perMin: 0.15 },
    free: "60 min",
  },
  {
    id: "elevenlabs-v4",
    name: "ElevenLabs v4",
    provider: "elevenlabs",
    kind: "audio",
    badges: [{ text: "narrador padrão da G2", tone: "top" }, { text: "clona voz" }, { text: "US$ 5/mês", tone: "locked" }],
    note: "a voz de todas as narrações no Higgsfield · estabilidade 0,8 / semelhança 0,9 · ~US$ 0,30 por 1k caracteres",
    tip: "números por extenso e acento pra forçar pronúncia (“vótos”, “manicúri”); palavra parecida com inglês no início da frase sai com sotaque — emende na frase anterior. Nunca misture dois narradores no mesmo vídeo",
    price: { perMin: 0.45 },
    gate: "elevenlabs",
  },
  {
    id: "seed-audio-sfx",
    name: "Efeito sonoro (Seed Audio)",
    provider: "seedaudio",
    kind: "sfx",
    badges: [{ text: "grátis (cota de voz)", tone: "free" }, { text: "som de cena" }],
    note: "efeito sonoro ou ambiente sem fala, até 30 s, pela mesma cota grátis do Seed Audio · meça o volume antes de usar",
    price: { perMin: 0.03 },
    free: "60 min",
  },
  {
    id: "elevenlabs-sfx",
    name: "Efeito sonoro (ElevenLabs)",
    provider: "elevenlabs",
    kind: "sfx",
    badges: [{ text: "foley" }, { text: "US$ 0,05", tone: "locked" }],
    note: "efeito sonoro de uma ação específica (o papel do Mirelo) · meça o volume antes de usar",
    price: { perImage: 0.05 },
    gate: "elevenlabs",
  },
];

export const findModel = (id?: string | null) => (id ? CATALOG.find((m) => m.id === id || id.startsWith(m.id + ":")) : undefined);

/** custo zero é o padrão: só desliga com ZERO_COST=false explícito */
export const zeroCost = (env: NodeJS.ProcessEnv = process.env) => (env.ZERO_COST ?? "true").toLowerCase() !== "false";

/** disponibilidade por ambiente: o que está travado e por quê */
export function catalogWithAvailability(env: NodeJS.ProcessEnv = process.env) {
  return CATALOG.map((m) => {
    let locked: string | undefined;
    if (m.gate === "fal" && !env.FAL_KEY) locked = "precisa de conta fal.ai (pré-pago, mínimo US$ 10) → FAL_KEY no .env";
    if (m.gate === "reserve" && env.ARK_ALLOW_SEEDANCE_2 !== "true") locked = "exige fundo de reserva de US$ 30 na BytePlus → ARK_ALLOW_SEEDANCE_2=true";
    if (m.gate === "elevenlabs" && !env.ELEVENLABS_API_KEY) locked = "precisa de conta ElevenLabs (Starter US$ 5/mês libera clonagem) → ELEVENLABS_API_KEY no .env";
    if (m.gate === "gpu" && m.id === "minimax-h3-gpu" && !(env.G2_GPU_H3_URL && env.G2_GPU_TOKEN)) locked = "H3 na GPU própria não ligado: deploy de infra/gpu/g2_h3.py no Modal (precisa aceitar a licença do H3 no Hugging Face) e G2_GPU_H3_URL no .env";
    else if (m.gate === "gpu" && m.id !== "minimax-h3-gpu" && !(env.G2_GPU_URL && env.G2_GPU_TOKEN)) locked = "GPU própria não ligada: faça o deploy de infra/gpu/g2_video.py no Modal e ponha G2_GPU_URL e G2_GPU_TOKEN no .env";
    // a BytePlus respondeu "stopping new purchases" na ativação (nov/2026)
    if (m.id === "seedance-1-5-pro-251215" && env.ARK_ALLOW_SEEDANCE_15 !== "true") locked = "a BytePlus não ativa mais o 1.5 pro (\"stopping new purchases\") — use o 1.0 fast ou o 1.0 pro";
    // modo custo zero (padrão): nada que vá pro cartão fica disponível, mesmo com a chave no .env
    const paidModel = m.gate === "fal" || m.gate === "reserve" || m.gate === "elevenlabs" || m.gate === "gpu";
    if (!locked && paidModel && zeroCost(env)) locked = "modo custo zero ligado: este modelo cobra no cartão — só libera com ZERO_COST=false no .env, depois de aprovar o gasto";
    if (m.provider === "byteplus" && !env.ARK_API_KEY) locked = "precisa de ARK_API_KEY";
    if (m.provider === "seedaudio" && !(env.SEED_SPEECH_API_KEY || env.ARK_API_KEY)) locked = "precisa de SEED_SPEECH_API_KEY";
    return { ...m, locked };
  });
}
