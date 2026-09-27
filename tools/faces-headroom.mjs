// Where does face accuracy get lost? Measures how well the man/woman answer can be read out at each
// stage of the fly's pipeline, with three kinds of reader, using 10-fold cross-validation over all
// 1,000 bundled photos (much tighter than one 150-photo exam):
//
//   stages:  photo (raw 32x32)  ->  eye (the fly's light sensors)  ->  eye cells (LC tiles)
//            ->  memory centre (Kenyon-cell code)
//   readers: class averages  (what reward/pain learning roughly computes: difference of the two
//                             class-average patterns - a "nearest class mean" classifier)
//            logistic regression (the best straight-line reader, trained by gradient descent)
//            shrinkage LDA  (class averages corrected for correlated inputs: w = (S + l*I)^-1 (m1 - m0))
//
// A big drop between two stages says what to fix. Usage: node tools/faces-headroom.mjs [--quick]
import { mergeConfig } from '../src/config.js';
import { IMG } from '../src/stimuli.js';
import { TrialWorld } from '../src/world.js';
import { Brain } from '../src/brain.js';
import { mulberry32 } from '../src/rng.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeFace } from '../src/stimuli.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'faces32.json'), 'utf8'));
const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'data', 'faces32.bin')));
const N = meta.labels.length, Y = Int8Array.from(meta.labels);
const photos = Array.from({ length: N }, (_, i) => normalizeFace(Float32Array.from(bytes.subarray(i * IMG * IMG, (i + 1) * IMG * IMG), (b) => b / 255)));

// ---------------------------------------------------------------- representations
function eyeAndCells(cfgOver = {}) {
  const cfg = mergeConfig(cfgOver);
  const w = new TrialWorld(cfg), b = new Brain(cfg);
  w.reset(1, { sample: () => photos[0] });
  w.phase = 'stim'; w.phaseT = 10;
  const eye = [], cells = [];
  for (const img of photos) {
    w.image = img; w._render();
    eye.push(Float32Array.from(w.retinas[0]));
    for (const l of b.lc) l.reset();
    for (let f = 0; f < 3; f++) b.lc[0].step(w.retinas[0]);
    const out = b.lc[0].out;
    cells.push(Float32Array.from(b.staticIdx, (j) => out[j]));
  }
  return { eye, cells, brain: new Brain(mergeConfig({ ...cfgOver, mb: { enabled: 1, retina: 1 } })) };
}

// the memory centre's code for each photo: the brain's own Kenyon cells, fed the eye's sensors
// centred on the average photo (what the fly adapts to), then keep the top 5% (k-winners-take-all)
function kenyon(eye, brain) {
  const d = eye[0].length, mean = new Float32Array(d);
  for (const v of eye) for (let j = 0; j < d; j++) mean[j] += v[j] / eye.length;
  return eye.map((v) => {
    for (let j = 0; j < d; j++) { brain.rv[j] = v[j]; brain.rc[j] = v[j] - mean[j]; }
    brain._mushroomBody();
    return Float32Array.from(brain.kc);
  });
}

// ---------------------------------------------------------------- readers
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

function standardise(train, test) {
  const d = train[0].length, m = new Float64Array(d), s = new Float64Array(d);
  for (const x of train) for (let j = 0; j < d; j++) m[j] += x[j] / train.length;
  for (const x of train) for (let j = 0; j < d; j++) s[j] += (x[j] - m[j]) ** 2 / train.length;
  for (let j = 0; j < d; j++) s[j] = Math.sqrt(s[j]) + 1e-6;
  const f = (x) => Float64Array.from(x, (v, j) => (v - m[j]) / s[j]);
  return [train.map(f), test.map(f)];
}

function classMeans(X, y) {
  const d = X[0].length, m = [new Float64Array(d), new Float64Array(d)], n = [0, 0];
  X.forEach((x, i) => { n[y[i]]++; for (let j = 0; j < d; j++) m[y[i]][j] += x[j]; });
  for (const c of [0, 1]) for (let j = 0; j < d; j++) m[c][j] /= n[c];
  return m;
}

function nearestMean(Xtr, ytr, Xte) {
  const [m0, m1] = classMeans(Xtr, ytr);
  const w = m1.map((v, j) => v - m0[j]), b = -dot(w, m1.map((v, j) => (v + m0[j]) / 2));
  return Xte.map((x) => dot(w, x) + b > 0 ? 1 : 0);
}

