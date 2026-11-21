import { z } from "zod";

/**
 * Roteiro automático: tema → cenas (narração + prompt de imagem + prompt de movimento).
 * Usa o chat/completions da ModelArk (compatível com OpenAI). Modelo padrão: Seed 2.1 turbo
 * — coberto pelos 500K tokens grátis da campanha de novos usuários.
 */

export const STYLES: Record<string, { label: string; imageStyle: string; motionStyle: string }> = {
  epic: {
    label: "Épico ilustrado",
    imageStyle:
      "Painterly epic illustration, rich warm golden and deep blue palette, dramatic rim light, soft brush texture, highly detailed faces and fabric, cinematic composition, vertical 9:16 — the look of a prestige animated myth",
    motionStyle: "slow push-in or gentle parallax, hair and cloth drifting, glowing particles, eyes and expression subtly alive, cinematic",
  },
  comic: {
    label: "Quadrinhos",
    imageStyle: "Comic book style, bold ink outlines, halftone shading, dramatic lighting, vertical 9:16 composition",
    motionStyle: "subtle parallax, slow push-in, small natural gestures, cinematic, keep the comic look",
  },
  anime: {
    label: "Anime",
    imageStyle: "Modern anime style, clean lineart, cel shading, expressive eyes, vertical 9:16 composition",
    motionStyle: "gentle camera drift, hair and cloth sway, blinking, anime-like motion",
  },
  cinematic: {
    label: "Cinemático",
    imageStyle: "Photorealistic cinematic still, 35mm film, shallow depth of field, moody lighting, vertical 9:16 composition",
    motionStyle: "slow dolly, realistic micro-movements, atmospheric particles, cinematic",
  },
  flat: {
    label: "Flat / Motion",
    imageStyle: "Flat vector illustration, bold shapes, limited palette, clean composition, vertical 9:16",
    motionStyle: "smooth 2D motion-graphics movement, elements slide and scale, clean easing",
  },
};

export const scriptOutput = z.object({
  title: z.string(),
  character_sheet: z.string(),
  scenes: z
    .array(
      z.object({
        type: z.enum(["video", "card"]).default("video"),
        script: z.string().default(""),
        image_prompt: z.string().default(""),
        motion_prompt: z.string().default(""),
        duration_sec: z.number().int().min(1).max(10).default(5),
        card: z.object({ text: z.string(), subtext: z.string().optional(), button: z.string().optional() }).optional(),
      }),
    )
    .min(1),
});
export type ScriptOutput = z.infer<typeof scriptOutput>;

export interface ScriptRequest {
  theme: string;
  scenes?: number;
  style?: keyof typeof STYLES | string;
  audience?: string;
  tone?: string;
  characterSheet?: string;
  language?: string;
  /** análise de um vídeo de referência (estrutura, gancho, CTA) — o roteiro novo segue a mesma estrutura */
  reference?: string;
}

