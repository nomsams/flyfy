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
    aversive = false, aversiveGain = 0.5, layout = null, mapTrack = false, mapGain = 1, arrive = false, mapSwarm = false, mapSharp = 12, scales = null, regionCells = 0, corridor = 0, scout = 0, prior = null, cone = 0, field = false, seq = 0, coarse = 0, idf = false, anchors = 0, particles = 0, partDrift = 0.3, funnel = 0, endZone = 0 } = {}) {
    if (!brain.nKC) throw new Error('familiarity needs the memory centre');
    Object.assign(this, { brain, F: flight, alts, banks, castThr, onRoute, approachDecay, hasApproach: false, track, trackGain, aversive, aversiveGain, mapTrack, mapGain, arrive, mapSwarm, mapSharp, regionCells, corridor, scout, prior, cone, field, seq, coarse, idf, anchors, particles, partDrift, funnel, endZone });
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
    const s = this.track || this.regionCells ? this.F.nearest(p).s : 0;
    for (const m of this.members) {
      const code = this.see(m, p), mem = m.memory[this.bankOf(h)], on = [];
      // regionCells: the route is cut into stretches of that many maze cells and each stretch has its own memory (so a long route does not fill one memory up)
      const reg = this.regionCells ? ((m.regional ||= {})[Math.floor(s / (this.regionCells * this.F.w.cell))] ||= new Uint8Array(this.brain.nKC).fill(1)) : null;
      for (let j = 0; j < code.length; j++) if (code[j]) { mem[j] = 0; if (reg) reg[j] = 0; on.push(j); }
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
  // (mapTrack) the stored north-up views, indexed once: by 16-px cell, with the extras the localisers use
  // - idf: every Kenyon cell is weighted by how rare it is over the whole map (cells that fire in many places say little: tf-idf, as in bag-of-words place recognition)
  // - anchors: a view that no place far away resembles is an "anchor", and counts more in the belief
  _mapIndex() {
    const n0 = this.mapSnaps.length;
    if (this._mi && this._mi.n0 === n0) return this._mi;
    const w = this.F.w, G = 16, nx = Math.ceil(w.W / G), ny = Math.ceil(w.H / G), n = nx * ny, nB = this.banks ? this.alts.length : 1, nKC = this.brain.nKC;
    const snaps = this.mapSnaps;
    snaps.forEach((s, id) => { s.id = id; s.g = 1; s.cx = Math.min(nx - 1, Math.max(0, Math.floor(s.x / G))); s.cy = Math.min(ny - 1, Math.max(0, Math.floor(s.y / G))); s.sb = Math.floor(s.x / (4 * G)) + 1000 * Math.floor(s.y / (4 * G)); });
    const cells = Array.from({ length: nB }, () => Array.from({ length: n }, () => [])), bankSnaps = Array.from({ length: nB }, () => []);
    for (const s of snaps) { cells[s.bank][s.cy * nx + s.cx].push(s); bankSnaps[s.bank].push(s); }
    const wt = new Float32Array(nKC).fill(1);
    if (this.idf) {
      const df = new Float32Array(nKC); let tot = 0, sum = 0;
      for (const s of snaps) for (const j of s.on) { df[j]++; tot++; }
      for (let j = 0; j < nKC; j++) wt[j] = Math.log((snaps.length + 1) / (df[j] + 1)) + 0.05;
      for (const s of snaps) for (const j of s.on) sum += wt[j];
      const k = tot / Math.max(1e-9, sum); for (let j = 0; j < nKC; j++) wt[j] *= k; // mean weight of a stored cell: 1
    }
    if (this.anchors) { // how far is each view from its best look-alike elsewhere (at least 3 cells away)? against a sample of 300 other views
      const ref = []; for (let i = 0; i < 300 && snaps.length; i++) ref.push(snaps[Math.floor(((i + 0.5) * snaps.length) / 300)]);
      const mark = new Uint8Array(nKC), d = new Float32Array(snaps.length), far = 3 * w.cell;
      for (const s of snaps) {
        for (const j of s.on) mark[j] = 1;
        let best = 0;
        for (const t of ref) { if (t.bank !== s.bank || Math.hypot(t.x - s.x, t.y - s.y) < far) continue; let o = 0; for (const j of t.on) o += mark[j]; if (o > best) best = o; }
        for (const j of s.on) mark[j] = 0;
        d[s.id] = 1 - best / Math.max(1, s.on.length);
      }
      let mean = 0; for (const v of d) mean += v; mean /= d.length;
      let sd = 0; for (const v of d) sd += (v - mean) ** 2; sd = Math.sqrt(sd / d.length) || 1;
      for (const s of snaps) s.g = 1 + this.anchors * Math.max(0, Math.min(3, (d[s.id] - mean) / sd));
    }
    return (this._mi = { n0, G, nx, ny, n, cells, bankSnaps, wt, N: snaps.length });
  }
  // the overlap of the current north-up view with a stored one (weighted by wt), as a function of the stored view
  _overlapper(q, mi) {
    const K = this.mapSwarm ? this.members.length : 1, wt = mi.wt;
    const norths = Array.from({ length: K }, (_, k) => { const a = new Float32Array(this.brain.nKC); for (const j of this._northCode(q, k)) a[j] = wt[j]; return a; }), kA = this.brain.kActive * K;
    return (sn) => { let o = 0; if (K === 1) { const on = sn.on, a = norths[0]; for (let j = 0; j < on.length; j++) o += a[on[j]]; } else for (let k = 0; k < K; k++) { const on = sn.ons[k], a = norths[k]; for (let j = 0; j < on.length; j++) o += a[on[j]]; } return o / kA; };
  }
  _mapAnswer(bx, by, conf) { // from the best guess, toward the nearest known point of the route, a little further along it
    let rb = Infinity, ri = 0; this.routePts.forEach(([x, y], i) => { const d = (x - bx) ** 2 + (y - by) ** 2; if (d < rb) { rb = d; ri = i; } });
    const [tx, ty] = this.routePts[Math.min(this.routePts.length - 1, ri + 6)] || [bx, by];
    return { x: bx, y: by, conf, want: Math.atan2(ty - by, tx - bx) };
  }
  // (mapTrack) a fresh belief over the whole map for one flight: step(q) -> { x, y, conf, want }
  // Options (all off by default): prior {x, y, r} (it knows it was launched within r of (x, y)) with cone k (the belief may not stray further than r + k x (distance flown)
  // from where its odometry says it is), field (a snapshot's match is spread over the nearby cells instead of only its own),
  // seq n (the match is averaged over the last n looks, shifted by the odometry), coarse m (only the m most likely 64-px blocks are matched), idf, anchors.
  _mapTracker() {
    const mi = this._mapIndex(), { G, nx, ny, n, cells, bankSnaps } = mi, w = this.F.w, sharp = this.mapSharp, prior = this.prior;
    const field = this.field || this.seq, cone = this.cone, seqN = this.seq, coarse = this.coarse;
    const disk = (c, cx, cy, r) => Math.hypot((c % nx + 0.5) * G - cx, (Math.floor(c / nx) + 0.5) * G - cy) <= r;
    let b = new Float64Array(n).fill(1 / n), last = null, o0 = null, path = 0, calls = 0; const hist = [];
    if (prior) { let s = 0; for (let c = 0; c < n; c++) { b[c] = disk(c, prior.x, prior.y, prior.r) ? 1 : 0.0005; s += b[c]; } for (let c = 0; c < n; c++) b[c] /= s; }
    return (q) => {
      const ox = q.ox ?? q.x, oy = q.oy ?? q.y; // where its own odometry says it is (q.ox/oy, if the odometer is imperfect)
      o0 ||= { x: ox, y: oy };
      if (last) { // move the belief by the fly's own displacement, blur a little, never fully sure
        path += Math.hypot(ox - last.x, oy - last.y);
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
      if (prior && cone) { // the cone: it cannot be further from where its odometry says than it could have drifted
        const r = prior.r + cone * path, cx = prior.x + ox - o0.x, cy = prior.y + oy - o0.y;
        for (let c = 0; c < n; c++) if (!disk(c, cx, cy, r)) b[c] *= 0.001;
      }
      const bank = this.bankOf(q.alt), ov = this._overlapper(q, mi), snaps = bankSnaps[bank], ovs = new Float32Array(mi.N).fill(-1);
      let active = null;
      if (coarse) { // coarse to fine: match only the most likely 64-px blocks
        const mass = new Map(); for (let c = 0; c < n; c++) { const k = Math.floor((c % nx) / 4) + 1000 * Math.floor(Math.floor(c / nx) / 4); mass.set(k, (mass.get(k) || 0) + b[c]); }
        active = new Set([...mass.entries()].sort((a, b2) => b2[1] - a[1]).slice(0, coarse).map((e) => e[0]));
      }
      let sum = 0, cnt = 0;
      for (const s of snaps) { if (active && !active.has(s.sb)) continue; const o = ovs[s.id] = ov(s); sum += o; cnt++; }
      this.matchEvals = (this.matchEvals || 0) + cnt;
      let mean = sum / Math.max(1, cnt); const match = new Float64Array(n).fill(mean), sh = new Float64Array(n).fill(sharp), known = new Uint8Array(n);
      if (!field) {
        for (const s of snaps) { const o = ovs[s.id]; if (o < 0) continue; const c = s.cy * nx + s.cx; if (!known[c] || o > match[c]) { match[c] = o; sh[c] = sharp * s.g; known[c] = 1; } }
        let s2 = 0, c2 = 0; for (let c = 0; c < n; c++) if (known[c]) { s2 += match[c]; c2++; } if (c2) mean = s2 / c2; // (as before: the mean over the cells that hold a view)
      } else { // paint every snapshot's match onto the cells within 32 px
        const best = new Float64Array(n).fill(-1);
        for (const s of snaps) {
          const o = ovs[s.id]; if (o < 0) continue;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (dx * dx + dy * dy > 5) continue; const X = s.cx + dx, Y = s.cy + dy; if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
            const c = Y * nx + X; if (o > best[c]) { best[c] = o; sh[c] = sharp * s.g; }
          }
        }
        for (let c = 0; c < n; c++) if (best[c] >= 0) { match[c] = best[c]; known[c] = 1; }
        if (seqN) { // sequence matching: average this look with the last few, each read where the fly would have been then if it is in this cell now
          const cur = Float64Array.from(match), acc = Float64Array.from(match); let m = 1;
          for (const h of hist) {
            const sx = ox - h.ox, sy = oy - h.oy; m++;
            for (let c = 0; c < n; c++) { const X = Math.floor(((c % nx + 0.5) * G - sx) / G), Y = Math.floor(((Math.floor(c / nx) + 0.5) * G - sy) / G); acc[c] += X >= 0 && Y >= 0 && X < nx && Y < ny ? h.f[Y * nx + X] : h.mean; }
          }
          if (calls++ % 2 === 0) { hist.push({ f: cur, ox, oy, mean }); if (hist.length > seqN) hist.shift(); }
          for (let c = 0; c < n; c++) match[c] = acc[c] / m;
        }
      }
      let tot = 0;
      for (let c = 0; c < n; c++) { if (known[c] || seqN) b[c] *= Math.exp(sh[c] * (match[c] - mean)); tot += b[c]; }
      let bi = 0; for (let c = 0; c < n; c++) { b[c] /= tot; if (b[c] > b[bi]) bi = c; }
      const bx = (bi % nx + 0.5) * G, by = (Math.floor(bi / nx) + 0.5) * G;
      let conf = 0; for (let c = 0; c < n; c++) if (Math.hypot((c % nx + 0.5) * G - bx, (Math.floor(c / nx) + 0.5) * G - by) < 48) conf += b[c];
      return this._mapAnswer(bx, by, conf);
    };
  }
  // (mapTrack, particles) the same belief as a cloud of guesses: each is moved by the fly's own motion plus a spread that grows with the distance flown (drift),
  // re-weighted by how well the view matches the stored views near it, and re-sampled when only a few carry the weight (Monte Carlo localisation)
  _particleTracker() {
    const mi = this._mapIndex(), { G, nx, ny, cells } = mi, w = this.F.w, N = this.particles, sharp = this.mapSharp, prior = this.prior, cone = this.cone;
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }, gs = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) * 1.4142; };
    const px = new Float64Array(N), py = new Float64Array(N); let pw = new Float64Array(N).fill(1 / N), last = null, o0 = null, path = 0;
    for (let i = 0; i < N; i++) {
      if (prior) { const a = rnd() * 2 * Math.PI, r = prior.r * Math.sqrt(rnd()); px[i] = prior.x + r * Math.cos(a); py[i] = prior.y + r * Math.sin(a); } else { px[i] = rnd() * w.W; py[i] = rnd() * w.H; }
    }
    return (q) => {
      const ox = q.ox ?? q.x, oy = q.oy ?? q.y; o0 ||= { x: ox, y: oy };
      if (last) {
        const dx = ox - last.x, dy = oy - last.y, d = Math.hypot(dx, dy), sd = 1 + this.partDrift * d; path += d;
        for (let i = 0; i < N; i++) { px[i] = Math.min(w.W - 1, Math.max(0, px[i] + dx + sd * gs())); py[i] = Math.min(w.H - 1, Math.max(0, py[i] + dy + sd * gs())); }
      }
      last = { x: ox, y: oy };
      if (prior && cone) { const r = prior.r + cone * path, cx = prior.x + ox - o0.x, cy = prior.y + oy - o0.y; for (let i = 0; i < N; i++) if (Math.hypot(px[i] - cx, py[i] - cy) > r) pw[i] *= 0.001; }
      const bank = this.bankOf(q.alt), ov = this._overlapper(q, mi), cache = new Map(), at = (s) => { let o = cache.get(s.id); if (o === undefined) { o = ov(s); cache.set(s.id, o); } return o; };
      const m = new Float64Array(N).fill(NaN), g = new Float64Array(N).fill(1);
      for (let i = 0; i < N; i++) {
        const cx = Math.floor(px[i] / G), cy = Math.floor(py[i] / G); let best = -1;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue; const X = cx + dx, Y = cy + dy; if (X < 0 || Y < 0 || X >= nx || Y >= ny) continue;
          for (const s of cells[bank][Y * nx + X]) { const o = at(s); if (o > best) { best = o; g[i] = s.g; } }
        }
        if (best >= 0) m[i] = best;
      }
      this.matchEvals = (this.matchEvals || 0) + cache.size;
      let sum = 0; for (const o of cache.values()) sum += o; const mean = cache.size ? sum / cache.size : 0;
      let tot = 0; for (let i = 0; i < N; i++) { if (!Number.isNaN(m[i])) pw[i] *= Math.exp(sharp * g[i] * (m[i] - mean)); tot += pw[i]; }
      let ess = 0; for (let i = 0; i < N; i++) { pw[i] /= tot; ess += pw[i] * pw[i]; } ess = 1 / ess;
      // the best guess: the 32-px block with the most weight (and its neighbours), then the centre of the particles near it
      const blocks = new Map(); for (let i = 0; i < N; i++) { const k = Math.floor(px[i] / 32) + 1000 * Math.floor(py[i] / 32); blocks.set(k, (blocks.get(k) || 0) + pw[i]); }
      let bk = 0, bm = -1; for (const [k, v] of blocks) { let s = v; for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) s += blocks.get(k + a + 1000 * b2) || 0; if (s > bm) { bm = s; bk = k; } }
      let bx = (bk % 1000 + 0.5) * 32, by = (Math.floor(bk / 1000) + 0.5) * 32, sx = 0, sy = 0, sw = 0;
      for (let i = 0; i < N; i++) if (Math.hypot(px[i] - bx, py[i] - by) < 64) { sx += px[i] * pw[i]; sy += py[i] * pw[i]; sw += pw[i]; }
      if (sw > 0) { bx = sx / sw; by = sy / sw; }
      let conf = 0; for (let i = 0; i < N; i++) if (Math.hypot(px[i] - bx, py[i] - by) < 48) conf += pw[i];
      if (ess < N / 2) { // resample (systematic) and jitter a little
        const nx2 = new Float64Array(N), ny2 = new Float64Array(N); let c = pw[0], j = 0; const u0 = rnd() / N;
        for (let i = 0; i < N; i++) { const u = u0 + i / N; while (u > c && j < N - 1) { j++; c += pw[j]; } nx2[i] = px[j] + 3 * gs(); ny2[i] = py[j] + 3 * gs(); }
        px.set(nx2); py.set(ny2); pw = new Float64Array(N).fill(1 / N);
      }
      return this._mapAnswer(bx, by, conf);
    };
  }
  // Learning flights: from spots on a grid over the whole map (every `spacing` maze cells, jittered),
  // fly toward the route and join it a little further along, so the fly arrives heading the right way.
  // A generator: yields every pose, so a page can show the flights and stay responsive.
  *approachFlights(world, { spacing = 1, h = 1, rng = Math.random, maxSteps = 60 } = {}) {
    const R = world.route, cell = world.cell, sp = spacing * cell, speed = cell / 8, maxTurn = (20 * Math.PI) / 180;
    for (let gy = sp / 2; gy < world.H; gy += sp) for (let gx = sp / 2; gx < world.W; gx += sp) {
      const q = { x: gx + (rng() - 0.5) * sp * 0.5, y: gy + (rng() - 0.5) * sp * 0.5, th: 0, alt: h };
      const nr0 = this.F.nearest(q, true), dRoute = nr0.d;
      if (dRoute < 0.5 * cell) continue;
      // a band around the route: `corridor` cells wide, widening by `funnel` cells per cell flown (the cone of drift), plus a zone of `endZone` cells around the goal
      if ((this.corridor || this.funnel) && dRoute > (this.corridor + this.funnel * (nr0.s / cell)) * cell && !(this.endZone && Math.hypot(q.x - R.x[R.x.length - 1], q.y - R.y[R.y.length - 1]) < this.endZone * cell)) continue; // corridor: practise only within this many maze cells of the route (fewer views, a less crowded memory)
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
      const regOf = (s) => (this.regionCells ? Math.floor(s / (this.regionCells * w.cell)) : null);
      on += best9({ x: R.x[i] - Math.sin(th0) * o, y: R.y[i] + Math.cos(th0) * o, th: wrap(th0 + (rng() * 2 - 1) * 0.6), alt, region: regOf(R.s[i]) });
      for (;;) { const q = { x: rng() * w.W, y: rng() * w.H, th: (rng() * 2 - 1) * Math.PI, alt, region: regOf(R.s[Math.floor(rng() * n)]) }; if (this.F.nearest(q, true).d > 1.5 * w.cell) { off += best9(q); break; } }
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
        const regs = this.regionCells && q.region != null && m.regional ? [q.region - 1, q.region, q.region + 1].map((k) => m.regional[k]).filter(Boolean) : null;
        if (regs && regs.length) { for (let j = 0; j < code.length; j++) if (code[j]) { let v = 1; for (const g of regs) if (g[j] < v) v = g[j]; r += v; a += am[j]; w += wm[j]; } }
        else for (let j = 0; j < code.length; j++) if (code[j]) { r += mem[j]; a += am[j]; w += wm[j]; }
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
    const mapTracker = this.mapTrack && this.mapSnaps.length ? (this.particles ? this._particleTracker() : this._mapTracker()) : null, always = !!(mapTracker && this.prior); // (prior: the map belief runs all the time, from the launch)
    let onMapNow = null;
    let unsure = 0, curRegion = null; const regPx = this.regionCells * this.F.w.cell;
    const LOST_AFTER = 12; // steps (1.5 cells) out of sight before it gives up on where it thought it was
    // climbing when unsure, back down to cruising height when sure
    const height = (q, sure) => (climb ? Math.max(-climb.rate, Math.min(climb.rate, (sure ? climb.cruise : climb.top) - q.alt)) : 0);
    return (q) => {
      q.region = this.regionCells && curRegion != null ? curRegion : null;
      onMapNow = always ? mapTracker(q) : null;
      const { route, approach, wrong } = this.rate(q);
      // with a wrong-way memory, a direction that looks like "not this way" is penalised
      const avoid = (i) => (this.aversive ? this.aversiveGain * (1 - wrong[i] / per) : 0);
      let cr = best(this.aversive ? Float32Array.from(route, (v, i) => v / per + avoid(i)) : route), where = null;
      const inSight = !this.hasApproach || route[best(route)] <= onLimit; // judged by the route memory alone
      out = inSight ? 0 : out + 1;
      if (out > LOST_AFTER) { tracker = null; lastWhere = null; curRegion = null; } // lost for a while: forget where on the route it thought it was
      // not in sight, and no confident idea of where the route is: head for it with the approach memory
      if (!inSight && !(tracker && lastWhere && lastWhere.conf > 0.5)) {
        let ca = best(approach), onMap = null;
        if (mapTracker) { // from where it thinks it is on the map, straight toward the route - as firmly as it is sure
          onMap = onMapNow || mapTracker(q);
          if (this.regionCells && onMap.conf > 0.5) curRegion = Math.floor(this.F.nearest({ x: onMap.x, y: onMap.y }, true).s / regPx);
          const score = (i) => approach[i] / per + this.mapGain * onMap.conf * (1 - Math.cos(wrap(q.th + SCAN[i] - onMap.want))) / 2;
          for (let i = 0; i < SCAN.length; i++) if (score(i) < score(ca)) ca = i;
        }
        unsure = this.scout && (!onMap || onMap.conf < 0.3) ? unsure + 1 : 0;
        if (this.scout && unsure > this.scout) ca = SCAN.indexOf(0); // scout: unsure for `scout` steps in a row: fly straight on
        endBy = 'map'; vote(!!onMap && onMap.conf > 0.8 && Math.hypot(onMap.x - goal[0], onMap.y - goal[1]) < 0.7 * CELL);
        const arrived = this.arrive && endVotes >= needVotes(true);
        return { turn: SCAN[ca], ratings: approach, choice: ca, mode: 'approach', casting: false, where, onMap, arrived, climb: height(q, false) };
      }
      if (this.track) {
        tracker ||= this._tracker(); // (re)found the route: start keeping track afresh
        // the view in the most familiar direction, for every member, to match against the stored patterns
        const codes = this.members.map((m) => Uint8Array.from(this.see(m, { ...q, th: q.th + SCAN[cr] })));
        where = lastWhere = tracker(q, codes);
        if (this.regionCells && where.conf > 0.4) curRegion = Math.floor(where.best / regPx);
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