function logistic(Xtr, ytr, Xte, l2 = 1e-2, epochs = 300, lr = 0.1) {
  const d = Xtr[0].length, w = new Float64Array(d);
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const g = new Float64Array(d);
    let gb = 0;
    Xtr.forEach((x, i) => { const err = 1 / (1 + Math.exp(-(dot(w, x) + b))) - ytr[i]; for (let j = 0; j < d; j++) g[j] += err * x[j]; gb += err; });
    for (let j = 0; j < d; j++) w[j] -= lr * (g[j] / Xtr.length + l2 * w[j]);
    b -= lr * gb / Xtr.length;
  }
  return Xte.map((x) => dot(w, x) + b > 0 ? 1 : 0);
}

// Shrinkage LDA: solve (S + l*I) w = m1 - m0 by conjugate gradient, with S the pooled within-class
// covariance applied implicitly (never formed), so it works for 1,024 inputs too.
function lda(Xtr, ytr, Xte, lam) {
  const [m0, m1] = classMeans(Xtr, ytr), d = Xtr[0].length;
  const C = Xtr.map((x, i) => Float64Array.from(x, (v, j) => v - (ytr[i] ? m1[j] : m0[j])));
  const Sv = (v) => {
    const out = new Float64Array(d);
    for (const c of C) { const a = dot(c, v) / C.length; for (let j = 0; j < d; j++) out[j] += a * c[j]; }
    for (let j = 0; j < d; j++) out[j] += lam * v[j];
    return out;
  };
  const rhs = m1.map((v, j) => v - m0[j]);
  const w = new Float64Array(d), r = Float64Array.from(rhs), p = Float64Array.from(rhs);
  let rr = dot(r, r);
  for (let it = 0; it < 60 && rr > 1e-10; it++) {
    const Ap = Sv(p), a = rr / dot(p, Ap);
    for (let j = 0; j < d; j++) { w[j] += a * p[j]; r[j] -= a * Ap[j]; }
    const rr2 = dot(r, r);
    for (let j = 0; j < d; j++) p[j] = r[j] + (rr2 / rr) * p[j];
    rr = rr2;
  }
  const b = -dot(w, m1.map((v, j) => (v + m0[j]) / 2));
  return Xte.map((x) => dot(w, x) + b > 0 ? 1 : 0);
}

// ---------------------------------------------------------------- cross-validation
const K = process.argv.includes('--quick') ? 5 : 10;
const order = Array.from({ length: N }, (_, i) => i);
{ const r = mulberry32(11); for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } }

function cv(X, reader) {
  let ok = 0;
  for (let k = 0; k < K; k++) {
    const te = order.filter((_, i) => i % K === k), tr = order.filter((_, i) => i % K !== k);
    let [Xtr, Xte] = [tr.map((i) => X[i]), te.map((i) => X[i])];
    [Xtr, Xte] = standardise(Xtr, Xte);
    const pred = reader(Xtr, tr.map((i) => Y[i]), Xte);
    pred.forEach((p, i) => { ok += p === Y[te[i]] ? 1 : 0; });
  }
  return ok / N;
}

const readers = {
  'class averages': nearestMean,
  'logistic': (a, b, c) => logistic(a, b, c),
  'shrinkage LDA': (a, b, c) => lda(a, b, c, Math.max(1, a[0].length / 10)),
};
const stages = {};
stages['photo (32x32)'] = photos;
const std = eyeAndCells();
stages['eye (14x20 sensors)'] = std.eye;
stages['eye cells (90 LC tiles)'] = std.cells;
stages['memory centre (400 Kenyon cells)'] = kenyon(std.eye, std.brain);
if (!process.argv.includes('--quick')) {
  const bigKC = new Brain(mergeConfig({ mb: { enabled: 1, retina: 1, cells: 2000 } }));
  stages['memory centre (2000 Kenyon cells)'] = kenyon(std.eye, bigKC);
}

const se = (p) => Math.sqrt(p * (1 - p) / N);
console.log(`faces, ${N} photos, ${K}-fold cross-validation (typical error +-${(se(0.6) * 100).toFixed(1)} points)\n`);
console.log('stage'.padEnd(36) + Object.keys(readers).map((r) => r.padStart(16)).join(''));
for (const [name, X] of Object.entries(stages)) {
  const row = Object.values(readers).map((f) => ((cv(X, f) * 100).toFixed(1) + '%').padStart(16));
  console.log(name.padEnd(36) + row.join(''));
}
