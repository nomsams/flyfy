// Lens blur: what makes a billboard look clean from far away.
//
// A real ommatidium doesn't read one exact point of the world: its lens gathers light from a small
// cone (the acceptance angle, about as wide as the gap to its neighbour), so each receptor sees a
// blurred average of everything in that cone. That blur is exactly what stops a coarse eye from
// seeing false moire patterns, and it is why a picture seen from further away looks smoother: more
// pixels fall inside each receptor's cone and get averaged together.
//
// To make that cheap, each new picture is turned once into a "mipmap": the picture on a patch of
// background, then successively blurred and halved (64, 32, 16, ... pixels). Any receptor can then
// read the picture at exactly the blur its cone implies -- at any distance, zoom or eye position --
// by blending the two nearest levels. Cost: ~40k operations per picture, and a few per receptor.

import { IMG } from './stimuli.js';

export const PAD = 16;              // background around the picture on the canvas (pixels)
export const SIZE = IMG + 2 * PAD;  // 64 x 64 canvas
const LEVELS = Math.log2(SIZE) + 1; // 64, 32, 16, 8, 4, 2, 1
const K = [1, 4, 6, 4, 1];

// Blur (Gaussian sigma, in canvas pixels) that each level carries: a 1-4-6-4-1 filter (sigma 1 at
// that level's own resolution) before every halving adds sigma 2^(L-1) in level-0 pixels.
export const LEVEL_SIGMA = Array.from({ length: LEVELS }, (_, L) => {
  let v = 0;
  for (let k = 1; k <= L; k++) v += 4 ** (k - 1);
  return Math.sqrt(v);
});

export class Mipmap {
  constructor() {
    this.levels = Array.from({ length: LEVELS }, (_, L) => new Float32Array((SIZE >> L) ** 2));
    this.tmp = new Float32Array(SIZE * SIZE);
    this.bg = 0;
  }

  build(img, bg) {
    this.bg = bg;
    const L0 = this.levels[0];
    L0.fill(bg);
    for (let y = 0; y < IMG; y++) L0.set(img.subarray(y * IMG, (y + 1) * IMG), (y + PAD) * SIZE + PAD);
    for (let L = 1; L < LEVELS; L++) {
      const src = this.levels[L - 1], n = SIZE >> (L - 1), dst = this.levels[L], m = n >> 1, tmp = this.tmp;
      // separable 1-4-6-4-1 blur (outside the canvas counts as background), then keep every 2nd pixel
      const at = (a, x, y) => (x < 0 || y < 0 || x >= n || y >= n ? bg : a[y * n + x]);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        tmp[y * n + x] = (at(src, x - 2, y) + 4 * at(src, x - 1, y) + 6 * src[y * n + x] + 4 * at(src, x + 1, y) + at(src, x + 2, y)) / 16;
      }
      for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
        const cx = 2 * x, cy = 2 * y; // level-L pixel x sits at level-0 coordinate x * 2^L
        let s = 0;
        for (let k = -2; k <= 2; k++) s += K[k + 2] * at(tmp, cx, cy + k);
        dst[y * m + x] = s / 16;
      }
    }
  }

  // Brightness at canvas position (x, y) (level-0 pixels, continuous) seen through a Gaussian of
  // `sigma` level-0 pixels.
  sample(x, y, sigma) {
    let L = 0;
    while (L < LEVELS - 2 && LEVEL_SIGMA[L + 1] <= sigma) L++;
    const f = Math.max(0, Math.min(1, (sigma - LEVEL_SIGMA[L]) / (LEVEL_SIGMA[L + 1] - LEVEL_SIGMA[L])));
    const a = this._bilinear(L, x, y);
    return f > 0 ? a + (this._bilinear(L + 1, x, y) - a) * f : a;
  }

  _bilinear(L, x0, y0) {
    const n = SIZE >> L, lv = this.levels[L], bg = this.bg;
    const x = x0 / (1 << L), y = y0 / (1 << L);
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= n || yy >= n ? bg : lv[yy * n + xx]);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
}
