// Front-end linear probe: how well can a *linear readout of the fixed LC
// layer alone* tell the two classes apart? This is an upper-ish bound on what
// the trained core can get from a static image, and it answers "is this task
// even feasible with this eye?" without any training. If the probe is near
// 50%, no amount of training the core will fix it -- the information isn't
// in the LC features.
//
// It also implements "the loop trick" (test-time jitter ensembling): the classifier is
// trained once on a single centred look at each image, exactly as before. At *test* time,
// instead of one look, each held-out image is rendered `ensemble` times at a small sub-receptor
// offset, the linear classifier scores each jittered look, and the raw scores (logits) are
// summed before deciding -- the same idea as shifting, downsampling and re-classifying a photo
// several times and adding up the results. The `ensemble` looks are spaced evenly around a
// circle (not random): with only a handful of looks, random jitter can land on the same side
// twice and miss the other side entirely, while even spacing guarantees full, non-overlapping
// coverage every time. This only ever touches evaluation, never training, so it costs nothing
// during learning and nothing at inference time beyond a few extra (cheap) forward passes of
// the fixed LC layer.

import { TrialWorld } from './world.js';
import { Brain } from './brain.js';
import { mulberry32 } from './rng.js';

// Renders `img` through the LC layer's static units, settling a few frames first. `offset`, when
// given, is a [az, el] sub-receptor jitter (as a fraction of receptor spacing) for this look.
function staticFeatures(world, brain, staticIdx, img, offset) {
  world.image = img;
  const az = offset ? offset[0] * (world.cfg.eye.fovAzDeg / world.C) : 0;
  const el = offset ? offset[1] * (world.cfg.eye.fovElDeg / world.R) : 0;
  for (const lc of brain.lc) lc.reset();
  let out = new Float32Array(brain.nLC);
  for (let f = 0; f < 3; f++) { // a few frames so any history-dependent state settles
    world._render(az, el);
    let o = 0;
    for (let e = 0; e < brain.nEyes; e++) { brain.lc[e].step(world.retinas[e]); out.set(brain.lc[e].out, o); o += brain.lc[e].n; }
  }
  return Float32Array.from(staticIdx, (j) => out[j]);
}

// ensemble: how many independently-jittered looks to sum at test time (1 = the trick is off).
// jitterRecep: amplitude of that jitter, as a fraction of receptor spacing.
export function probeFrontEnd(cfg, stim, perClass = 200, seed = 5, ensemble = 1, jitterRecep = 0.6) {
  // The jitter here is applied explicitly per look, so the world's own automatic jitter must be off.
  const world = new TrialWorld({ ...cfg, eye: { ...cfg.eye, jitterFrac: 0 } });
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
  const X = [], Y = [], IMAGES = [];
  for (let i = 0; i < perClass * 2; i++) {
    const label = i % 2;
    const img = Float32Array.from(stim.sample(rng, label)); // cloned: procedural stimuli reuse their buffer
    X.push(staticFeatures(world, brain, staticIdx, img, null));
    Y.push(label);
    IMAGES.push(img);
  }

  // standardise on the training half, then logistic regression by GD
  const split = Math.floor(X.length * 0.7);
  const mean = new Float32Array(nF), std = new Float32Array(nF);
  for (let i = 0; i < split; i++) for (let j = 0; j < nF; j++) mean[j] += X[i][j] / split;
  for (let i = 0; i < split; i++) for (let j = 0; j < nF; j++) std[j] += (X[i][j] - mean[j]) ** 2 / split;
  for (let j = 0; j < nF; j++) std[j] = Math.sqrt(std[j]) + 1e-6;
  const z = (x) => Float32Array.from(x, (v, j) => (v - mean[j]) / std[j]);
  const Z = X.map(z);

  const w = new Float32Array(nF);
  let b = 0;
  const lr = 0.05, l2 = 1e-2;
  const logit = (zv) => { let s = b; for (let j = 0; j < nF; j++) s += w[j] * zv[j]; return s; };
  for (let epoch = 0; epoch < 300; epoch++) {
    const gw = new Float32Array(nF);
    let gb = 0;
    for (let i = 0; i < split; i++) {
      const err = 1 / (1 + Math.exp(-logit(Z[i]))) - Y[i];
      for (let j = 0; j < nF; j++) gw[j] += err * Z[i][j];
      gb += err;
    }
    for (let j = 0; j < nF; j++) w[j] -= lr * (gw[j] / split + l2 * w[j]);
    b -= lr * gb / split;
  }
  const acc = (from, to) => {
    let ok = 0;
    for (let i = from; i < to; i++) ok += (logit(Z[i]) > 0) === (Y[i] === 1) ? 1 : 0;
    return ok / (to - from);
  };

  let testEnsembled = null;
  if (ensemble > 1) {
    const r = 0.5 * jitterRecep;
    const offsets = Array.from({ length: ensemble }, (_, k) => {
      const ang = (k / ensemble) * 2 * Math.PI;
      return [Math.cos(ang) * r, Math.sin(ang) * r];
    });
    let ok = 0;
    for (let i = split; i < X.length; i++) {
      let sum = 0;
      for (const offset of offsets) sum += logit(z(staticFeatures(world, brain, staticIdx, IMAGES[i], offset)));
      ok += (sum > 0) === (Y[i] === 1) ? 1 : 0;
    }
    testEnsembled = ok / (X.length - split);
  }

  return { features: nF, train: acc(0, split), test: acc(split, X.length), testEnsembled, ensemble };
}
