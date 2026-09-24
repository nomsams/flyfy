// Stimulus sets. An image is a Float32Array(IMG*IMG) of luminance in [0,1].
// Two procedural tasks let the whole pipeline be checked without any dataset
// (and give a curriculum: brightness -> gratings -> real faces).

export const IMG = 32;
export const LABEL_NAMES = ['man', 'woman'];

export class StimulusSet {
  // mode: 'brightness' | 'gratings' | 'faces'. For 'faces', `images` is a
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
    } else if (this.mode === 'gratings') {
      const cycles = 2.5 + rng() * 2, phase = rng() * 2 * Math.PI;
      for (let y = 0; y < IMG; y++) {
        for (let x = 0; x < IMG; x++) {
          const t = (label === 1 ? y : x) / IMG;
          out[y * IMG + x] = 0.5 + 0.4 * Math.sin(2 * Math.PI * cycles * t + phase) + (rng() - 0.5) * 0.05;
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
