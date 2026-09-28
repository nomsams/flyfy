// How much could better *pictures* help faces? Reads packs of the original photos made by
// tools/pack-faces.ps1 (32x32 colour, several crops) and measures the best straight-line readers
// on the photos themselves, with 5-fold cross-validation:
//   - crop: centre square (what the app uses) vs shifted up vs tight around the upper centre
//   - grey vs colour (luminance + two colour-opponent channels, like an insect's colour vision)
//   - learning curve: 200 / 500 / all photos per class
// Usage: node tools/data-headroom.mjs <pack-dir>
import fs from 'node:fs';
import path from 'node:path';
import { normalizeFace } from '../src/stimuli.js';
import { mulberry32 } from '../src/rng.js';
import { orientationEnergy, orientSize } from '../src/orient.js';

const dir = process.argv[2];
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8').replace(/^﻿/, ''));
const P = meta.size * meta.size, N = meta.count, Y = Int8Array.from(meta.labels);

function load(crop, colour) {
  const raw = new Uint8Array(fs.readFileSync(path.join(dir, crop + '.rgb')));
  return Array.from({ length: N }, (_, n) => {
    const o = n * P * 3, lum = new Float32Array(P);
    for (let p = 0; p < P; p++) lum[p] = (0.114 * raw[o + 3 * p] + 0.587 * raw[o + 3 * p + 1] + 0.299 * raw[o + 3 * p + 2]) / 255;
    normalizeFace(lum);
    if (!colour) return lum;
    const f = new Float32Array(3 * P);
    f.set(lum);
    for (let p = 0; p < P; p++) {
      const b = raw[o + 3 * p] / 255, g = raw[o + 3 * p + 1] / 255, r = raw[o + 3 * p + 2] / 255;
      f[P + p] = r - g;               // red-green opponent
      f[2 * P + p] = b - (r + g) / 2; // blue-yellow opponent
    }
    return f;
  });
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function standardise(tr, te) {
  const d = tr[0].length, m = new Float64Array(d), s = new Float64Array(d);
  for (const x of tr) for (let j = 0; j < d; j++) m[j] += x[j] / tr.length;
  for (const x of tr) for (let j = 0; j < d; j++) s[j] += (x[j] - m[j]) ** 2 / tr.length;
  for (let j = 0; j < d; j++) s[j] = Math.sqrt(s[j]) + 1e-6;
  const f = (x) => Float64Array.from(x, (v, j) => (v - m[j]) / s[j]);
  return [tr.map(f), te.map(f)];
}
function means(X, y) {
  const d = X[0].length, m = [new Float64Array(d), new Float64Array(d)], n = [0, 0];
  X.forEach((x, i) => { n[y[i]]++; for (let j = 0; j < d; j++) m[y[i]][j] += x[j]; });
  for (const c of [0, 1]) for (let j = 0; j < d; j++) m[c][j] /= n[c];
  return m;
}
function classAverages(X, y, T) {
  const [m0, m1] = means(X, y), w = m1.map((v, j) => v - m0[j]), b = -dot(w, m1.map((v, j) => (v + m0[j]) / 2));
  return T.map((x) => (dot(w, x) + b > 0 ? 1 : 0));
}
// shrinkage LDA, (S + l*I) w = m1 - m0 by conjugate gradient with S applied implicitly
function lda(X, y, T) {
  const [m0, m1] = means(X, y), d = X[0].length, lam = Math.max(1, d / 10);
  const C = X.map((x, i) => Float64Array.from(x, (v, j) => v - (y[i] ? m1[j] : m0[j])));
  const Sv = (v) => { const o = new Float64Array(d); for (const c of C) { const a = dot(c, v) / C.length; for (let j = 0; j < d; j++) o[j] += a * c[j]; } for (let j = 0; j < d; j++) o[j] += lam * v[j]; return o; };
  const rhs = m1.map((v, j) => v - m0[j]), w = new Float64Array(d), r = Float64Array.from(rhs), p = Float64Array.from(rhs);
  let rr = dot(r, r);
  for (let it = 0; it < 40 && rr > 1e-10; it++) {
    const Ap = Sv(p), a = rr / dot(p, Ap);
    for (let j = 0; j < d; j++) { w[j] += a * p[j]; r[j] -= a * Ap[j]; }
    const rr2 = dot(r, r);
    for (let j = 0; j < d; j++) p[j] = r[j] + (rr2 / rr) * p[j];
    rr = rr2;
  }
  const b = -dot(w, m1.map((v, j) => (v + m0[j]) / 2));
  return T.map((x) => (dot(w, x) + b > 0 ? 1 : 0));
}

// 5-fold CV on a balanced subset of `perClass` photos per class (so guessing always scores 50%)
function cv(X, reader, perClass = Infinity, K = 5) {
  const r = mulberry32(17), byClass = [[], []];
  for (let i = 0; i < N; i++) byClass[Y[i]].push(i);
  for (const l of byClass) for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
  const use = [...byClass[0].slice(0, perClass), ...byClass[1].slice(0, perClass)];
  for (let i = use.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [use[i], use[j]] = [use[j], use[i]]; }
  let ok = 0;
  for (let k = 0; k < K; k++) {
    const te = use.filter((_, i) => i % K === k), tr = use.filter((_, i) => i % K !== k);
    let [A, B] = standardise(tr.map((i) => X[i]), te.map((i) => X[i]));
    const pred = reader(A, tr.map((i) => Y[i]), B);
    pred.forEach((p, i) => { ok += p === Y[te[i]] ? 1 : 0; });
  }
  return { acc: ok / use.length, n: use.length };
}

const pct = (x) => (x * 100).toFixed(1) + '%';
const row = (label, X, per) => {
  const a = cv(X, classAverages, per), b = cv(X, lda, per);
  console.log(`${label.padEnd(40)} ${String(a.n).padStart(5)}  ${pct(a.acc).padStart(8)}  ${pct(b.acc).padStart(8)}   (+-${(Math.sqrt(0.25 / a.n) * 100).toFixed(1)})`);
};
console.log(`${N} original photos (${Y.filter((y) => y === 0).length} men, ${Y.filter((y) => y === 1).length} women)\n`);
const ALL = Math.min(Y.filter((y) => y === 0).length, Y.filter((y) => y === 1).length); // balanced: guessing = 50%
console.log('setup'.padEnd(40) + '  photos  averages       LDA');
// Beyond straight lines: is the raw-pixel ceiling the true limit, or can a nonlinear code do better?
//   kc   - the fly's own mushroom body: 2,000 Kenyon cells, each summing 6 random brightness + 3
//          random colour inputs, only the top 5% fire. Read by class averages (what reward/pain
//          Hebbian learning amounts to) and by LDA (the best straight line on the KC code).
//   ori  - orientation energy: brightness gradients split into 4 directions, pooled in 4x4 cells
//          (a crude version of orientation-tuned visual neurons / HOG), plus pooled colour.
function kcCode(X, cells = 2000, nLum = P, fanL = 6, fanC = 3, sparsity = 0.05) {
  // like the fly's: inputs centred on the average photo, random +-1 weights, top 5% fire
  const r = mulberry32(5), k = Math.round(cells * sparsity), d = X[0].length, mean = new Float64Array(d);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
  const W = Array.from({ length: cells }, () => [
    ...Array.from({ length: fanL }, () => Math.floor(r() * nLum)),
    ...(d > nLum ? Array.from({ length: fanC }, () => nLum + Math.floor(r() * (d - nLum))) : []),
  ].map((j) => [j, r() < 0.5 ? -1 : 1]));
  return X.map((x) => {
    const a = Float32Array.from(W, (w) => w.reduce((s, [j, g]) => s + g * (x[j] - mean[j]), 0));
    const th = Float32Array.from(a).sort()[cells - k];
    return Float32Array.from(a, (v) => (v >= th ? 1 : 0));
  });
}
function oriCode(X) {
  const S = meta.size, C = 4, n = S / C, out = [];
  for (const x of X) {
    const f = new Float32Array(n * n * 4 + (x.length > P ? 2 * n * n : 0));
    for (let y = 1; y < S - 1; y++) for (let xx = 1; xx < S - 1; xx++) {
      const gx = x[y * S + xx + 1] - x[y * S + xx - 1], gy = x[(y + 1) * S + xx] - x[(y - 1) * S + xx];
      const mag = Math.hypot(gx, gy), ang = (Math.atan2(gy, gx) + Math.PI) % Math.PI; // 0..pi
      const b = Math.floor((ang / Math.PI) * 4) % 4, cell = Math.floor(y / C) * n + Math.floor(xx / C);
      f[cell * 4 + b] += mag;
    }
    if (x.length > P) for (let p = 0; p < P; p++) {
      const cell = Math.floor(Math.floor(p / S) / C) * n + Math.floor((p % S) / C);
      f[n * n * 4 + cell] += x[P + p]; f[n * n * 5 + cell] += x[2 * P + p];
    }
    out.push(f);
  }
  return out;
}

// the app's orientation cells (src/orient.js), plus the colour pooled over the same patches
function orientCode(X, pool) {
  const S = meta.size, n = Math.ceil(S / pool);
  return X.map((x) => {
    const e = orientationEnergy(x.subarray(0, P), S, S, pool, 8);
    if (x.length === P) return e;
    const f = new Float32Array(e.length + 2 * n * n);
    f.set(e);
    for (let p = 0; p < P; p++) {
      const cell = Math.floor(Math.floor(p / S) / pool) * n + Math.floor((p % S) / pool);
      f[e.length + cell] += x[P + p]; f[e.length + n * n + cell] += x[2 * P + p];
    }
    return f;
  });
}

const grey = load('center', false);
if (process.argv[3] === 'orient') { // node tools/data-headroom.mjs <dir> orient [crop]
  const crop = process.argv[4] || 'upper';
  for (const colour of [false, true]) {
    const X = load(crop, colour), tag = `${crop}, ${colour ? 'colour' : 'grey'}, orient. `;
    for (const pool of [2, 4, 8]) row(tag + `pool ${pool}`, orientCode(X, pool), ALL);
    row(tag + 'pool 4 + Kenyon cells', kcCode(orientCode(X, 4), 2000, orientSize(meta.size, meta.size, 4, 8)), ALL);
  }
  process.exit(0);
}
if (process.argv[3] === 'nonlinear') { // node tools/data-headroom.mjs <dir> nonlinear [crop]
  const crop = process.argv[4] || 'upper';
  for (const colour of [false, true]) {
    const X = load(crop, colour), tag = `${crop} crop, ${colour ? 'colour' : 'grey'}, `;
    row(tag + 'raw pixels', X, ALL);
    row(tag + 'Kenyon cells (2,000)', kcCode(X), ALL);
    row(tag + 'Kenyon cells (8,000)', kcCode(X, 8000), ALL);
    row(tag + 'orientation energy', oriCode(X), ALL);
  }
  process.exit(0);
}
if (process.argv[3]) { // just compare the named crops, grey and colour: node tools/data-headroom.mjs <dir> upper,skin
  for (const c of process.argv[3].split(',')) { row(c + ' crop, grey, all balanced', load(c, false), ALL); row(c + ' crop, colour, all balanced', load(c, true), ALL); }
  process.exit(0);
}
row('centre crop, grey, 500 per class', grey, 500);
row('centre crop, grey, 200 per class', grey, 200);
row('centre crop, grey, all balanced', grey, ALL);
row('upper crop, grey, all balanced', load('upper', false), ALL);
row('tight crop, grey, all balanced', load('tight', false), ALL);
row('centre crop, colour, all balanced', load('center', true), ALL);
row('tight crop, colour, all balanced', load('tight', true), ALL);
