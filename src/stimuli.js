// Stimulus sets. An image is a Float32Array(IMG*IMG) of luminance in [0,1].
// Two procedural tasks let the whole pipeline be checked without any dataset
// (and give a curriculum: brightness -> gratings -> real faces).

export const IMG = 32;
export const LABEL_NAMES = ['man', 'woman'];

export class StimulusSet {
  // mode: 'brightness' | 'gratings' | 'faint' | 'spot' | 'faces'. For 'faces', `images` is a
  // Float32Array(n*IMG*IMG) and `labels` a Uint8Array(n).
  constructor(mode, images = null, labels = null) {
    this.mode = mode;
    this.images = images;
    this.labels = labels;
    this.byLabel = [[], []];
    if (mode === 'faces') {
      if (!images || !labels || !labels.length) throw new Error('faces mode needs images');
      for (let i = 0; i < labels.length; i++) this.byLabel[labels[i]].push(i);
      if (!this.byLabel[0].length || !this.byLabel[1].length) throw new Error('faces mode needs both classes');
    }
    this.scratch = new Float32Array(IMG * IMG);
  }

  get size() { return this.mode === 'faces' ? this.labels.length : Infinity; }

  // Returns an image of class `label`; valid until the next sample() call.
  sample(rng, label) {
    if (this.mode === 'faces') {
      const list = this.byLabel[label];
      const i = list[Math.floor(rng() * list.length)];
      const src = this.images.subarray(i * IMG * IMG, (i + 1) * IMG * IMG);
      if (rng() < 0.5) return src; // a mirrored face is the same person: free augmentation
      const out = this.scratch;
      for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) out[y * IMG + x] = src[y * IMG + IMG - 1 - x];
      return out;
    }
    const out = this.scratch;
    if (this.mode === 'brightness') {
      const base = label === 1 ? 0.85 : 0.2;
      for (let i = 0; i < out.length; i++) out[i] = base + (rng() - 0.5) * 0.1;
    } else if (this.mode === 'gratings' || this.mode === 'faint') {
      // 'faint' = the same stripes at low contrast under heavy noise: a hard, faces-like task
      const amp = this.mode === 'faint' ? 0.12 : 0.4, noise = this.mode === 'faint' ? 0.3 : 0.05;
      const cycles = 2.5 + rng() * 2, phase = rng() * 2 * Math.PI;
      for (let y = 0; y < IMG; y++) {
        for (let x = 0; x < IMG; x++) {
          const t = (label === 1 ? y : x) / IMG;
          out[y * IMG + x] = 0.5 + amp * Math.sin(2 * Math.PI * cycles * t + phase) + (rng() - 0.5) * noise;
        }
      }
    } else if (this.mode === 'spot') {
      // "Find the spot": faint clutter everywhere, plus one small high-contrast patch of fine
      // stripes at a different place on every image. Only the stripes' direction carries the
      // label, and they are too fine for an even retina to resolve from the centre -- the fly has
      // to look at the patch (active vision) and/or see it sharply there (fovea). The patch is
      // bright and busy compared to the clutter, so it is findable from the corner of the eye.
      const P = 12, half = P / 2, reach = 7;
      const cx = IMG / 2 + Math.round((rng() * 2 - 1) * reach), cy = IMG / 2 + Math.round((rng() * 2 - 1) * reach);
      const phase = rng() * 2 * Math.PI;
      for (let y = 0; y < IMG; y++) {
        for (let x = 0; x < IMG; x++) {
          const inPatch = Math.abs(x + 0.5 - cx) <= half && Math.abs(y + 0.5 - cy) <= half;
          out[y * IMG + x] = inPatch
            ? 0.5 + 0.42 * Math.sign(Math.sin((2 * Math.PI * (label === 1 ? y : x)) / 5 + phase))
            : 0.5 + (rng() - 0.5) * 0.22;
        }
      }
    } else {
      throw new Error('unknown stimulus mode ' + this.mode);
    }
    return out;
  }

  // Plain object safe to post to a Web Worker.
  toMessage() {
    return { mode: this.mode, images: this.images, labels: this.labels };
  }
  static fromMessage(m) { return new StimulusSet(m.mode, m.images, m.labels); }
}

// Deterministic 85/15 train/held-out split of a faces set (per class, fixed
// shuffle) so "novel" images are genuinely never used for training.
export function splitFaces(images, labels, heldOutFraction = 0.15, seed = 7) {
  const n = labels.length;
  const idx = [[], []];
  for (let i = 0; i < n; i++) idx[labels[i]].push(i);
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const parts = { train: [], test: [] };
  for (const list of idx) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const cut = Math.max(1, Math.floor(list.length * (1 - heldOutFraction)));
    parts.train.push(...list.slice(0, cut));
    parts.test.push(...list.slice(cut));
  }
  const pack = (ids) => {
    const im = new Float32Array(ids.length * IMG * IMG), lb = new Uint8Array(ids.length);
    ids.forEach((id, k) => { im.set(images.subarray(id * IMG * IMG, (id + 1) * IMG * IMG), k * IMG * IMG); lb[k] = labels[id]; });
    return new StimulusSet('faces', im, lb);
  };
  return { train: pack(parts.train), test: pack(parts.test) };
}

// ---------------------------------------------------------------- packed faces
// The bundled faces ship as one file of raw 32x32 grayscale bytes (data/faces32.bin, labels in
// data/faces32.json) instead of 1,000 JPEGs: one download in the browser, and Node can read it
// without a JPEG decoder, so the real photos can be tested from the command line too.

// Exposure normalisation shared by every face path: mean 0.5, fixed contrast (the fly's early
// vision adapts to this anyway, and it stops "brighter photo" standing in for "woman").
export function normalizeFace(g) {
  let m = 0;
  for (let i = 0; i < g.length; i++) m += g[i] / g.length;
  let v = 0;
  for (let i = 0; i < g.length; i++) v += (g[i] - m) ** 2 / g.length;
  const k = 0.2 / (Math.sqrt(v) + 0.02);
  for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(1, 0.5 + (g[i] - m) * k));
  return g;
}

// bytes: Uint8Array(n * IMG * IMG); labels: array of 0/1. Returns { train, test } StimulusSets.
export function unpackFaces(bytes, labels, cap = Infinity) {
  const per = [0, 0], keep = [];
  labels.forEach((l, i) => { if (per[l] < cap) { per[l]++; keep.push(i); } });
  const images = new Float32Array(keep.length * IMG * IMG);
  const g = new Float32Array(IMG * IMG);
  keep.forEach((src, k) => {
    for (let p = 0; p < IMG * IMG; p++) g[p] = bytes[src * IMG * IMG + p] / 255;
    images.set(normalizeFace(g), k * IMG * IMG);
  });
  return splitFaces(images, Uint8Array.from(keep, (i) => labels[i]));
}
