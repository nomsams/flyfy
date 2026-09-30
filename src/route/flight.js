// Flying over a Wonderland maze: what the fly's eye sees looking straight down, where the route is,
// and which way a teacher would steer.
//
// Pose: { x, y } on the map (pixels), heading th (radians; 0 = east, y grows downward, so turning
// left makes th smaller), alt (1 = the trained height; the view's footprint grows with it).
// The eye is the same 14 x 20 grid as in the photo test, lying on the ground below: its 14 rows
// run from ahead (row 0) to behind, its 20 columns from left to right, so the picture turns with
// the fly. At height 1 the view covers 1.6 x 2.3 maze cells. Every sensor averages the ground
// under it (a small image pyramid), so the view doesn't shimmer as the fly moves.

// Weather and time of day, applied to what the camera sees: the light (and its colour), haze or fog
// (the picture fades toward a pale grey) and camera noise (random speckle on every sensor, every frame).
export const WEATHER = {
  clear: {},
  haze: { fog: 0.3 },
  fog: { fog: 0.6 },
  overcast: { light: 0.85, fog: 0.15, tint: [0.95, 0.98, 1.05] },
  dusk: { light: 0.55, tint: [1.12, 0.95, 0.78] },
  night: { light: 0.25, tint: [0.8, 0.9, 1.2], noise: 0.05 },
  noisy: { noise: 0.08 },
};

