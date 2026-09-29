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
// Every member has its own centre of gaze on a circle around the fly (gazeR view lengths), its own
// "average view" to centre its Kenyon cells on, and its own memories - one per height band when `banks`
// is on (the fly knows its height). All members share one wiring: one brain computes everyone's
// Kenyon cells in turn.

export const SCAN = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((d) => (d * Math.PI) / 180);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class FamiliarSwarm {
  // brain: a Brain with the memory centre on; flight: a RouteFlight to render views with
  // onRoute: the share of a view's firing cells that may be unfamiliar for the route to count as found
  constructor(brain, flight, { swarm = 1, gazeR = 0.25, alts = [1], banks = false, castThr = 0.1, onRoute = 0.12, approachDecay = 0.5 } = {}) {
    if (!brain.nKC) throw new Error('familiarity needs the memory centre');
    Object.assign(this, { brain, F: flight, alts, banks, castThr, onRoute, approachDecay, hasApproach: false });
    const K = Math.max(1, swarm), nb = banks ? alts.length : 1;
    this.members = Array.from({ length: K }, (_, k) => ({
      gx: K > 1 ? gazeR * Math.cos((2 * Math.PI * k) / K) : 0, gy: K > 1 ? gazeR * Math.sin((2 * Math.PI * k) / K) : 0,
      sum: new Float64Array(brain.rv.length), n: 0, rmean: null,
      memory: Array.from({ length: nb }, () => new Uint8Array(brain.nKC).fill(1)),
      approach: Array.from({ length: nb }, () => new Float32Array(brain.nKC).fill(1)),
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
    F.view({ ...p, gx: m.gx, gy: m.gy });
    if (m.rmean) b.rmean.set(m.rmean);
    b.step(F.retinas, F.touch, F.pain, F.pos, F.chroma);
    return b.kc;
  }
  // learning, step 1: collect every member's average view along the route
  addToAverage(p) { for (const m of this.members) { this.see(m, p); const rv = this.brain.rv; for (let j = 0; j < rv.length; j++) m.sum[j] += rv[j]; m.n++; } }
  finishAverage() { for (const m of this.members) m.rmean = Float32Array.from(m.sum, (v) => v / Math.max(1, m.n)); }
  // learning, step 2: this view on the route (at training height h) becomes familiar
  learn(p, h = p.alt) {
    for (const m of this.members) { const code = this.see(m, p), mem = m.memory[this.bankOf(h)]; for (let j = 0; j < code.length; j++) if (code[j]) mem[j] = 0; }
  }
  // learning, step 3 (optional): this view on the way to the route goes into the approach memory
  learnApproach(p, h = p.alt) {
    this.hasApproach = true;
    for (const m of this.members) { const code = this.see(m, p), mem = m.approach[this.bankOf(h)]; for (let j = 0; j < code.length; j++) if (code[j]) mem[j] *= this.approachDecay; }
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
  // how unfamiliar each of the 9 directions looks, summed over the swarm, to the route memory and
  // to the approach memory (both from the same views)
  rate(q) {
    const bank = this.bankOf(q.alt), route = new Float32Array(SCAN.length), approach = new Float32Array(SCAN.length);
    SCAN.forEach((d, i) => {
      let r = 0, a = 0;
      for (const m of this.members) {
        const code = this.see(m, { ...q, th: q.th + d }), mem = m.memory[bank], am = m.approach[bank];
        for (let j = 0; j < code.length; j++) if (code[j]) { r += mem[j]; a += am[j]; }
      }
      route[i] = r; approach[i] = a;
    });
    return { route, approach };
  }
  // share of the route memory's Kenyon cells (all members) that have become familiar
  familiarShare() {
    let f = 0, t = 0;
    for (const m of this.members) for (const mem of m.memory) { for (let j = 0; j < mem.length; j++) f += 1 - mem[j]; t += mem.length; }
    return f / t;
  }
  // a navigator for one flight: for each pose returns
  // { turn, ratings (of the memory in use), choice, mode: 'route' | 'approach', casting }
  navigator({ cast = false } = {}) {
    const per = this.brain.kActive * this.size, castLimit = this.castThr * per, onLimit = this.onRoute * per;
    const best = (r) => { let c = 0; for (let i = 1; i < r.length; i++) if (r[i] < r[c] || (r[i] === r[c] && Math.abs(SCAN[i]) < Math.abs(SCAN[c]))) c = i; return c; };
    let lastGood = null, castDir = 1, castLeft = 0, castLen = 4;
    return (q) => {
      const { route, approach } = this.rate(q), cr = best(route);
      if (this.hasApproach && route[cr] > onLimit) { // the route isn't in sight yet: head for it
        const ca = best(approach);
        return { turn: SCAN[ca], ratings: approach, choice: ca, mode: 'approach', casting: false };
      }
      if (!cast || route[cr] <= castLimit) { lastGood = q.th + SCAN[cr]; castLen = 4; castLeft = 0; return { turn: SCAN[cr], ratings: route, choice: cr, mode: 'route', casting: false }; }
      if (lastGood === null) lastGood = q.th;
      if (castLeft <= 0) { castDir = -castDir; castLeft = castLen; castLen += 3; }
      castLeft--;
      return { turn: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, wrap(lastGood + (castDir * Math.PI) / 2 - q.th))), ratings: route, choice: cr, mode: 'route', casting: true };
    };
  }
}
