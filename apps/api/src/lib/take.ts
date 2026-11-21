/** Narração contínua: dividir uma tomada de voz entre as cenas (puro, sem banco — testável). */

type Word = { start_time: number; end_time: number; text: string };
const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Divide a tomada entre as cenas: cada cena fica com as palavras dela (alinhamento pelas letras, que
 * aguenta o TTS juntar/separar palavras) e um trecho [início, fim] em segundos. A pausa entre duas cenas
 * é dividida ao meio e encurtada pra no máximo `maxGap` — o corte cai no silêncio, então não estala.
 */
export function splitTake(sentences: { text: string; words?: Word[] }[], scripts: string[], maxGap = 0.22) {
  const words: (Word & { sentence: number })[] = [];
  sentences.forEach((sen, si) => {
    for (const w of sen.words ?? []) {
      const t = w.text.trim();
      if (!t) continue;
      if (/[\p{L}\p{N}]/u.test(t)) words.push({ ...w, text: t, sentence: si });
      else if (words.length) words[words.length - 1].text += t; // pontuação gruda na palavra anterior
    }
  });
  const lens = words.map((w) => norm(w.text).length);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  const sceneChars = scripts.map((t) => norm(t).length);
  const scriptTotal = sceneChars.reduce((a, b) => a + b, 0) || 1;
  // fronteira k (fim da cena k): a palavra cujo acumulado de letras fica mais perto da proporção do roteiro
  const cumAt: number[] = [];
  lens.reduce((acc, l, i) => (cumAt[i] = acc + l), 0);
  const ends: number[] = [];
  let acc = 0;
  for (let k = 0; k < scripts.length; k++) {
    acc += sceneChars[k];
    const prevEnd = ends.length ? ends[ends.length - 1] : -1;
    const maxEnd = words.length - (scripts.length - k); // sobra pelo menos 1 palavra pra cada cena seguinte
    if (k === scripts.length - 1) {
      ends.push(words.length - 1);
      break;
    }
    const target = (acc / scriptTotal) * total;
    let end = prevEnd + 1;
    for (let i = prevEnd + 1; i <= maxEnd; i++) if (Math.abs(cumAt[i] - target) < Math.abs(cumAt[end] - target)) end = i;
    // prefere terminar onde o texto tem pontuação (a fronteira certa fica a ±1 palavra)
    if (!/[.,;:!?…]$/.test(words[end].text)) {
      for (const j of [end + 1, end - 1]) {
        if (j > prevEnd && j <= maxEnd && /[.,;:!?…]$/.test(words[j].text)) {
          end = j;
          break;
        }
      }
    }
    ends.push(end);
  }
  const parts = ends.map((end, k) => {
    const from = k ? ends[k - 1] + 1 : 0;
    return words.slice(from, end + 1);
  });
  return parts.map((ws, k) => {
    const first = ws[0];
    const last = ws[ws.length - 1];
    const prevLast = k ? parts[k - 1][parts[k - 1].length - 1] : null;
    const nextFirst = parts[k + 1]?.[0] ?? null;
    const gapBefore = prevLast ? (first.start_time - prevLast.end_time) / 1000 : 0.08;
    const gapAfter = nextFirst ? (nextFirst.start_time - last.end_time) / 1000 : 0.35;
    const start = first.start_time / 1000 - Math.min(gapBefore, maxGap) / 2;
    const end = last.end_time / 1000 + Math.min(gapAfter, maxGap) / 2;
    // legenda: frases da tomada recortadas nas palavras da cena, com tempos relativos ao início da cena
    const bySentence = new Map<number, Word[]>();
    for (const w of ws) (bySentence.get(w.sentence) ?? bySentence.set(w.sentence, []).get(w.sentence)!).push({ start_time: w.start_time, end_time: w.end_time, text: w.text });
    const sh = start * 1000;
    const sents = [...bySentence.values()].map((g) => ({
      text: g.map((w) => w.text).join(" "),
      start_time: g[0].start_time - sh,
      end_time: g[g.length - 1].end_time - sh,
      words: g.map((w) => ({ ...w, start_time: w.start_time - sh, end_time: w.end_time - sh })),
    }));
    return { start: Math.max(0, start), end, sentences: sents };
  });
}


const normWord = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9-]/g, "");

/**
 * Conferência da narração: compara as palavras que o TTS diz que falou (tempos por palavra) com o texto
 * pedido. A voz às vezes pula ou troca uma palavra ("misturadas" sumiu numa tomada) — isso aparece aqui
 * antes de alguém publicar. Retorna os trechos do roteiro com palavra faltando e as palavras a mais.
 */
export function checkTake(text: string, sentences: { words?: { text: string; start_time?: number; end_time?: number }[] }[]) {
  const scr = text.split(/\s+/).map(normWord).filter(Boolean);
  const tts = sentences.flatMap((s) => (s.words ?? []).map((w) => normWord(w.text)).filter(Boolean));
  const n = scr.length;
  const m = tts.length;
  if (!n || !m) return { ok: !n, missing: [] as string[], extra: [] as string[], words: n, spoken: m };
  // maior subsequência comum (n e m na casa das centenas: cabe com folga)
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = scr[i] === tts[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const missing: string[] = [];
  const extra: string[] = [];
  let i = 0;
  let j = 0;
  const ctx = (k: number) => text.split(/\s+/).filter((w) => normWord(w)).slice(Math.max(0, k - 2), k + 3).join(" ");
  while (i < n && j < m) {
    if (scr[i] === tts[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) missing.push(ctx(i++));
    else extra.push(tts[j++]);
  }
  while (i < n) missing.push(ctx(i++));
  while (j < m) extra.push(tts[j++]);
  // ritmo: palavras por segundo de fala (Reels bem editado fica em ~3,5–4,5; acima de 5 soa atropelado)
  const timed = sentences.flatMap((x) => x.words ?? []).filter((w) => /[\p{L}\p{N}]/u.test(w.text) && w.start_time != null && w.end_time != null);
  const span = timed.length > 1 ? (timed[timed.length - 1].end_time! - timed[0].start_time!) / 1000 : 0;
  const wps = span > 0 ? +(timed.length / span).toFixed(2) : null;
  const pace = wps == null ? null : wps > 5 ? "rápida demais" : wps < 2.8 ? "lenta" : "boa";
  return { ok: missing.length === 0 && extra.length === 0, missing, extra, words: n, spoken: m, seconds: +span.toFixed(1), wps, pace };
}
