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
const grey = load('center', false);
row('centre crop, grey, 500 per class', grey, 500);
row('centre crop, grey, 200 per class', grey, 200);
row('centre crop, grey, all balanced', grey, ALL);
row('upper crop, grey, all balanced', load('upper', false), ALL);
row('tight crop, grey, all balanced', load('tight', false), ALL);
row('centre crop, colour, all balanced', load('center', true), ALL);
row('tight crop, colour, all balanced', load('tight', true), ALL);
