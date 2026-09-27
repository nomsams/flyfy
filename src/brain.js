// The brain: a small FIXED visual front-end of LC-type units feeding a
// sparse recurrent core that TRAINING adjusts, ending in two foot neurons.
//
// The LC layer is abstracted, not a copy of the real connectome:
//   LPLC2  looming (radial expansion) detector: needs outward motion in all
//          four quadrants of its receptive field at once (both polarities).
//   LC4    dark-looming detector: OFF-pathway outward motion, more tolerant.
//   LC11   small dark object: surround brighter than a small centre.
//   LC_ON  small bright object: centre brighter than its surround.
//   LUM    coarse local luminance.
// LPLC2/LC4 are motion detectors, so with a fixed eye they fire on stimulus
// ONSET (the new image expanding into view) and stay silent on a static
// image. The static types carry the image content. Keeping this layer fixed
// means only the core + readout are trained: ~3k parameters, ~250 neurons.

import { mulberry32, gauss } from './rng.js';

export const LC_TYPES = [
  { name: 'LPLC2', group: 'loom', gain: 800 }, // x(1 + 2 * lens blur): calibrated so onset responses match with or without the lens
  { name: 'LC4', group: 'loom', gain: 1500 },
  { name: 'LC11', group: 'static', gain: 5 },
  { name: 'LC_ON', group: 'static', gain: 5 },
  { name: 'LUM', group: 'static', gain: 1 },
];
const LPF = 0.6; // delay filter of the elementary motion detectors

const sat = (x) => x / (1 + x);

function cellRects(R, C, nr, nc) {
  const out = [];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      out.push([Math.round((i * R) / nr), Math.round(((i + 1) * R) / nr),
        Math.round((j * C) / nc), Math.round(((j + 1) * C) / nc)]);
    }
  }
  return out;
}

export class LCLayer {
  // eye: { lcLoom: [rows, cols], lcStatic: [rows, cols] } -- how many cells
  // each LC type tiles the retina with.
  constructor(R, C, eye) {
    this.R = R; this.C = C;
    const n = R * C;
    for (const k of ['on', 'off', 'lpfOn', 'lpfOff', 'hOn', 'hOff', 'vOn', 'vOff']) this[k] = new Float32Array(n);
    this.types = [];
    let start = 0;
    for (const t of LC_TYPES) {
      const grid = t.group === 'loom' ? eye.lcLoom : eye.lcStatic;
      const rects = cellRects(R, C, grid[0], grid[1]);
      this.types.push({ ...t, grid, start, count: rects.length, rects });
      start += rects.length;
    }
    this.n = start;
    this.out = new Float32Array(this.n);
    this.q = new Float32Array(4);
    // a blurred (lens) image moves less sharply, so the looming detector needs more gain to match
    this.loomBoost = 1 + 2 * (eye.acceptance || 0);
  }

  reset() {
    this.lpfOn.fill(0); this.lpfOff.fill(0);
    this.out.fill(0);
  }

