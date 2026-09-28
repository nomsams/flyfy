// Flying over a Wonderland maze: what the fly's eye sees looking straight down, where the route is,
// and which way a teacher would steer.
//
// Pose: { x, y } on the map (pixels), heading th (radians; 0 = east, y grows downward, so turning
// left makes th smaller), alt (1 = the trained height; the view's footprint grows with it).
// The eye is the same 14 x 20 grid as in the photo test, lying on the ground below: its 14 rows
// run from ahead (row 0) to behind, its 20 columns from left to right, so the picture turns with
// the fly. At height 1 the view covers 1.6 x 2.3 maze cells. Every sensor averages the ground
// under it (a small image pyramid), so the view doesn't shimmer as the fly moves.

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
    const L = this.retinas[0], Q = this.chroma[0], col = [0, 0, 0], spread = len / R;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      const f = this.fwd[r] * len, s = this.side[c] * wid, i = r * C + c;
      this._sample(p.x + fx * f + rx * s, p.y + fy * f + ry * s, spread, col);
      L[i] = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2];
      Q[i] = e.colour ? col[0] - col[1] : 0;
      Q[R * C + i] = e.colour ? col[2] - (col[0] + col[1]) / 2 : 0;
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
