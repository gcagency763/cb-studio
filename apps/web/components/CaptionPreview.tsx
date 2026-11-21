"use client";

import { useMemo } from "react";

export type Word = { text: string; start_time: number; end_time: number };

/**
 * Pré-visualização da legenda igual à montagem final (ASS): caixa alta opcional,
 * contorno preto, palavra atual em dourado no modo karaokê.
 * `t` = tempo atual da narração em segundos; sem palavras, mostra a frase inteira.
 */
export function CaptionPreview({ text, words, t, karaoke, uppercase, size = 1 }: { text: string; words?: Word[]; t: number; karaoke: boolean; uppercase: boolean; size?: number }) {
  const tokens = useMemo(() => {
    const ws = (words ?? []).filter((w) => w.text.trim() && /[\p{L}\p{N}]/u.test(w.text));
    if (ws.length) return ws.map((w) => ({ text: w.text, start: w.start_time / 1000, end: w.end_time / 1000 }));
    return text
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ text: w, start: -1, end: -1 }));
  }, [text, words]);
  if (!tokens.length) return null;
  const ms = t * 1000;
  // mostra só a frase em curso (como a montagem faz por sentença): janela de ~26 chars por linha, até 2 linhas
  const activeIdx = tokens.findIndex((w, i) => w.start >= 0 && ms >= w.start * 1000 && (i + 1 >= tokens.length || ms < tokens[i + 1].start * 1000));
  const lines = wrap(tokens.map((w) => (uppercase ? w.text.toUpperCase() : w.text)), 26);
  return (
    <div className="cap-prev" style={{ fontSize: `${2.1 * size}em` }} aria-hidden>
      {lines.map((line, li) => (
        <div key={li} className="cap-line">
          {line.map((idx) => (
            <span key={idx} className={karaoke && idx === activeIdx ? "hot" : karaoke && activeIdx >= 0 && idx < activeIdx ? "done" : ""}>
              {uppercase ? tokens[idx].text.toUpperCase() : tokens[idx].text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function wrap(words: string[], max: number): number[][] {
  const lines: number[][] = [];
  let cur: number[] = [];
  let len = 0;
  words.forEach((w, i) => {
    if (len + w.length + 1 > max && cur.length) {
      lines.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(i);
    len += w.length + 1;
  });
  if (cur.length) lines.push(cur);
  return lines;
}

/** card de texto igual ao render (título, linha menor, botão dourado) */
export function CardPreview({ text, subtext, button, bg, size = 1 }: { text?: string; subtext?: string; button?: string; bg?: string; size?: number }) {
  return (
    <div className="card-stage" style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
      <div className="card-stage-in" style={{ fontSize: `${size}em` }}>
        <b>{text || "CARD"}</b>
        {subtext && <i>{subtext}</i>}
        {button && <span>{button.toUpperCase()}</span>}
      </div>
    </div>
  );
}