export class RouteFlight {
  constructor(world, cfg) {
    this.w = world; this.cfg = cfg;
    const e = cfg.eye;
    this.R = e.rows; this.C = e.cols;
    this.retinas = [new Float32Array(this.R * this.C)];
    this.chroma = [new Float32Array(2 * this.R * this.C)];
    this.touch = new Float32Array(2); this.pain = new Float32Array(2); this.pos = new Float32Array(3);
    this.viewLen = world.cell * 1.6; // ground length covered by the eye at height 1 (pixels)
    // sensor offsets on the ground in units of the view (-0.5..0.5), with the optional sharp centre
    const k = e.fovea || 0, warp = (t) => (k ? Math.tan(t * k) / Math.tan(k) : t);
    this.fwd = Float32Array.from({ length: this.R }, (_, r) => -0.5 * warp(-1 + (2 * (r + 0.5)) / this.R));
    this.side = Float32Array.from({ length: this.C }, (_, c) => 0.5 * warp(-1 + (2 * (c + 0.5)) / this.C));
    // image pyramid of the map (level L = 2^L pixels averaged), per colour plane
    const { W, H, rgb } = world, N = W * H;
    this.levels = [{ w: W, h: H, p: [rgb.subarray(0, N), rgb.subarray(N, 2 * N), rgb.subarray(2 * N)] }];
    while (this.levels[this.levels.length - 1].w > 8) {
      const a = this.levels[this.levels.length - 1], w = a.w >> 1, h = a.h >> 1;
      const p = a.p.map((src) => { const d = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * a.w + 2 * x; d[y * w + x] = (src[i] + src[i + 1] + src[i + a.w] + src[i + a.w + 1]) / 4; } return d; });
      this.levels.push({ w, h, p });
    }
    this.hint = 0; // where on the route the last lookup ended (speeds up the next one)
    this.setWeather('clear');
    this._seed = 12345;
  }
  // name of a WEATHER preset, or { fog, light, tint, noise }
  setWeather(w) {
    const p = typeof w === 'string' ? WEATHER[w] || {} : w || {};
    this.weather = { fog: p.fog || 0, light: p.light ?? 1, tint: p.tint || [1, 1, 1], noise: p.noise || 0, fogCol: [0.78, 0.8, 0.82] };
  }
  _gauss() { // camera noise
    let u = 0;
    for (let i = 0; i < 4; i++) { this._seed = (Math.imul(this._seed, 1664525) + 1013904223) >>> 0; u += this._seed / 4294967296; }
    return (u - 2) * 1.732;
  }

  // colour of the ground at (x, y) seen through a blur of about `spread` pixels (bilinear in the pyramid)
  _sample(x, y, spread, out) {
    const L = Math.max(0, Math.min(this.levels.length - 1, Math.floor(Math.log2(Math.max(1, spread)))));
    const lv = this.levels[L], s = 1 << L, fx = x / s - 0.5, fy = y / s - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    for (let c = 0; c < 3; c++) {
      const p = lv.p[c];
      const at = (xx, yy) => (xx < 0 || yy < 0 || xx >= lv.w || yy >= lv.h ? 0.3 : p[yy * lv.w + xx]); // beyond the map: dull ground
      const a = at(x0, y0), b = at(x0 + 1, y0), d = at(x0, y0 + 1), e = at(x0 + 1, y0 + 1);
      out[c] = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
    }
  }

  // render the downward view for a pose into retinas[0] (brightness) and chroma[0] (colour)
  view(p) {
    const { R, C } = this, e = this.cfg.eye, len = this.viewLen * p.alt, wid = len * (C / R);
    const fx = Math.cos(p.th), fy = Math.sin(p.th), rx = -fy, ry = fx; // forward and right on the map
    // optional centre of gaze (a swarm member's own viewpoint): p.gx ahead, p.gy to the right, in view lengths
    const cx = p.x + ((p.gx || 0) * fx + (p.gy || 0) * rx) * len, cy = p.y + ((p.gx || 0) * fy + (p.gy || 0) * ry) * len;
    const L = this.retinas[0], Q = this.chroma[0], col = [0, 0, 0], spread = len / R;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const f = this.fwd[r] * len, s = this.side[c] * wid, i = r * C + c;
      this._sample(cx + fx * f + rx * s, cy + fy * f + ry * s, spread, col);
      const wt = this.weather;
      if (wt.fog || wt.light !== 1) for (let c = 0; c < 3; c++) col[c] = (col[c] * (1 - wt.fog) + wt.fogCol[c] * wt.fog) * wt.light * wt.tint[c];
      L[i] = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
      Q[i] = e.colour ? col[0] - col[1] : 0;
      Q[R * C + i] = e.colour ? col[2] - (col[0] + col[1]) / 2 : 0;
      if (wt.noise) { L[i] += wt.noise * this._gauss(); if (e.colour) { Q[i] += 0.5 * wt.noise * this._gauss(); Q[R * C + i] += 0.5 * wt.noise * this._gauss(); } }
    }
    // what the camera itself saw (weather included), before any contrast filter: for showing
    if (e.normalize) { this.rawL = Float32Array.from(L); this.rawQ = Float32Array.from(Q); } else { this.rawL = L; this.rawQ = Q; }
    if (e.normalize) { // contrast filter: stretch the view so its brightness always has the same spread
      let m = 0, v = 0;
      for (let i = 0; i < R * C; i++) m += L[i] / (R * C);
      for (let i = 0; i < R * C; i++) v += (L[i] - m) ** 2 / (R * C);
      const g = 0.18 / (Math.sqrt(v) + 0.01);
      for (let i = 0; i < R * C; i++) L[i] = 0.5 + (L[i] - m) * g;
      if (e.colour) for (let i = 0; i < 2 * R * C; i++) Q[i] *= g; // colour differences stretched by the same gain
    }
    if (e.lateralInhib) { // edge boost, exactly as in the photo world
      const raw = Float32Array.from(L);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const i = r * C + c; let n = 0, sum = 0;
        if (r > 0) { sum += raw[i - C]; n++; } if (r < R - 1) { sum += raw[i + C]; n++; }
        if (c > 0) { sum += raw[i - 1]; n++; } if (c < C - 1) { sum += raw[i + 1]; n++; }
        L[i] = Math.max(0, Math.min(1, raw[i] + e.lateralInhib * (raw[i] - sum / n)));
      }
    }
  }

  // the route point nearest the fly: { i, d (distance, px), s (distance along the route, px) }
  nearest(p, global = false) {
    const { x: X, y: Y, s: S } = this.w.route, n = X.length;
    const lo = global ? 0 : Math.max(0, this.hint - 60), hi = global ? n : Math.min(n, this.hint + 120);
    let best = Infinity, bi = lo;
    for (let i = lo; i < hi; i++) { const d = (X[i] - p.x) ** 2 + (Y[i] - p.y) ** 2; if (d < best) { best = d; bi = i; } }
    this.hint = bi;
    return { i: bi, d: Math.sqrt(best), s: S[bi] };
  }

  // the teacher: the heading error (radians, + = turn right) toward a point a little further along the route
  teacher(p, lookahead = 0.6) {
    const { x: X, y: Y } = this.w.route, nr = this.nearest(p), j = Math.min(X.length - 1, nr.i + Math.round((lookahead * this.w.cell) / 2));
    let err = Math.atan2(Y[j] - p.y, X[j] - p.x) - p.th;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    return { err, near: nr };
  }
}
