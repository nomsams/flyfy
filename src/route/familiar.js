// Route following by familiarity, the way ants and bees are thought to do it, for one fly or a swarm -
// and finding the route in the first place, from anywhere on the map.
//
// Route memory: while the route is flown (with a teacher), every view silences the Kenyon cells it uses
// on a "novelty" output, as dopamine does in the mushroom body. Nothing about the route itself is
// stored, only what the world looked like while on it: one bit per Kenyon cell.
// Approach memory (a second output, as the mushroom body keeps different memories in different
// compartments): "learning flights" from spots all over the map toward the route, like the learning
// walks ants make around their nest. Graded: each view halves the novelty of the cells it uses (a yes/no
// memory fills up - after ~2,000 views 94% of cells are familiar and directions look alike).
//
// Navigating: each swarm member looks in 9 directions and rates how unfamiliar each looks; the swarm
// adds the ratings up. While the route itself looks familiar, the fly follows the route memory; until
// then it follows the approach memory, which leads it to the route. Optionally, when nothing looks
// familiar it casts like a moth that lost a scent (it made things worse so far; off by default).
//
// Keeping track (track: true): the fly doesn't decide from scratch at every step. While learning the
// route it also stores, in order, the sparse Kenyon-cell pattern it saw at points along the route (and
// the route's direction there). While flying it keeps a belief about how far along the route it is:
// moved on by its own known speed and heading (an ideal helicopter knows both; insects do this by
// path integration), blurred a little for uncertainty, and sharpened by how well the current view
// matches the stored patterns - a sequence of views tells look-alike corridors apart where a single view
// can't. It then prefers directions close to the route's direction at its best guess, the more so the
// surer it is, while the familiarity scan still corrects sideways drift.
//
// Knowing where on the map it is (mapTrack): during the learning flights the fly also stores, for every
// spot, the view turned north-up (the helicopter's compass lets it turn its camera image, so one stored
// view per spot fits whatever way it faces), and while learning the route it notes where the route
// lies (its own odometry). Dropped somewhere, it keeps a belief over the whole map - moved on by its own
// motion, sharpened by matching its north-up view - and, once sure, flies from its best guess straight
// toward the route instead of feeling its way there with the approach memory alone.
//
// Three more options:
// - aversive: a "wrong way" memory. While learning the route the fly also looks 90 degrees left and
//   right and stores those views as "not this way" (graded, like the approach memory); directions that
//   look familiar to it are avoided - the opposing mushroom-body outputs used in ant route models.
// - climb: when the route is out of sight or it isn't sure where it is, the helicopter climbs (to see
//   fields, roads and houses beyond the hedges), and comes back down to its cruising height once sure.
// - layout: where the swarm members look, given explicitly - e.g. rowOfCircles() below: three circles
//   in a row across one camera frame, a small ring to the left, a larger one in the middle, a small one
//   to the right.
//
// Every member has its own centre of gaze on a circle around the fly (gazeR view lengths), its own
// "average view" to centre its Kenyon cells on, and its own memories - one per height band when `banks`
// is on (the fly knows its height). All members share one wiring: one brain computes everyone's
// Kenyon cells in turn.

export const SCAN = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((d) => (d * Math.PI) / 180);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Three circles in a row across one camera frame (like the Swedish House Mafia logo): `side` members on
// a small ring (radius sideR) to the left and to the right (offset `apart` view lengths sideways), and
// `mid` members on a larger ring (midR) in the middle. Returns the members' [ahead, right] gaze offsets.
export function rowOfCircles({ side = 2, mid = 3, apart = 0.5, sideR = 0.12, midR = 0.25 } = {}) {
  const ring = (n, r, cy) => Array.from({ length: n }, (_, k) => (n === 1 ? [0, cy] : [r * Math.cos((2 * Math.PI * k) / n), cy + r * Math.sin((2 * Math.PI * k) / n)]));
  return [...ring(side, sideR, -apart), ...ring(mid, midR, 0), ...ring(side, sideR, apart)];
}