function systemPrompt(req: ScriptRequest) {
  const st = STYLES[req.style ?? "comic"] ?? STYLES.comic;
  const n = req.scenes ?? 6;
  return `Você é roteirista de vídeos curtos verticais (TikTok/Reels/Shorts) para a G2 Educação, empresa brasileira de educação em e-commerce (Shopee). Escreve histórias que prendem nos 2 primeiros segundos, usam metáfora/analogia (mito, fábula, história real) e terminam com virada + chamada para ação.

ESTRUTURA (como os vídeos que mais performam):
1. Abertura: um CARD com 1 palavra ou frase-choque (ex.: "ESFRIOU") seguido da cena que contextualiza.
2. Desenvolvimento em cenas de vídeo, cada uma com 1 frase de narração.
3. Pode usar 1–2 CARDs no meio para a ideia-chave (ex.: "GOSTAR | QUERER" + subtexto "são coisas separadas").
4. Fechamento: CARD final com título curto + subtexto + botão (ex.: "O SEGREDO DESSE CINTO" / "clique e descubra" / "Saiba mais").

REGRAS DE SAÍDA — responda SOMENTE com JSON válido neste formato:
{
  "title": "título curto do vídeo",
  "character_sheet": "descrição FIXA e detalhada do(s) personagem(ns) principal(is) em inglês (idade aproximada, etnia/tom de pele, cabelo, roupa com cores, traço marcante). Será repetida em TODAS as imagens para manter consistência.",
  "scenes": [
    {
      "type": "video",
      "script": "narração/legenda da cena em ${req.language ?? "português do Brasil"}, 1 frase curta (máx. 14 palavras), tom ${req.tone ?? "direto e emocional"}",
      "image_prompt": "prompt em inglês para o gerador de imagem: comece com '${st.imageStyle}', depois o personagem (copie o character_sheet), a ação, o cenário, a luz. Sem texto na imagem.",
      "motion_prompt": "prompt em inglês para animar essa imagem (${st.motionStyle}); descreva o movimento do personagem e da câmera em 1-2 frases",
      "duration_sec": 5
    },
    {
      "type": "card",
      "script": "narração curta do card (pode ser igual ao texto do card) ou vazio",
      "card": { "text": "TEXTO GRANDE (até 4 palavras)", "subtext": "linha menor opcional", "button": "só no card final, ex. Saiba mais" },
      "duration_sec": 2
    }
  ]
}

Público: ${req.audience ?? "brasileiros 25-45 anos que querem renda extra"}.
${n} cenas de vídeo + os cards (abertura, 0–2 no meio, final). Nada fora do JSON.
${req.reference ? `
VÍDEO DE REFERÊNCIA (que performou): siga a MESMA estrutura, ritmo, tipo de gancho e de CTA, adaptando ao tema novo — não copie as frases.
${req.reference}
` : ""}
Regras de produção (aprendidas em dezenas de vídeos):
- Narração: números por extenso ("vinte mil", nunca "20k"); frases curtas; nada de palavra em inglês no início da frase.
- Nenhum plano parado: cada cena de vídeo tem UMA ação clara e dura 4–5 s; se a ação for longa, divida em duas cenas com ângulos diferentes.
- Mão com objeto (pegar, abrir, guardar): descreva no image_prompt a mão de perfil e, no motion_prompt, o início e o fim do gesto.
- Evite reflexos em vidro/espelho e multidões (a IA erra rostos).
- Cada image_prompt repete o character_sheet inteiro.`;
}

export async function generateScript(req: ScriptRequest, cfg: { apiKey: string; baseUrl?: string; model?: string }): Promise<ScriptOutput & { usage?: unknown }> {
  const base = (cfg.baseUrl ?? "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");
  const model = cfg.model ?? "dola-seed-2-1-turbo-260628";

  const user = [`Tema: ${req.theme}`, req.characterSheet ? `Personagem já definido (use exatamente): ${req.characterSheet}` : ""].filter(Boolean).join("\n");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt(req) },
        { role: "user", content: user },
      ],
      temperature: 0.8,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`[ark-llm] ${res.status} ${body?.error?.message ?? res.statusText}`);

  const text: string = body.choices?.[0]?.message?.content ?? "";
  const json = extractJson(text);
  const parsed = scriptOutput.parse(json);
  // garante o character_sheet dentro de cada image_prompt
  parsed.scenes = parsed.scenes.map((s) => {
    if (s.type === "card") return { ...s, image_prompt: "", motion_prompt: "", duration_sec: Math.min(4, s.duration_sec || 2) };
    return {
      ...s,
      image_prompt: s.image_prompt.includes(parsed.character_sheet.slice(0, 20)) ? s.image_prompt : `${s.image_prompt}. Character: ${parsed.character_sheet}`,
    };
  });
  return { ...parsed, usage: body.usage };
}

function extractJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM não devolveu JSON");
    return JSON.parse(m[0]);
  }
}