  _quadrants(r0, r1, c0, c1, useOn, useOff) {
    const { C, hOn, hOff, vOn, vOff, q } = this;
    const rc = (r0 + r1 - 1) / 2, cc = (c0 + c1 - 1) / 2;
    let sR = 0, nR = 0, sL = 0, nL = 0, sD = 0, nD = 0, sU = 0, nU = 0;
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * C + c;
        const h = (useOn ? hOn[i] : 0) + (useOff ? hOff[i] : 0);
        const v = (useOn ? vOn[i] : 0) + (useOff ? vOff[i] : 0);
        if (c > cc) { if (h > 0) sR += h; nR++; } else if (c < cc) { if (h < 0) sL -= h; nL++; }
        if (r > rc) { if (v > 0) sD += v; nD++; } else if (r < rc) { if (v < 0) sU -= v; nU++; }
      }
    }
    q[0] = sR / (nR || 1); q[1] = sL / (nL || 1); q[2] = sD / (nD || 1); q[3] = sU / (nU || 1);
  }

  _mean(L, r0, r1, c0, c1) {
    let s = 0;
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) s += L[r * this.C + c];
    return s / ((r1 - r0) * (c1 - c0));
  }

  step(L) {
    const { R, C, on, off, lpfOn, lpfOff, hOn, hOff, vOn, vOff } = this;
    const n = R * C;
    let G = 0;
    for (let i = 0; i < n; i++) G += L[i];
    G /= n;
    for (let i = 0; i < n; i++) { const d = L[i] - G; on[i] = d > 0 ? d : 0; off[i] = d < 0 ? -d : 0; }

    // Hassenstein-Reichardt correlators per polarity, horizontal + vertical.
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const i = r * C + c;
        if (c < C - 1) {
          hOn[i] = lpfOn[i] * on[i + 1] - lpfOn[i + 1] * on[i];
          hOff[i] = lpfOff[i] * off[i + 1] - lpfOff[i + 1] * off[i];
        } else { hOn[i] = 0; hOff[i] = 0; }
        if (r < R - 1) {
          vOn[i] = lpfOn[i] * on[i + C] - lpfOn[i + C] * on[i];
          vOff[i] = lpfOff[i] * off[i + C] - lpfOff[i + C] * off[i];
        } else { vOn[i] = 0; vOff[i] = 0; }
      }
    }
    for (let i = 0; i < n; i++) {
      lpfOn[i] = LPF * lpfOn[i] + (1 - LPF) * on[i];
      lpfOff[i] = LPF * lpfOff[i] + (1 - LPF) * off[i];
    }

    const out = this.out, q = this.q;
    for (const t of this.types) {
      for (let k = 0; k < t.count; k++) {
        const [r0, r1, c0, c1] = t.rects[k];
        let x = 0;
        if (t.name === 'LPLC2') {
          this._quadrants(r0, r1, c0, c1, true, true);
          x = Math.pow(q[0] * q[1] * q[2] * q[3], 0.25);
        } else if (t.name === 'LC4') {
          this._quadrants(r0, r1, c0, c1, false, true);
          x = (q[0] + q[1] + q[2] + q[3]) * 0.25;
        } else if (t.name === 'LUM') {
          x = this._mean(L, r0, r1, c0, c1);
        } else {
          // centre-surround over a block one receptor larger on every side
          const R0 = Math.max(0, r0 - 1), R1 = Math.min(R, r1 + 1);
          const C0 = Math.max(0, c0 - 1), C1 = Math.min(C, c1 + 1);
          const nC = (r1 - r0) * (c1 - c0), nE = (R1 - R0) * (C1 - C0);
          const mC = this._mean(L, r0, r1, c0, c1);
          const mE = this._mean(L, R0, R1, C0, C1);
          const mS = nE > nC ? (mE * nE - mC * nC) / (nE - nC) : mC;
          x = t.name === 'LC11' ? Math.max(mS - mC, 0) : Math.max(mC - mS, 0);
        }
        out[t.start + k] = sat(t.gain * (t.name === 'LPLC2' ? this.loomBoost : 1) * x);
      }
    }
  }
}

// Bumped whenever what the evolved parameters *mean* changes, so an old saved brain is refused
// instead of being loaded into slots that now do something else.
export const BRAIN_VERSION = 6;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

