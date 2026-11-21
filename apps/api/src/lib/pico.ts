/**
 * pico — detector de rosto em JS puro (Nenad Markus, MIT: https://github.com/nenadmarkus/picojs).
 * Cascata `assets/facefinder` (~240 KB). Roda em frames cinza de 320 px em ~10 ms, sem GPU nem dependências.
 */
export type Detection = [r: number, c: number, s: number, q: number];
export type Classifier = (r: number, c: number, s: number, pixels: Uint8Array, ldim: number) => number;

export function unpackCascade(bytes: Uint8Array): Classifier {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  const tdepth = dv.getInt32(p, true);
  p += 4;
  const ntrees = dv.getInt32(p, true);
  p += 4;
  const pow2 = 2 ** tdepth;
  const tcodes = new Int8Array(ntrees * 4 * pow2);
  const tpreds = new Float32Array(ntrees * pow2);
  const thresh = new Float32Array(ntrees);
  for (let t = 0; t < ntrees; t++) {
    // 4 zeros + os testes binários dos nós internos
    const base = t * 4 * pow2;
    for (let i = 0; i < 4 * pow2 - 4; i++) tcodes[base + 4 + i] = dv.getInt8(p + i);
    p += 4 * pow2 - 4;
    for (let i = 0; i < pow2; i++) {
      tpreds[t * pow2 + i] = dv.getFloat32(p, true);
      p += 4;
    }
    thresh[t] = dv.getFloat32(p, true);
    p += 4;
  }
  return (r, c, s, pixels, ldim) => {
    r = 256 * r;
    c = 256 * c;
    let root = 0;
    let o = 0;
    for (let i = 0; i < ntrees; i++) {
      let idx = 1;
      for (let j = 0; j < tdepth; j++) {
        const k = root + 4 * idx;
        idx = 2 * idx + (pixels[((r + tcodes[k] * s) >> 8) * ldim + ((c + tcodes[k + 1] * s) >> 8)] <= pixels[((r + tcodes[k + 2] * s) >> 8) * ldim + ((c + tcodes[k + 3] * s) >> 8)] ? 1 : 0);
      }
      o += tpreds[pow2 * i + idx - pow2];
      if (o <= thresh[i]) return -1;
      root += 4 * pow2;
    }
    return o - thresh[ntrees - 1];
  };
}

export function runCascade(img: { pixels: Uint8Array; nrows: number; ncols: number; ldim: number }, classify: Classifier, p: { shiftfactor: number; minsize: number; maxsize: number; scalefactor: number }): Detection[] {
  const out: Detection[] = [];
  let scale = p.minsize;
  while (scale <= p.maxsize) {
    const step = Math.max(p.shiftfactor * scale, 1) >> 0;
    const offset = (scale / 2 + 1) >> 0;
    for (let r = offset; r <= img.nrows - offset; r += step)
      for (let c = offset; c <= img.ncols - offset; c += step) {
        const q = classify(r, c, scale, img.pixels, img.ldim);
        if (q > 0) out.push([r, c, scale, q]);
      }
    scale *= p.scalefactor;
  }
  return out;
}

export function clusterDetections(dets: Detection[], iou: number): Detection[] {
  dets = dets.slice().sort((a, b) => b[3] - a[3]);
  const iouOf = (a: Detection, b: Detection) => {
    const overr = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2));
    const overc = Math.max(0, Math.min(a[1] + a[2] / 2, b[1] + b[2] / 2) - Math.max(a[1] - a[2] / 2, b[1] - b[2] / 2));
    return (overr * overc) / (a[2] * a[2] + b[2] * b[2] - overr * overc);
  };
  const taken = new Uint8Array(dets.length);
  const clusters: Detection[] = [];
  for (let i = 0; i < dets.length; i++) {
    if (taken[i]) continue;
    let r = 0, c = 0, s = 0, q = 0, n = 0;
    for (let j = i; j < dets.length; j++) {
      if (!taken[j] && iouOf(dets[i], dets[j]) > iou) {
        taken[j] = 1;
        r += dets[j][0];
        c += dets[j][1];
        s += dets[j][2];
        q += dets[j][3];
        n++;
      }
    }
    clusters.push([r / n, c / n, s / n, q]);
  }
  return clusters;
}
