/**
 * Chat JSON na ModelArk (compatível com OpenAI). Modelo padrão: Seed 2.1 turbo —
 * coberto pela cota grátis de tokens de texto. Usado pelo roteirista e pelos cortes.
 */
export async function chatJson<T = unknown>(system: string, user: string, opts: { temperature?: number; maxTokens?: number; model?: string; thinking?: boolean; timeoutMs?: number } = {}): Promise<{ json: T; usage?: unknown }> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY ausente no .env");
  const base = (process.env.ARK_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3").replace(/\/$/, "");
  const model = opts.model ?? process.env.ARK_TEXT_MODEL ?? "dola-seed-2-1-turbo-260628";
  const call = async (thinking: boolean) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 240_000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4000,
        response_format: { type: "json_object" },
        // sem "pensamento" longo: respostas em segundos, não minutos (revisão, ganchos, cortes)
        ...(thinking ? {} : { thinking: { type: "disabled" } }),
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    return { res, body };
  };
  let { res, body } = await call(opts.thinking ?? false);
  // modelo que não aceita o campo thinking → tenta sem
  if (!res.ok && res.status === 400 && /thinking/i.test(String(body?.error?.message ?? ""))) ({ res, body } = await call(true));
  if (!res.ok) throw new Error(`[ark-llm] ${res.status} ${body?.error?.message ?? res.statusText}`);
  const text: string = body.choices?.[0]?.message?.content ?? "";
  let json: T;
  try {
    json = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("LLM não devolveu JSON");
    json = JSON.parse(m[0]);
  }
  return { json, usage: body.usage };
}