export class Brain {
  constructor(cfg) {
    this.cfg = cfg;
    const b = cfg.brain;
    this.nEyes = cfg.eye.eyes;
    this.lc = [];
    for (let e = 0; e < this.nEyes; e++) this.lc.push(new LCLayer(cfg.eye.rows, cfg.eye.cols, cfg.eye));
    this.nLC = this.lc.reduce((s, l) => s + l.n, 0);
    this.nIn = this.nLC + 4; // + touch and pain (nociceptor) feedback from the two feet
    this.N = b.core;
    this.kIn = Math.min(b.kIn, this.nIn);
    this.kRec = Math.min(b.kRec, this.N);
    this.M = 2;   // feet
    this.Mg = 3;  // eye motor: pan dx, pan dy, step closer/back
    this.alphaCentre = b.alpha; // where each neuron's evolved *baseline* leak starts out

    // Sparse random wiring (distinct sources per neuron), drawn from a fixed seed. Evolution can
    // later move the weakest wires to new sources -- see topology.js -- so it is not frozen forever.
    const rng = mulberry32(b.netSeed);
    const pick = (count, k, range) => {
      const idx = new Int32Array(count * k);
      for (let i = 0; i < count; i++) {
        const used = new Set();
        for (let j = 0; j < k; j++) {
          let s;
          do { s = Math.floor(rng() * range); } while (used.has(s));
          used.add(s);
          idx[i * k + j] = s;
        }
      }
      return idx;
    };
    this.inIdx = pick(this.N, this.kIn, this.nIn);
    this.recIdx = pick(this.N, this.kRec, this.N);
    if (cfg.wiring) this.setWiring(cfg.wiring);

    // The static LC cells (the ones that carry image content) feed the fast, plastic pathway.
    this.staticIdx = [];
    this.lc.forEach((lc, e) => { for (const t of lc.types) if (t.group === 'static') for (let k = 0; k < t.count; k++) this.staticIdx.push(e * lc.n + t.start + k); });
    this.nS = this.staticIdx.length;
    this.xc = new Float32Array(this.nS);      // static features minus their adapted mean
    this.fmean = new Float32Array(this.nS);

    // Mushroom body (optional): a large layer of Kenyon cells, each wired to a few random static
    // features with fixed random weights, of which only the most active few percent fire (the
    // real ones are held that sparse by a single inhibitory neuron). Pain and reward then act on
    // the Kenyon-cell -> feet synapses instead of the direct eye -> feet ones. Sparse, spread-out
    // codes like this are how real flies tell apart things that look nearly alike.
    const mb = cfg.mb || {};
    this.mbOn = !!mb.enabled;
    if (this.mbOn) {
      const r2 = mulberry32((b.netSeed ^ 0x5bd1e995) >>> 0);
      this.nKC = mb.cells;
      // what the Kenyon cells read: the centred static eye-cell features, or (mb.retina) the centred
      // raw light sensors of every eye -- finer detail, the way real Kenyon cells get fairly direct
      // sensory input rather than a pre-digested summary
      this.kcRetina = !!mb.retina;
      this.nSrc = this.kcRetina ? this.nEyes * cfg.eye.rows * cfg.eye.cols : this.nS;
      if (this.kcRetina) { this.rv = new Float32Array(this.nSrc); this.rc = new Float32Array(this.nSrc); this.rmean = new Float32Array(this.nSrc); }
      this.kcFan = Math.min(mb.fanIn, this.nSrc);
      this.kcIdx = new Int32Array(this.nKC * this.kcFan);
      this.kcW = new Float32Array(this.nKC * this.kcFan);
      for (let k = 0; k < this.nKC; k++) {
        const used = new Set();
        for (let j = 0; j < this.kcFan; j++) {
          let s;
          do { s = Math.floor(r2() * this.nSrc); } while (used.has(s));
          used.add(s);
          this.kcIdx[k * this.kcFan + j] = s;
          this.kcW[k * this.kcFan + j] = r2() < 0.5 ? -1 : 1;
        }
      }
      this.kcAct = new Float32Array(this.nKC);
      this.kcSort = new Float32Array(this.nKC);
      this.kc = new Float32Array(this.nKC);
      this.kActive = Math.max(1, Math.round(mb.sparsity * this.nKC));
    } else this.nKC = 0;
    this.nP = this.mbOn ? this.nKC : this.nS; // inputs to the plastic (learn-by-pain) synapses
    this.pv = this.mbOn ? this.kc : this.xc;
    this.Wp = new Float32Array(this.M * this.nP);

    this.sizes = {
      win: this.N * this.kIn, wrec: this.N * this.kRec, b: this.N,
      wout: this.M * this.N, bout: this.M,
      // Each core neuron's own *baseline* leak rate; neuromodulation adjusts it live around this.
      alpha: this.N,
      // Active vision: a second readout of the core says where to look next (dx, dy).
      wgaze: this.Mg * this.N, bgaze: this.Mg,
      // Neuromodulation: one "dopamine" readout of the whole core, and each neuron's sensitivity
      // to it. leak = baseline + sensitivity * dopamine, every step.
      wmod: this.N, bmod: 1, sens: this.N,
      // Efference copy: every core neuron is told where the eye points (x, y) and how far away it is, so
      // it can relate what it sees to where it is looking -- real flies have this too.
      wpos: this.N * 3,
      // Evolvable learning rule for the fast pathway: [log speed, log reward weight, log pain
      // weight, forgetting] plus a log learning speed per static feature. Only used when
      // learn.evolveRule is on; always present so switching it on doesn't reshape the brain.
      rule: 4, etaVec: this.nS,
    };
    this.paramCount = Object.values(this.sizes).reduce((a, b2) => a + b2, 0);
    this.x = new Float32Array(this.nIn);
    this.h = new Float32Array(this.N);
    this.hn = new Float32Array(this.N);
    this.out = new Float32Array(this.M);
    this.z = new Float32Array(this.M);
    this.zp = new Float32Array(this.M);      // the learning synapses' share of z (their own prediction)
    this.gaze = new Float32Array(this.Mg);   // this step's motor command, tanh-bounded to [-1, 1]
    this.dopamine = 0.5;                     // this step's global modulator level
    this.fmeanInit = false;
    this.nAnswers = 0;
    this.inhibition = b.inhibition;
    this.zEma = new Float32Array(this.M); // "the loop trick" for the live fly: see decisionAlpha
    this.etaEff = new Float32Array(this.nS);
    this.setParams(new Float32Array(this.paramCount));
  }

