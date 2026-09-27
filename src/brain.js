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
  { name: 'LPLC2', group: 'loom', gain: 800 },
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
        out[t.start + k] = sat(t.gain * x);
      }
    }
  }
}

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
    this.M = 2;
    this.alpha = b.alpha;

    // Fixed random wiring (distinct sources per neuron).
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

    this.sizes = {
      win: this.N * this.kIn, wrec: this.N * this.kRec, b: this.N,
      wout: this.M * this.N, bout: this.M,
    };
    this.paramCount = Object.values(this.sizes).reduce((a, b2) => a + b2, 0);
    this.x = new Float32Array(this.nIn);
    this.h = new Float32Array(this.N);
    this.hn = new Float32Array(this.N);
    this.out = new Float32Array(this.M);
    this.z = new Float32Array(this.M);
    // Plastic (fast) synapses from the static LC cells onto the feet. Not part of the evolved
    // parameters: they are learned during life from reward and pain, see learn().
    this.staticIdx = [];
    this.lc.forEach((lc, e) => { for (const t of lc.types) if (t.group === 'static') for (let k = 0; k < t.count; k++) this.staticIdx.push(e * lc.n + t.start + k); });
    this.nS = this.staticIdx.length;
    this.Wp = new Float32Array(this.M * this.nS);
    this.xc = new Float32Array(this.nS);      // static features minus their running mean
    this.fmean = new Float32Array(this.nS);
    this.fmeanInit = false;
    this.nAnswers = 0;
    this.inhibition = b.inhibition;
    this.zEma = new Float32Array(this.M); // "the loop trick" for the live fly: see decisionAlpha
    this.setParams(new Float32Array(this.paramCount));
  }

  get neuronCount() { return this.nLC + this.N + this.M + 4; }

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
  }

  // keepPlastic: keep what the fly has learned (the fast synapses) across episodes.
  reset(keepPlastic = false) {
    this.h.fill(0); this.hn.fill(0); this.out.fill(0); this.x.fill(0); this.zEma.fill(0);
    for (const l of this.lc) l.reset();
    if (!keepPlastic) { this.Wp.fill(0); this.nAnswers = 0; }
    this.fmeanInit = keepPlastic && this.nAnswers > 0; // keep the adapted mean when continuing a life
  }

  getPlastic() { return { Wp: Float32Array.from(this.Wp), fmean: Float32Array.from(this.fmean), n: this.nAnswers }; }
  setPlastic(p) {
    if (!p || p.Wp.length !== this.Wp.length) { this.Wp.fill(0); this.nAnswers = 0; this.fmeanInit = false; return; }
    this.Wp.set(p.Wp); this.fmean.set(p.fmean); this.nAnswers = p.n; this.fmeanInit = p.n > 0;
  }

  // Pain from pressing when it should not (blank screen, or before looking): only the foot that
  // pressed is weakened, along the features that drove it.
  punish(foot) {
    const L = this.cfg.learn, pn = this.cfg.pain;
    if (!L.eta) return;
    const d = L.eta / (1 + (L.anneal ? this.nAnswers / L.anneal : 0)) * pn.strength * pn.onPremature, nS = this.nS, a = foot * nS, xc = this.xc, Wp = this.Wp;
    for (let j = 0; j < nS; j++) Wp[a + j] = Math.max(-L.wmax, Math.min(L.wmax, Wp[a + j] - d * xc[j]));
  }

  // Reinforcement from the answer just given: reward if correct, pain if wrong. With two choices a
  // wrong answer also says the other foot was right, so both feet's synapses move.
  learn(foot, correct) {
    const L = this.cfg.learn;
    if (!L.eta) return;
    const sig = correct ? L.reward : -this.cfg.pain.strength;
    const nS = this.nS, xc = this.xc, Wp = this.Wp, wmax = L.wmax;
    // experienced flies change their minds more slowly, which settles the weights on noisy tasks
    const speed = L.eta / (1 + (L.anneal ? this.nAnswers / L.anneal : 0));
    const a = foot * nS, b = (1 - foot) * nS, d = speed * sig;
    for (let j = 0; j < nS; j++) {
      Wp[a + j] = Math.max(-wmax, Math.min(wmax, Wp[a + j] + d * xc[j]));
      Wp[b + j] = Math.max(-wmax, Math.min(wmax, Wp[b + j] - d * xc[j]));
    }
    // adapt the reference to what an answered image looks like (fast at first, then slow)
    const rate = Math.max(0.05, 1 / (1 + this.nAnswers++)), fm = this.fmean, sidx = this.staticIdx, x = this.x;
    for (let j = 0; j < nS; j++) fm[j] += rate * (x[sidx[j]] - fm[j]);
  }

  // retinas: array of Float32Array; touch, pain: Float32Array(2) (pain optional). Returns this.out.
  step(retinas, touch, pain) {
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

    // centre the static LC features on the average image the fly has answered on (adaptation), so
    // both classes sit either side of zero; the mean is updated in learn(), at answer time
    const nS = this.nS, xc = this.xc, fm = this.fmean, sidx = this.staticIdx;
    if (!this.fmeanInit) { for (let j = 0; j < nS; j++) fm[j] = x[sidx[j]]; this.fmeanInit = true; }
    for (let j = 0; j < nS; j++) xc[j] = x[sidx[j]] - fm[j];

    const { N, kIn, kRec, Win, Wrec, b, inIdx, recIdx, h, hn, alpha } = this;
    for (let i = 0; i < N; i++) {
      let s = b[i];
      const ib = i * kIn, rb = i * kRec;
      for (let k = 0; k < kIn; k++) s += Win[ib + k] * x[inIdx[ib + k]];
      for (let k = 0; k < kRec; k++) s += Wrec[rb + k] * h[recIdx[rb + k]];
      hn[i] = (1 - alpha) * h[i] + alpha * Math.tanh(s);
    }
    h.set(hn);
    const z = this.z;
    for (let m = 0; m < this.M; m++) {
      let s = this.bout[m];
      const wb = m * N;
      for (let i = 0; i < N; i++) s += this.Wout[wb + i] * h[i];
      const gp = this.cfg.learn.gain, pb = m * nS;
      let p = 0;
      for (let j = 0; j < nS; j++) p += this.Wp[pb + j] * xc[j];
      z[m] = s + gp * p;
    }
    // "The loop trick" for the live fly: eye.jitterFrac gives each frame a slightly different
    // sub-receptor look; decisionAlpha < 1 sums/averages those looks' logits over time (a running
    // average, cheaper than a literal replay loop) instead of betting everything on one frame's
    // instantaneous read. 1 = off: the decision is exactly today's instantaneous z.
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
