import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { clusterDetections, runCascade, unpackCascade, type Classifier } from "./pico.js";

/**
 * Reenquadre que segue quem fala (9:16 de uma live 16:9 sem cortar a pessoa fora).
 * Local e grátis: o FFmpeg manda frames cinza de 320 px (2 por segundo) pro pico (detector de
 * rosto em JS puro); a trilha do rosto vira poucos "keyframes" de pan (a câmera fica parada e só
 * se move quando a pessoa sai da zona morta) e entra no filtro crop do FFmpeg como expressão em t.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CASCADE = join(ROOT, "apps/api/assets/facefinder");
let classifier: Classifier | null = null;
async function getClassifier() {
  if (!classifier) classifier = unpackCascade(new Uint8Array(await readFile(CASCADE)));
  return classifier;
}

export interface FaceSample { t: number; cx: number | null; cy: number | null; size: number; q: number }

/** amostra o vídeo (trecho opcional) e devolve o centro do rosto principal por amostra (normalizado 0..1) */
export async function faceTrack(bin: string, src: string, size: { w: number; h: number }, range: { start: number; end: number } | null, opt: { fps?: number; width?: number; onProgress?: (s: string) => void } = {}): Promise<FaceSample[]> {
  const classify = await getClassifier();
  const W = opt.width ?? 400;
  const H = Math.max(2, Math.round((W * size.h) / size.w / 2) * 2);
  const fps = opt.fps ?? 2;
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
  if (range) args.push("-ss", range.start.toFixed(3), "-to", range.end.toFixed(3));
  args.push("-i", src, "-vf", `fps=${fps},scale=${W}:${H}`, "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1");
  const frameBytes = W * H;
  const samples: FaceSample[] = [];
  let prev: FaceSample | null = null;
  let n = 0;
  await new Promise<void>((resolveP, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = Buffer.alloc(0) as Buffer;
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.stdout.on("data", (chunk: Buffer) => {
      buf = (buf.length ? Buffer.concat([buf, chunk]) : chunk) as Buffer;
      while (buf.length >= frameBytes) {
        const frame = buf.subarray(0, frameBytes);
        buf = buf.subarray(frameBytes);
        const pixels = new Uint8Array(frame.buffer, frame.byteOffset, frameBytes);
        const dets = clusterDetections(runCascade({ pixels, nrows: H, ncols: W, ldim: W }, classify, { shiftfactor: 0.1, minsize: Math.round(W * 0.04), maxsize: Math.round(W * 0.5), scalefactor: 1.12 }), 0.2)
          .filter((d) => d[3] > 12)
          .map((d) => ({ cx: d[1] / W, cy: d[0] / H, size: d[2] / W, q: d[3] }));
        const t = n / fps;
        n++;
        if (!dets.length) {
          samples.push({ t, cx: null, cy: null, size: 0, q: 0 });
          continue;
        }
        // rosto principal: o maior/mais confiante, com preferência por continuar perto do anterior
        const score = (d: (typeof dets)[number]) => d.q * d.size * (prev?.cx != null && Math.hypot(d.cx - prev.cx, d.cy - (prev.cy ?? 0)) < 0.15 ? 2 : 1);
        const best = dets.sort((a, b) => score(b) - score(a))[0];
        const s: FaceSample = { t, cx: best.cx, cy: best.cy, size: best.size, q: best.q };
        samples.push(s);
        prev = s;
        if (n % (fps * 60) === 0) opt.onProgress?.(`seguindo o rosto (${Math.round(t / 60)} min)`);
      }
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolveP() : reject(new Error(`ffmpeg (face track) saiu com ${code}\n${err.slice(-500)}`))));
  });
  return samples;
}

export interface PanKey { t: number; x: number; y: number; ease: number }

/**
 * Trilha → keyframes de pan: a câmera fica parada e só se move quando o rosto sai da zona morta
 * (mantido por pelo menos 3 amostras); salto grande (outra pessoa) vira corte seco.
 * Coordenadas normalizadas (0..1 = centro do rosto na imagem original).
 */