  // + M feet, + Mg eye motor, +1 modulator, +4 touch/pain inputs, + Kenyon cells if any
  get neuronCount() { return this.nLC + this.N + this.M + this.Mg + 1 + 4 + this.nKC; }

  getWiring() { return { inIdx: Array.from(this.inIdx), recIdx: Array.from(this.recIdx) }; }
  setWiring(w) {
    if (!w || w.inIdx.length !== this.inIdx.length || w.recIdx.length !== this.recIdx.length) return false;
    this.inIdx.set(w.inIdx); this.recIdx.set(w.recIdx);
    return true;
  }

  initParams(seed = 1) {
    const rng = mulberry32(seed);
    const p = new Float32Array(this.paramCount);
    const g = this.cfg.brain.recGain;
    let o = 0;
    const fill = (n, std) => { for (let i = 0; i < n; i++) p[o + i] = gauss(rng) * std; o += n; };
    fill(this.sizes.win, 1 / Math.sqrt(this.kIn) * 1.5);
    fill(this.sizes.wrec, g / Math.sqrt(this.kRec));
    o += this.sizes.b; // biases start at 0
    fill(this.sizes.wout, 2 / Math.sqrt(this.N));
    // resting bias: a naive fly keeps its feet up (below the press threshold) until it has a reason to press
    for (let m = 0; m < this.M; m++) p[o + m] = -0.6;
    o += this.sizes.bout;
    // per-neuron baseline leak, centred on the config default but already spread out (as
    // logit(alpha)) so evolution has some neurons on each side of it to start differentiating from
    const centreLogit = Math.log(this.alphaCentre / (1 - this.alphaCentre));
    for (let i = 0; i < this.sizes.alpha; i++) p[o + i] = centreLogit + gauss(rng) * 1.0;
    o += this.sizes.alpha;
    // A new fly's eye holds still: its gaze readout starts at zero (the draws are still made so the
    // rest of the brain is unchanged). An untrained eye that wanders at random measurably hurt
    // learn-by-pain (-12 points on stripes); evolution grows these weights from zero when looking
    // around pays off.
    fill(this.sizes.wgaze, 0);
    o += this.sizes.bgaze;
    fill(this.sizes.wmod, 1 / Math.sqrt(this.N));
    o += this.sizes.bmod;  // dopamine starts neutral: sigmoid(0) = 0.5
    // sensitivity starts small, so a fresh brain's dynamic leak is close to its baseline
    fill(this.sizes.sens, 0.3);
    fill(this.sizes.wpos, 0.3);
    // learning rule starts exactly at the hand-set one: speed x1, reward x1, pain x1, ~no forgetting
    p[o] = 0; p[o + 1] = 0; p[o + 2] = 0; p[o + 3] = -6;
    o += this.sizes.rule;
    o += this.sizes.etaVec; // every feature starts at the same learning speed
    return p;
  }

  setParams(p) {
    this.params = p;
    let o = 0;
    const take = (n) => { const v = p.subarray(o, o + n); o += n; return v; };
    this.Win = take(this.sizes.win);
    this.Wrec = take(this.sizes.wrec);
    this.b = take(this.sizes.b);
    this.Wout = take(this.sizes.wout);
    this.bout = take(this.sizes.bout);
    const alphaRaw = take(this.sizes.alpha);
    if (!this.baseAlpha) this.baseAlpha = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this.baseAlpha[i] = sigmoid(alphaRaw[i]);
    this.Wgaze = take(this.sizes.wgaze);
    this.bgaze = take(this.sizes.bgaze);
    this.Wmod = take(this.sizes.wmod);
    this.bmod = take(this.sizes.bmod);
    this.sens = take(this.sizes.sens);
    this.Wpos = take(this.sizes.wpos);
    this.rule = take(this.sizes.rule);
    this.etaVec = take(this.sizes.etaVec);
    for (let j = 0; j < this.nS; j++) this.etaEff[j] = Math.exp(clamp(this.etaVec[j], -3, 3));
  }

