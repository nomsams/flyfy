// Route following by familiarity, the way ants and bees are thought to do it, for one fly or a swarm.
//
// Learning: while the route is flown (with a teacher), every view silences the Kenyon cells it uses
// on a "novelty" output, as dopamine does in the mushroom body. Nothing about the route itself is
// stored, only what the world looked like while on it: one bit per Kenyon cell.
// Navigating: each swarm member looks in 9 directions and counts how many of its firing cells are
// still unfamiliar; the swarm adds the counts up and flies the most familiar way. When nothing looks
// familiar (the scent is lost), it casts like a moth: sweeps across its last good heading, wider each time.
//
// Every member has its own centre of gaze on a circle around the fly (gazeR view lengths), its own
// "average view" to centre its Kenyon cells on, and its own memory - one per height band when `banks`
// is on (the fly knows its height). All members share one wiring: one brain computes everyone's
// Kenyon cells in turn.

export const SCAN = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((d) => (d * Math.PI) / 180);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class FamiliarSwarm {
  // brain: a Brain with the memory centre on; flight: a RouteFlight to render views with
  constructor(brain, flight, { swarm = 1, gazeR = 0.25, alts = [1], banks = false, castThr = 0.3 } = {}) {
    if (!brain.nKC) throw new Error('familiarity needs the memory centre');
    this.brain = brain; this.F = flight; this.alts = alts; this.banks = banks; this.castThr = castThr;
    const K = Math.max(1, swarm);
    this.members = Array.from({ length: K }, (_, k) => ({
      gx: K > 1 ? gazeR * Math.cos((2 * Math.PI * k) / K) : 0, gy: K > 1 ? gazeR * Math.sin((2 * Math.PI * k) / K) : 0,
      sum: new Float64Array(brain.rv.length), n: 0, rmean: null,
      memory: Array.from({ length: banks ? alts.length : 1 }, () => new Uint8Array(brain.nKC).fill(1)),
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
  // step 1 of learning: collect every member's average view along the route
  addToAverage(p) { for (const m of this.members) { this.see(m, p); const rv = this.brain.rv; for (let j = 0; j < rv.length; j++) m.sum[j] += rv[j]; m.n++; } }
  finishAverage() { for (const m of this.members) m.rmean = Float32Array.from(m.sum, (v) => v / Math.max(1, m.n)); }
  // step 2: this view (at training height h) becomes familiar
  learn(p, h = p.alt) {
    for (const m of this.members) { const code = this.see(m, p), mem = m.memory[this.bankOf(h)]; for (let j = 0; j < code.length; j++) if (code[j]) mem[j] = 0; }
  }
  // how many firing cells are still unfamiliar, summed over the swarm, for each of the 9 directions
  rate(q) {
    const bank = this.bankOf(q.alt), out = new Float32Array(SCAN.length);
    SCAN.forEach((d, i) => {
      let tot = 0;
      for (const m of this.members) { const code = this.see(m, { ...q, th: q.th + d }), mem = m.memory[bank]; for (let j = 0; j < code.length; j++) tot += code[j] * mem[j]; }
      out[i] = tot;
    });
    return out;
  }
  // share of all Kenyon cells (all members) that have become familiar
  familiarShare() {
    let f = 0, t = 0;
    for (const m of this.members) for (const mem of m.memory) { for (let j = 0; j < mem.length; j++) f += 1 - mem[j]; t += mem.length; }
    return f / t;
  }
  // a navigator for one flight: returns { turn, ratings, choice, casting } for each pose
  navigator({ cast = false } = {}) {
    const limit = this.castThr * this.brain.kActive * this.size;
    let lastGood = null, castDir = 1, castLeft = 0, castLen = 4;
    return (q) => {
      const ratings = this.rate(q);
      let choice = 0;
      for (let i = 1; i < ratings.length; i++) if (ratings[i] < ratings[choice] || (ratings[i] === ratings[choice] && Math.abs(SCAN[i]) < Math.abs(SCAN[choice]))) choice = i;
      if (!cast || ratings[choice] <= limit) { lastGood = q.th + SCAN[choice]; castLen = 4; castLeft = 0; return { turn: SCAN[choice], ratings, choice, casting: false }; }
      if (lastGood === null) lastGood = q.th;
      if (castLeft <= 0) { castDir = -castDir; castLeft = castLen; castLen += 3; }
      castLeft--;
      return { turn: Math.max(-Math.PI / 4, Math.min(Math.PI / 4, wrap(lastGood + (castDir * Math.PI) / 2 - q.th))), ratings, choice, casting: true };
    };
  }
}