export class FamiliarSwarm {
  // brain: a Brain with the memory centre on; flight: a RouteFlight to render views with
  // onRoute: the share of a view's firing cells that may be unfamiliar for the route to count as found
  constructor(brain, flight, { swarm = 1, gazeR = 0.25, alts = [1], banks = false, castThr = 0.1, onRoute = 0.12, approachDecay = 0.5, track = false, trackGain = 0.6,
    aversive = false, aversiveGain = 0.5, layout = null, mapTrack = false, mapGain = 1, arrive = false, mapSwarm = false, mapSharp = 12, scales = null } = {}) {
    if (!brain.nKC) throw new Error('familiarity needs the memory centre');
    Object.assign(this, { brain, F: flight, alts, banks, castThr, onRoute, approachDecay, hasApproach: false, track, trackGain, aversive, aversiveGain, mapTrack, mapGain, arrive, mapSwarm, mapSharp });
    this.mapSnaps = []; this.routePts = []; // (mapTrack) north-up views of the map, and where the route lies
    const K = layout ? layout.length : Math.max(1, swarm), nb = banks ? alts.length : 1;
    const spot = (k) => (layout ? layout[k] : K > 1 ? [gazeR * Math.cos((2 * Math.PI * k) / K), gazeR * Math.sin((2 * Math.PI * k) / K)] : [0, 0]);
    this.members = Array.from({ length: K }, (_, k) => ({
      gx: spot(k)[0], gy: spot(k)[1], scale: scales ? scales[k % scales.length] : 1, // (scales: member k looks at the ground zoomed by this much: a wide, a close and a normal view)
      sum: new Float64Array(brain.rv.length), n: 0, rmean: null,
      memory: Array.from({ length: nb }, () => new Uint8Array(brain.nKC).fill(1)),
      approach: Array.from({ length: nb }, () => new Float32Array(brain.nKC).fill(1)),
      snaps: Array.from({ length: nb }, () => []), // (track) the patterns seen along the route, in order
      wrong: Array.from({ length: nb }, () => new Float32Array(brain.nKC).fill(1)), // (aversive) "not this way"
    }));
  }
  get size() { return this.members.length; }
  bankOf(h) {
    if (!this.banks) return 0;
    let bi = 0;
    for (let i = 1; i < this.alts.length; i++) if (Math.abs(Math.log(h / this.alts[i])) < Math.abs(Math.log(h / this.alts[bi]))) bi = i;
    return bi;
  }
  // the Kenyon cells member m uses for the view from pose p
  see(m, p) {
    const F = this.F, b = this.brain;
    F.view({ ...p, gx: m.gx, gy: m.gy, alt: p.alt * (m.scale || 1) });
    if (m.rmean) b.rmean.set(m.rmean);
    b.step(F.retinas, F.touch, F.pain, F.pos, F.chroma);
    return b.kc;
  }
  // learning, step 1: collect every member's average view along the route
  addToAverage(p) { for (const m of this.members) { this.see(m, p); const rv = this.brain.rv; for (let j = 0; j < rv.length; j++) m.sum[j] += rv[j]; m.n++; } }
  finishAverage() { for (const m of this.members) m.rmean = Float32Array.from(m.sum, (v) => v / Math.max(1, m.n)); }
  // learning, step 2: this view on the route (at training height h) becomes familiar
  learn(p, h = p.alt) {
    const s = this.track ? this.F.nearest(p).s : 0;
    for (const m of this.members) {
      const code = this.see(m, p), mem = m.memory[this.bankOf(h)], on = [];
      for (let j = 0; j < code.length; j++) if (code[j]) { mem[j] = 0; on.push(j); }
      if (this.track) m.snaps[this.bankOf(h)].push({ on: Int32Array.from(on), s, th: p.th });
      if (this.mapTrack && m === this.members[0]) this.routePts.push([p.x, p.y]);
      if (this.aversive) for (const turn of [-Math.PI / 2, Math.PI / 2]) { // the wrong ways from here
        const c2 = this.see(m, { ...p, th: p.th + turn }), w = m.wrong[this.bankOf(h)];
        for (let j = 0; j < c2.length; j++) if (c2[j]) w[j] *= 0.5;
      }
    }
  }
  // learning, step 3 (optional): this view on the way to the route goes into the approach memory
  learnApproach(p, h = p.alt) {
    this.hasApproach = true;
    for (const m of this.members) { const code = this.see(m, p), mem = m.approach[this.bankOf(h)]; for (let j = 0; j < code.length; j++) if (code[j]) mem[j] *= this.approachDecay; }
    if (this.mapTrack) this.mapSnaps.push({ on: this._northCode(p), ons: this.mapSwarm ? this.members.map((_, k) => this._northCode(p, k)) : null, x: p.x, y: p.y, bank: this.bankOf(h) });
  }
  // (mapTrack) the view straight below, turned north-up, as the list of firing Kenyon cells
  // (yawErr: the compass is off, so the picture is turned north-up by the wrong angle; mapSwarm: member k looks through its own gaze offset)
  _northCode(p, k = 0) {
    const m = this.members[k], code = this.see(k ? { gx: m.gx, gy: m.gy, rmean: m.rmean, scale: m.scale } : { gx: 0, gy: 0, rmean: m.rmean, scale: m.scale }, { ...p, th: p.yawErr || 0 }), on = [];
    for (let j = 0; j < code.length; j++) if (code[j]) on.push(j);
    return Int32Array.from(on);
  }
  // (mapTrack) a fresh belief over the whole map for one flight: step(q) -> { x, y, conf, want }
  _mapTracker() {
    const w = this.F.w, G = 16, nx = Math.ceil(w.W / G), ny = Math.ceil(w.H / G), n = nx * ny, kA = this.brain.kActive;
    const cells = Array.from({ length: this.banks ? this.alts.length : 1 }, () => Array.from({ length: n }, () => []));
    for (const sn of this.mapSnaps) { const cx = Math.min(nx - 1, Math.max(0, Math.floor(sn.x / G))), cy = Math.min(ny - 1, Math.max(0, Math.floor(sn.y / G))); cells[sn.bank][cy * nx + cx].push(sn); }
    let b = new Float64Array(n).fill(1 / n), last = null;
    return (q) => {
      const ox = q.ox ?? q.x, oy = q.oy ?? q.y; // where its own odometry says it is (q.ox/oy, if the odometer is imperfect)
      if (last) { // move the belief by the fly's own displacement, blur a little, never fully sure
        const dx = (ox - last.x) / G, dy = (oy - last.y) / G, ix = Math.floor(dx), iy = Math.floor(dy), fx = dx - ix, fy = dy - iy, nb = new Float64Array(n);
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
          const v = b[y * nx + x]; if (!v) continue;
          for (const [ox, oy, wt] of [[ix, iy, (1 - fx) * (1 - fy)], [ix + 1, iy, fx * (1 - fy)], [ix, iy + 1, (1 - fx) * fy], [ix + 1, iy + 1, fx * fy]]) {
            const X = x + ox, Y = y + oy; if (X >= 0 && Y >= 0 && X < nx && Y < ny) nb[Y * nx + X] += v * wt;
          }
        }
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
          let sum = 0, c = 0;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const X = x + ox, Y = y + oy; if (X >= 0 && Y >= 0 && X < nx && Y < ny) { const k = ox || oy ? 0.5 : 2; sum += nb[Y * nx + X] * k; c += k; } }
          b[y * nx + x] = sum / c + 0.001 / n;
        }
      }
      last = { x: ox, y: oy };
      const K = this.mapSwarm ? this.members.length : 1, norths = Array.from({ length: K }, (_, k) => { const a = new Uint8Array(this.brain.nKC); for (const j of this._northCode(q, k)) a[j] = 1; return a; });
      const here = cells[this.bankOf(q.alt)], match = new Float64Array(n);
      let mean = 0, cnt = 0;
      for (let c = 0; c < n; c++) {
        let best = 0;
        for (const sn of here[c]) { let o = 0; if (K === 1) { const on = sn.on; for (let j = 0; j < on.length; j++) o += norths[0][on[j]]; } else for (let k = 0; k < K; k++) { const on = sn.ons[k]; for (let j = 0; j < on.length; j++) o += norths[k][on[j]]; } if (o > best) best = o; }
        match[c] = best / (kA * K); if (here[c].length) { mean += match[c]; cnt++; }
      }
      mean /= Math.max(1, cnt);
      let tot = 0;
      for (let c = 0; c < n; c++) { if (here[c].length) b[c] *= Math.exp(this.mapSharp * (match[c] - mean)); tot += b[c]; }
      let bi = 0; for (let c = 0; c < n; c++) { b[c] /= tot; if (b[c] > b[bi]) bi = c; }
      const bx = (bi % nx + 0.5) * G, by = (Math.floor(bi / nx) + 0.5) * G;
      let conf = 0; for (let c = 0; c < n; c++) if (Math.hypot((c % nx + 0.5) * G - bx, (Math.floor(c / nx) + 0.5) * G - by) < 48) conf += b[c];
      // from there, toward the nearest known point of the route, a little further along it
      let rb = Infinity, ri = 0; this.routePts.forEach(([x, y], i) => { const d = (x - bx) ** 2 + (y - by) ** 2; if (d < rb) { rb = d; ri = i; } });
      const [tx, ty] = this.routePts[Math.min(this.routePts.length - 1, ri + 6)] || [bx, by];
      return { x: bx, y: by, conf, want: Math.atan2(ty - by, tx - bx) };
    };
  }
  // Learning flights: from spots on a grid over the whole map (every `spacing` maze cells, jittered),
  // fly toward the route and join it a little further along, so the fly arrives heading the right way.
  // A generator: yields every pose, so a page can show the flights and stay responsive.
  *approachFlights(world, { spacing = 1, h = 1, rng = Math.random, maxSteps = 60 } = {}) {
    const R = world.route, cell = world.cell, sp = spacing * cell, speed = cell / 8, maxTurn = (20 * Math.PI) / 180;
    for (let gy = sp / 2; gy < world.H; gy += sp) for (let gx = sp / 2; gx < world.W; gx += sp) {
      const q = { x: gx + (rng() - 0.5) * sp * 0.5, y: gy + (rng() - 0.5) * sp * 0.5, th: 0, alt: h };
      if (this.F.nearest(q, true).d < 0.5 * cell) continue;
      for (let t = 0; t < maxSteps; t++) {
        const nr = this.F.nearest(q, true), j = Math.min(R.x.length - 1, nr.i + Math.round(cell / 2)); // aim half a cell further along
        const want = Math.atan2(R.y[j] - q.y, R.x[j] - q.x);
        q.th = t === 0 ? want : wrap(q.th + Math.max(-maxTurn, Math.min(maxTurn, wrap(want - q.th))));
        this.learnApproach(q, h);
        yield { ...q };
        if (nr.d < 0.3 * cell) break;
        q.x += speed * Math.cos(q.th); q.y += speed * Math.sin(q.th);
      }
    }
  }
  // Calibration. "On the route" is judged by how new the best of nine directions looks; the level is a share of the firing cells (onRoute, 12% by default).
  // That level only suits a route memory of medium fullness: with a long route, or the route flown several times, the memory fills up and
  // everything looks below it (the fly believes it is on the route everywhere); with a short route nothing does. So after learning the fly measures
  // the best direction's newness on the route (a little off it, facing roughly along it) and far from it, and sets its level frac of the way from
  // the first to the second. Measured over six mazes: 54% -> 76-83% (three route passes); at 10 x 10: 38% -> 90%.
  calibrate(frac = 0.25, rng = Math.random, alt = this.alts[0]) {
    const w = this.F.w, R = w.route, n = R.x.length, per = this.brain.kActive * this.size, N = 30;
    const best9 = (q) => Math.min(...this.rate(q).route) / per;
    const tan = (i) => Math.atan2(R.y[Math.min(n - 1, i + 4)] - R.y[Math.max(0, i - 4)], R.x[Math.min(n - 1, i + 4)] - R.x[Math.max(0, i - 4)]);
    let on = 0, off = 0;
    for (let k = 0; k < N; k++) {
      const i = Math.floor(n * (0.05 + 0.9 * rng())), th0 = tan(i), o = (rng() * 2 - 1) * 0.35 * w.cell;
      on += best9({ x: R.x[i] - Math.sin(th0) * o, y: R.y[i] + Math.cos(th0) * o, th: wrap(th0 + (rng() * 2 - 1) * 0.6), alt });
      for (;;) { const q = { x: rng() * w.W, y: rng() * w.H, th: (rng() * 2 - 1) * Math.PI, alt }; if (this.F.nearest(q, true).d > 1.5 * w.cell) { off += best9(q); break; } }
    }
    this.onRoute = on / N + frac * (off / N - on / N);
    return { on: on / N, off: off / N, level: this.onRoute };
  }
  // how unfamiliar each of the 9 directions looks, summed over the swarm, to the route memory and
  // to the approach memory (both from the same views)
  rate(q) {
    const bank = this.bankOf(q.alt), route = new Float32Array(SCAN.length), approach = new Float32Array(SCAN.length), wrong = new Float32Array(SCAN.length);
    SCAN.forEach((d, i) => {
      let r = 0, a = 0, w = 0;
      for (const m of this.members) {
        const code = this.see(m, { ...q, th: q.th + d }), mem = m.memory[bank], am = m.approach[bank], wm = m.wrong[bank];
        for (let j = 0; j < code.length; j++) if (code[j]) { r += mem[j]; a += am[j]; w += wm[j]; }
      }
      route[i] = r; approach[i] = a; wrong[i] = w;
    });
    return { route, approach, wrong };
  }
  // share of the route memory's Kenyon cells (all members) that have become familiar
  familiarShare() {
    let f = 0, t = 0;
    for (const m of this.members) for (const mem of m.memory) { for (let j = 0; j < mem.length; j++) f += 1 - mem[j]; t += mem.length; }
    return f / t;
  }
  // (track) the route cut into 8-pixel bins, with the route's direction in each (from the stored patterns)
  _bins() {
    if (this._binCache) return this._binCache;
    const L = this.F.w.route.length, BIN = 8, n = Math.ceil(L / BIN) + 1, cx = new Float64Array(n), cy = new Float64Array(n);
    for (const m of this.members) for (const bank of m.snaps) for (const sn of bank) { const k = Math.min(n - 1, Math.floor(sn.s / BIN)); cx[k] += Math.cos(sn.th); cy[k] += Math.sin(sn.th); }
    const th = new Float32Array(n);
    let last = 0;
    for (let k = 0; k < n; k++) { if (cx[k] || cy[k]) last = Math.atan2(cy[k], cx[k]); th[k] = last; } // bins without a pattern keep the previous direction
    return (this._binCache = { n, BIN, th });
  }
  // (track) a fresh belief for one flight; returns step(q, code-for-each-member) -> { best, conf, want }
  _tracker() {
    const { n, BIN, th } = this._bins(), kA = this.brain.kActive;
    let b = new Float64Array(n).fill(1 / n), last = null;
    return (q, codes) => {
      const ox = q.ox ?? q.x, oy = q.oy ?? q.y;
      if (last) { // move the belief on by how far the fly flew along the route's direction in each bin
        const dist = Math.hypot(ox - last.x, oy - last.y), dir = Math.atan2(oy - last.y, ox - last.x), nb = new Float64Array(n);
        for (let k = 0; k < n; k++) {
          if (!b[k]) continue;
          const t = k + (dist * Math.cos(dir - th[k])) / BIN, k0 = Math.floor(t), f = t - k0;
          if (k0 >= 0 && k0 < n) nb[k0] += b[k] * (1 - f);
          if (k0 + 1 >= 0 && k0 + 1 < n) nb[k0 + 1] += b[k] * f;
        }
        b = nb;
        const blur = new Float64Array(n); // a little uncertainty, and never fully sure
        for (let k = 0; k < n; k++) blur[k] = 0.25 * (b[k - 1] || 0) + 0.5 * b[k] + 0.25 * (b[k + 1] || 0) + 0.002 / n;
        b = blur;
      }
      last = { x: ox, y: oy };
      // how well the view matches the stored patterns in each bin (best match, summed over the swarm)
      const bank = this.bankOf(q.alt), match = new Float64Array(n);
      this.members.forEach((m, mi) => {
        const code = codes[mi], best = new Float64Array(n);
        for (const sn of m.snaps[bank]) { let o = 0; const on = sn.on; for (let j = 0; j < on.length; j++) o += code[on[j]]; const k = Math.min(n - 1, Math.floor(sn.s / BIN)); if (o > best[k]) best[k] = o; }
        for (let k = 0; k < n; k++) match[k] += best[k] / kA;
      });
      let mean = 0; for (let k = 0; k < n; k++) mean += match[k] / n;
      let tot = 0;
      for (let k = 0; k < n; k++) { b[k] *= Math.exp((12 * (match[k] - mean)) / this.size); tot += b[k]; }
      let bi = 0;
      for (let k = 0; k < n; k++) { b[k] /= tot; if (b[k] > b[bi]) bi = k; }
      let conf = 0; for (let k = Math.max(0, bi - 3); k <= Math.min(n - 1, bi + 3); k++) conf += b[k]; // how much belief is near the best guess
      return { best: bi * BIN, conf, want: th[Math.min(n - 1, bi + 4)] }; // the route's direction half a cell ahead
    };
  }

  // a navigator for one flight: for each pose returns
  // { turn, ratings (of the memory in use), choice, mode: 'route' | 'approach', casting, where, onMap, arrived }
  // arrived (only with the `arrive` option, off by default): the fly believes it is at the end of the route -
  // by its route belief (route views recognised, belief near the last stored views, 5 steps in a row) or by
  // its map belief (sure, near where the route ends, 8 steps in a row). A real helicopter would stop or land
  // here. Measured: no gain in the simulation (the fly already gets within 0.8 cells of the goal), and a
  // few false stops (2% in clear weather).
  // climb: { cruise, top, rate } - height to cruise at, to climb to when unsure, change per step
  navigator({ cast = false, climb = null } = {}) {
    const per = this.brain.kActive * this.size, castLimit = this.castThr * per, onLimit = this.onRoute * per;
    const best = (r) => { let c = 0; for (let i = 1; i < r.length; i++) if (r[i] < r[c] || (r[i] === r[c] && Math.abs(SCAN[i]) < Math.abs(SCAN[c]))) c = i; return c; };
    let lastGood = null, castDir = 1, castLeft = 0, castLen = 4, tracker = null, out = 0, lastWhere = null, endVotes = 0;
    const W = this.F.w, LEN = W.route.length, CELL = W.cell, goal = [W.route.x[W.route.x.length - 1], W.route.y[W.route.y.length - 1]];
    const vote = (yes) => { endVotes = yes ? endVotes + 1 : 0; };
    const needVotes = (mapBased) => (mapBased ? 8 : 5); // steps in a row (8 steps = one maze cell)
    let endBy = 'route';
    const mapTracker = this.mapTrack && this.mapSnaps.length ? this._mapTracker() : null;
    const LOST_AFTER = 12; // steps (1.5 cells) out of sight before it gives up on where it thought it was
    // climbing when unsure, back down to cruising height when sure
    const height = (q, sure) => (climb ? Math.max(-climb.rate, Math.min(climb.rate, (sure ? climb.cruise : climb.top) - q.alt)) : 0);
    return (q) => {
      const { route, approach, wrong } = this.rate(q);
      // with a wrong-way memory, a direction that looks like "not this way" is penalised
      const avoid = (i) => (this.aversive ? this.aversiveGain * (1 - wrong[i] / per) : 0);
      let cr = best(this.aversive ? Float32Array.from(route, (v, i) => v / per + avoid(i)) : route), where = null;
      const inSight = !this.hasApproach || route[best(route)] <= onLimit; // judged by the route memory alone
      out = inSight ? 0 : out + 1;
      if (out > LOST_AFTER) { tracker = null; lastWhere = null; } // lost for a while: forget where on the route it thought it was
      // not in sight, and no confident idea of where the route is: head for it with the approach memory
      if (!inSight && !(tracker && lastWhere && lastWhere.conf > 0.5)) {
        let ca = best(approach), onMap = null;
        if (mapTracker) { // from where it thinks it is on the map, straight toward the route - as firmly as it is sure
          onMap = mapTracker(q);
          const score = (i) => approach[i] / per + this.mapGain * onMap.conf * (1 - Math.cos(wrap(q.th + SCAN[i] - onMap.want))) / 2;
          for (let i = 0; i < SCAN.length; i++) if (score(i) < score(ca)) ca = i;
        }
        endBy = 'map'; vote(!!onMap && onMap.conf > 0.8 && Math.hypot(onMap.x - goal[0], onMap.y - goal[1]) < 0.7 * CELL);
        const arrived = this.arrive && endVotes >= needVotes(true);
        return { turn: SCAN[ca], ratings: approach, choice: ca, mode: 'approach', casting: false, where, onMap, arrived, climb: height(q, false) };
      }
      if (this.track) {
        tracker ||= this._tracker(); // (re)found the route: start keeping track afresh
        // the view in the most familiar direction, for every member, to match against the stored patterns
        const codes = this.members.map((m) => Uint8Array.from(this.see(m, { ...q, th: q.th + SCAN[cr] })));
        where = lastWhere = tracker(q, codes);
        endBy = 'route'; vote(inSight && where.conf > 0.6 && where.best >= LEN - 0.5 * CELL);
        // prefer directions near the route's direction at the best guess, as much as the fly is sure of it
        const score = (i) => route[i] / per + avoid(i) + this.trackGain * where.conf * (1 - Math.cos(wrap(q.th + SCAN[i] - where.want))) / 2;
        let c = 0; for (let i = 1; i < SCAN.length; i++) if (score(i) < score(c)) c = i;
        cr = c;
      }
      const sure = inSight && (!where || where.conf > 0.4);
      if (!cast || route[cr] <= castLimit) { lastGood = q.th + SCAN[cr]; castLen = 4; castLeft = 0; return { turn: SCAN[cr], ratings: route, choice: cr, mode: 'route', casting: false, where, arrived: this.arrive && endVotes >= needVotes(false), climb: height(q, sure) }; }
      if (lastGood === null) lastGood = q.th;
      if (castLeft <= 0) { castDir = -castDir; castLeft = castLen; castLen += 3; }
      castLeft--;
      return { turn: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, wrap(lastGood + (castDir * Math.PI) / 2 - q.th))), ratings: route, choice: cr, mode: 'route', casting: true, where, climb: height(q, false) };
    };
  }
}