  // The learning rule actually in force: hand-set, or (learn.evolveRule) the evolved one.
  ruleNow() {
    const L = this.cfg.learn, pn = this.cfg.pain;
    if (!L.evolveRule) return { eta: L.eta, reward: L.reward, pain: pn.strength, forget: 0, perFeature: false };
    const r = this.rule;
    return {
      eta: L.eta * Math.exp(clamp(r[0], -3, 3)),
      reward: L.reward * Math.exp(clamp(r[1], -3, 3)),
      pain: pn.strength * Math.exp(clamp(r[2], -3, 3)),
      forget: 0.05 * sigmoid(r[3]),
      perFeature: !this.mbOn,
    };
  }

  // keepPlastic: keep what the fly has learned (the fast synapses) across episodes.
  reset(keepPlastic = false) {
    this.h.fill(0); this.hn.fill(0); this.out.fill(0); this.x.fill(0); this.zEma.fill(0); this.gaze.fill(0); this.dopamine = 0.5;
    for (const l of this.lc) l.reset();
    if (!keepPlastic) { this.Wp.fill(0); this.nAnswers = 0; }
    this.fmeanInit = keepPlastic && this.nAnswers > 0; // keep the adapted mean when continuing a life
  }

  getPlastic() { return { Wp: Float32Array.from(this.Wp), fmean: Float32Array.from(this.fmean), rmean: this.rmean ? Float32Array.from(this.rmean) : null, n: this.nAnswers }; }
  setPlastic(p) {
    if (!p || p.Wp.length !== this.Wp.length || p.fmean.length !== this.fmean.length) { this.Wp.fill(0); this.nAnswers = 0; this.fmeanInit = false; return; }
    if (this.rmean && !(p.rmean && p.rmean.length === this.rmean.length)) { this.Wp.fill(0); this.nAnswers = 0; this.fmeanInit = false; return; }
    this.Wp.set(p.Wp); this.fmean.set(p.fmean); if (this.rmean) this.rmean.set(p.rmean); this.nAnswers = p.n; this.fmeanInit = p.n > 0;
  }

  _plasticUpdate(foot, sig, both) {
    const L = this.cfg.learn, R = this.ruleNow();
    const nP = this.nP, pv = this.pv, Wp = this.Wp, wmax = L.wmax;
    // experienced flies change their minds more slowly, which settles the weights on noisy tasks
    const d = R.eta / (1 + (L.anneal ? this.nAnswers / L.anneal : 0)) * sig;
    const a = foot * nP, b = (1 - foot) * nP, ef = R.perFeature ? this.etaEff : null;
    for (let j = 0; j < nP; j++) {
      const dj = ef ? d * ef[j] : d;
      Wp[a + j] = clamp(Wp[a + j] + dj * pv[j], -wmax, wmax);
      if (both) Wp[b + j] = clamp(Wp[b + j] - dj * pv[j], -wmax, wmax);
    }
    if (R.forget > 0) for (let j = 0; j < Wp.length; j++) Wp[j] *= 1 - R.forget;
  }

  // Pain from pressing when it should not (blank screen, or before looking): only the foot that
  // pressed is weakened, along the features that drove it.
  punish(foot) {
    if (!this.cfg.learn.eta) return;
    this._plasticUpdate(foot, -this.ruleNow().pain * this.cfg.pain.onPremature, false);
  }