export function panKeyframes(samples: FaceSample[], opt: { deadzone?: number; minHold?: number; ease?: number } = {}): PanKey[] {
  const dz = opt.deadzone ?? 0.07;
  const minHold = opt.minHold ?? 1.0;
  const ease = opt.ease ?? 0.5;
  const known = samples.filter((s) => s.cx != null);
  if (known.length < Math.max(2, samples.length * 0.08)) return []; // quase nunca achou rosto → corte central
  // preenche buracos com o último valor conhecido e suaviza (mediana de 3)
  let lx = known[0].cx!, ly = known[0].cy!;
  const filled = samples.map((s) => {
    if (s.cx != null) {
      lx = s.cx;
      ly = s.cy!;
    }
    return { t: s.t, x: lx, y: ly };
  });
  const med = (a: number, b: number, c: number) => [a, b, c].sort((p, q) => p - q)[1];
  const sm = filled.map((p, i) => ({ t: p.t, x: med(filled[Math.max(0, i - 1)].x, p.x, filled[Math.min(filled.length - 1, i + 1)].x), y: med(filled[Math.max(0, i - 1)].y, p.y, filled[Math.min(filled.length - 1, i + 1)].y) }));
  const keys: PanKey[] = [{ t: 0, x: sm[0].x, y: sm[0].y, ease: 0 }];
  let cur = { x: sm[0].x, y: sm[0].y };
  let lastMove = -Infinity;
  for (let i = 0; i < sm.length; i++) {
    const p = sm[i];
    const dx = p.x - cur.x, dy = p.y - cur.y;
    if (Math.abs(dx) <= dz && Math.abs(dy) <= dz) continue;
    if (p.t - lastMove < minHold) continue;
    // sustentado? as próximas amostras também estão fora da zona
    const nxt = sm.slice(i + 1, i + 3);
    if (nxt.length && !nxt.every((q) => Math.abs(q.x - cur.x) > dz * 0.6 || Math.abs(q.y - cur.y) > dz * 0.6)) continue;
    const target = nxt.length ? { x: (p.x + nxt.reduce((a, q) => a + q.x, 0)) / (nxt.length + 1), y: (p.y + nxt.reduce((a, q) => a + q.y, 0)) / (nxt.length + 1) } : { x: p.x, y: p.y };
    const jump = Math.hypot(target.x - cur.x, target.y - cur.y) > 0.3;
    cur = target;
    // movimento contínuo (keys seguidos) → pan quase contínuo; parado há tempo → pan curto
    const since = p.t - keys[keys.length - 1].t;
    keys.push({ t: p.t, x: cur.x, y: cur.y, ease: jump ? 0.12 : Math.min(0.9, Math.max(ease, since * 0.8)) });
    lastMove = p.t;
  }
  return keys;
}

/**
 * Expressão do crop (x ou y) a partir dos keyframes: soma plana (sem aninhar ifs) —
 * X(t) = x0 + Σ Δx_i · smoothstep((t − T_i)/E_i), em pixels da imagem já escalada, limitado à borda.
 * `mapT` converte o tempo das amostras (origem do trecho) pro tempo do vídeo de saída (ex.: depois de tirar pausas).
 */
export function cropExpr(keys: PanKey[], axis: "x" | "y", scaled: number, crop: number, mapT: (t: number) => number = (t) => t): string {
  const max = Math.max(0, scaled - crop);
  if (!keys.length || max === 0) return String(Math.round(max / 2));
  const v = (k: PanKey) => (axis === "x" ? k.x : k.y);
  let expr = `${scaled}*(${v(keys[0]).toFixed(4)}`;
  for (let i = 1; i < keys.length; i++) {
    const d = v(keys[i]) - v(keys[i - 1]);
    if (Math.abs(d) < 0.002) continue;
    const T = Math.max(0, mapT(keys[i].t)).toFixed(3);
    const E = Math.max(0.05, keys[i].ease).toFixed(2);
    expr += `+(${d.toFixed(4)})*st(0,clip((t-${T})/${E},0,1))*ld(0)*(3-2*ld(0))`;
  }
  expr += `)-${(crop / 2).toFixed(1)}`;
  return `clip(${expr},0,${max})`;
}
