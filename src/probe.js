// Front-end linear probe: how well can a *linear readout of the fixed LC
// layer alone* tell the two classes apart? This is an upper-ish bound on what
// the trained core can get from a static image, and it answers "is this task
// even feasible with this eye?" without any training. If the probe is near
// 50%, no amount of training the core will fix it -- the information isn't
// in the LC features.

import { TrialWorld } from './world.js';
import { Brain } from './brain.js';
import { mulberry32 } from './rng.js';

export function probeFrontEnd(cfg, stim, perClass = 200, seed = 5) {
  const world = new TrialWorld(cfg);
  const brain = new Brain(cfg);
  const rng = mulberry32(seed);
  world.reset(seed, stim);
  world.phase = 'stim';
  world.phaseT = 10; // long past onset: static view of the image

  // Static features only: dynamic LC types are (correctly) silent here.
  const staticIdx = [];
  brain.lc.forEach((lc, e) => {
    const base = e * lc.n;
    for (const t of lc.types) {
      if (t.name === 'LPLC2' || t.name === 'LC4') continue;
      for (let k = 0; k < t.count; k++) staticIdx.push(base + t.start + k);
    }
  });
  const nF = staticIdx.length;
  const X = [], Y = [];
  const feat = new Float32Array(brain.nLC);
  for (let i = 0; i < perClass * 2; i++) {
    const label = i % 2;
    world.image = stim.sample(rng, label);
    world._render();
    for (const lc of brain.lc) lc.reset();
    let o = 0;
    // a few frames so any history-dependent state settles
    for (let f = 0; f < 3; f++) {
      o = 0;
      for (let e = 0; e < brain.nEyes; e++) { brain.lc[e].step(world.retinas[e]); feat.set(brain.lc[e].out, o); o += brain.lc[e].n; }
    }
    X.push(Float32Array.from(staticIdx, (j) => feat[j]));
    Y.push(label);
  }

  // standardise on the training half, then logistic regression by GD
  const split = Math.floor(X.length * 0.7);
  const mean = new Float32Array(nF), std = new Float32Array(nF);
  for (let i = 0; i < split; i++) for (let j = 0; j < nF; j++) mean[j] += X[i][j] / split;
  for (let i = 0; i < split; i++) for (let j = 0; j < nF; j++) std[j] += (X[i][j] - mean[j]) ** 2 / split;
  for (let j = 0; j < nF; j++) std[j] = Math.sqrt(std[j]) + 1e-6;
  const Z = X.map((x) => Float32Array.from(x, (v, j) => (v - mean[j]) / std[j]));

  const w = new Float32Array(nF);
  let b = 0;
  const lr = 0.05, l2 = 1e-2;
  const predict = (z) => { let s = b; for (let j = 0; j < nF; j++) s += w[j] * z[j]; return 1 / (1 + Math.exp(-s)); };
  for (let epoch = 0; epoch < 300; epoch++) {
    const gw = new Float32Array(nF);
    let gb = 0;
    for (let i = 0; i < split; i++) {
      const err = predict(Z[i]) - Y[i];
      for (let j = 0; j < nF; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < nF; j++) w[j] -= lr * (gw[j] / split + l2 * w[j]);
    b -= lr * gb / split;
  }
  const acc = (from, to) => {
    let ok = 0;
    for (let i = from; i < to; i++) ok += (predict(Z[i]) > 0.5) === (Y[i] === 1) ? 1 : 0;
    return ok / (to - from);
  };
  return { features: nF, train: acc(0, split), test: acc(split, X.length) };
}