  // Reinforcement from the answer just given: reward if correct, pain if wrong. With two choices a
  // wrong answer also says the other foot was right, so both feet's synapses move.
  learn(foot, correct) {
    if (!this.cfg.learn.eta) return;
    const R = this.ruleNow();
    let sig = correct ? R.reward : -R.pain;
    if (this.cfg.learn.surprise) {
      // Dopamine as reward prediction error: learn in proportion to how *unexpected* the outcome was.
      // The prediction is what the learning synapses themselves expected (how far they favoured this
      // foot) -- not the whole decision, which also carries the core's own, possibly untrained, signal.
      // A confident right answer teaches almost nothing, a confident mistake a lot.
      const zp = this.zp, conf = 1 / (1 + Math.exp(-(zp[foot] - zp[1 - foot])));
      sig *= 2 * (correct ? 1 - conf : conf);
    }
    this._plasticUpdate(foot, sig, true);
    // adapt the reference to what an answered image looks like (fast at first, then slow)
    const rate = Math.max(0.05, 1 / (1 + this.nAnswers++)), fm = this.fmean, sidx = this.staticIdx, x = this.x;
    for (let j = 0; j < this.nS; j++) fm[j] += rate * (x[sidx[j]] - fm[j]);
    if (this.kcRetina) { const rm = this.rmean, rv = this.rv; for (let j = 0; j < rm.length; j++) rm[j] += rate * (rv[j] - rm[j]); }
  }

  // Innate orienting and approach (eye.reflex): real flies turn toward and walk up to small,
  // striking objects without having to learn to. The small-object eye cells (LC11: dark spot,
  // LC_ON: bright spot) are compared across the eye; if one tile stands out from the rest, the eye
  // is turned toward it, and once it is near the centre of view the fly steps closer. Added on top
  // of whatever the learned eye motor wants, so evolution can refine or override it.
  _reflex() {
    const lc = this.lc[0], k = this.cfg.eye.reflex;
    const a = lc.types.find((t) => t.name === 'LC11'), b = lc.types.find((t) => t.name === 'LC_ON');
    const n = a.count, [nr, nc] = a.grid;
    let best = -1, bi = 0, mean = 0;
    for (let i = 0; i < n; i++) {
      const s = lc.out[a.start + i] + lc.out[b.start + i];
      mean += s / n;
      if (s > best) { best = s; bi = i; }
    }
    const stand = Math.max(0, Math.min(1, (best - mean - 0.03) * 10)); // how much it stands out, 0..1
    if (!stand) return;
    const dx = ((bi % nc) + 0.5) / nc * 2 - 1, dy = 1 - (Math.floor(bi / nc) + 0.5) / nr * 2; // where, -1..1 (up = +)
    const g = this.gaze;
    // turning toward something on the right (or up) takes a negative pan command in this world
    g[0] = clamp(g[0] - k * stand * dx, -1, 1);
    g[1] = clamp(g[1] - k * stand * dy, -1, 1);
    // step closer once it is roughly straight ahead
    const centred = Math.max(0, 1 - Math.hypot(dx, dy));
    g[2] = clamp(g[2] - k * stand * centred, -1, 1);
  }

  // Kenyon cells: fixed random mixing of the centred static features, then only the top few
  // percent fire (1), the rest stay silent (0).
  _mushroomBody() {
    const { nKC, kcFan, kcIdx, kcW, kcAct, kcSort, kc } = this;
    const src = this.kcRetina ? this.rc : this.xc;
    for (let k = 0; k < nKC; k++) {
      let s = 0;
      const o = k * kcFan;
      for (let j = 0; j < kcFan; j++) s += kcW[o + j] * src[kcIdx[o + j]];
      kcAct[k] = s;
    }
    kcSort.set(kcAct);
    kcSort.sort();
    const thr = kcSort[nKC - this.kActive];
    // strictly above the threshold fire first; ties at the threshold only fill the remaining places,
    // so exactly kActive cells (or fewer) ever fire
    let n = 0;
    for (let k = 0; k < nKC; k++) { kc[k] = kcAct[k] > thr && kcAct[k] > 1e-6 ? 1 : 0; n += kc[k]; }
    for (let k = 0; k < nKC && n < this.kActive; k++) if (!kc[k] && kcAct[k] === thr && kcAct[k] > 1e-6) { kc[k] = 1; n++; }
  }

  // retinas: array of Float32Array; touch, pain: Float32Array(2) (pain optional); pos: where the eye
  // points, each axis in [-1, 1] (optional, 0 when active vision is off). Returns this.out.
  step(retinas, touch, pain, pos) {
    const x = this.x;
    let o = 0;
    for (let e = 0; e < this.nEyes; e++) {
      const l = this.lc[e];
      l.step(retinas[e]);
      x.set(l.out, o);
      o += l.n;
    }
    x[o] = touch[0]; x[o + 1] = touch[1];
    const feel = this.cfg.pain.feel;
    x[o + 2] = pain ? pain[0] * feel : 0; x[o + 3] = pain ? pain[1] * feel : 0;
    const px = pos ? pos[0] : 0, py = pos ? pos[1] : 0, pz = pos ? pos[2] || 0 : 0;

    // centre the static LC features on the average image the fly has answered on (adaptation), so
    // both classes sit either side of zero; the mean is updated in learn(), at answer time
    const nS = this.nS, xc = this.xc, fm = this.fmean, sidx = this.staticIdx;
    if (this.kcRetina) { let q = 0; for (let e = 0; e < this.nEyes; e++) { this.rv.set(retinas[e], q); q += retinas[e].length; } }
    if (!this.fmeanInit) {
      for (let j = 0; j < nS; j++) fm[j] = x[sidx[j]];
      if (this.kcRetina) this.rmean.set(this.rv);
      this.fmeanInit = true;
    }
    for (let j = 0; j < nS; j++) xc[j] = x[sidx[j]] - fm[j];
    if (this.kcRetina) { const rc = this.rc, rv = this.rv, rm = this.rmean; for (let j = 0; j < rc.length; j++) rc[j] = rv[j] - rm[j]; }
    if (this.mbOn) this._mushroomBody();

    const { N, kIn, kRec, Win, Wrec, b, inIdx, recIdx, h, hn, baseAlpha, sens, Wpos } = this;

    // Neuromodulation: a single global "dopamine" reading of the core's state right now (before
    // this step's update); each neuron's leak for *this* update is its baseline nudged by its own
    // sensitivity to it. brain.neuromod 0 = switched off (leak stays at the baseline).
    const nm = this.cfg.brain.neuromod !== 0;
    let D = 0.5;
    if (nm) {
      let sMod = this.bmod[0];
      for (let i = 0; i < N; i++) sMod += this.Wmod[i] * h[i];
      D = sigmoid(sMod);
    }
    this.dopamine = D;

    for (let i = 0; i < N; i++) {
      let s = b[i] + Wpos[3 * i] * px + Wpos[3 * i + 1] * py + Wpos[3 * i + 2] * pz;
      const ib = i * kIn, rb = i * kRec;
      for (let k = 0; k < kIn; k++) s += Win[ib + k] * x[inIdx[ib + k]];
      for (let k = 0; k < kRec; k++) s += Wrec[rb + k] * h[recIdx[rb + k]];
      const da = nm ? clamp(baseAlpha[i] + sens[i] * D, 0.01, 0.99) : baseAlpha[i];
      hn[i] = (1 - da) * h[i] + da * Math.tanh(s);
    }
    h.set(hn);
    const z = this.z, nP = this.nP, pv = this.pv, gp = this.cfg.learn.gain;
    for (let m = 0; m < this.M; m++) {
      let s = this.bout[m];
      const wb = m * N;
      for (let i = 0; i < N; i++) s += this.Wout[wb + i] * h[i];
      const pb = m * nP;
      let p = 0;
      for (let j = 0; j < nP; j++) p += this.Wp[pb + j] * pv[j];
      this.zp[m] = gp * p;
      z[m] = s + gp * p;
    }
    // Active vision: where to look next, tanh-bounded so the eye pans rather than teleports.
    const gaze = this.gaze;
    for (let mg = 0; mg < this.Mg; mg++) {
      let s = this.bgaze[mg];
      const wb = mg * N;
      for (let i = 0; i < N; i++) s += this.Wgaze[wb + i] * h[i];
      gaze[mg] = Math.tanh(s);
    }
    if (this.cfg.eye.reflex) this._reflex();
    // "The loop trick": decisionAlpha < 1 averages the foot logits over recent frames. 1 = off.
    const da = this.cfg.brain.decisionAlpha;
    const ez = da < 1 ? this.zEma : z;
    if (da < 1) for (let m = 0; m < this.M; m++) ez[m] = da * z[m] + (1 - da) * ez[m];
    // each foot's motor neuron is inhibited by the other one
    const g = this.inhibition;
    this.out[0] = Math.tanh(ez[0] - g * ez[1]);
    this.out[1] = Math.tanh(ez[1] - g * ez[0]);
    return this.out;
  }
}
