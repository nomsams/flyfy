// The swarm's judge: how to turn many flies' answers into one, learned from photos that neither the
// flies nor the exam use. Used by tools/swarm.mjs --judge.
import { IMG, StimulusSet } from '../src/stimuli.js';
import { mulberry32 } from '../src/rng.js';

// Set aside `frac` of the training photos (the same ones for every fly, men and women in proportion).
// The flies never train on them; the judge learns from the flies' answers on them.
export function splitForJudge(train, frac = 0.2) {
  const st = train.planes * IMG * IMG, by = [[], []];
  train.labels.forEach((y, i) => by[y].push(i));
  const r = mulberry32(4242), a = [], b = [];
  for (const list of by) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const cut = Math.round(list.length * frac);
    b.push(...list.slice(0, cut)); a.push(...list.slice(cut));
  }
  const pack = (ids) => {
    const im = new Float32Array(ids.length * st), lb = new Uint8Array(ids.length);
    ids.forEach((id, k) => { im.set(train.images.subarray(id * st, (id + 1) * st), k * st); lb[k] = train.labels[id]; });
    return new StimulusSet('faces', im, lb);
  };
  return { flyTrain: pack(a), judgeSet: pack(b) };
}

// Fit several judges on the judge photos (jLabels / jFlies) and score them on the exam photos
// (tLabels / tFlies), balanced (men and women count equally). A fly's input to the judge is its
// margin summed over its looks, divided by that fly's typical margin on the judge photos.
export function judges(jLabels, jFlies, tLabels, tFlies, nLooks, log = console.log) {
  const K = jFlies.length, pct = (x) => (x * 100).toFixed(1) + '%';
  const feats = (flies, n) => Array.from({ length: n }, (_, i) => flies.map((f) => {
    let s = 0;
    for (let l = 0; l < nLooks; l++) if (f.foot[i * nLooks + l] >= 0) s += f.margin[i * nLooks + l];
    return s;
  }));
  const XJ = feats(jFlies, jLabels.length), XT = feats(tFlies, tLabels.length);
  const sd = Array.from({ length: K }, (_, k) => Math.sqrt(XJ.reduce((s, x) => s + x[k] * x[k], 0) / XJ.length) || 1);
  for (const X of [XJ, XT]) for (const x of X) for (let k = 0; k < K; k++) x[k] /= sd[k];

  const score = (x, w, b) => { let z = b; for (let k = 0; k < K; k++) z += w[k] * x[k]; return z; };
  const bal = (X, Y, w, b) => {
    const ok = [0, 0], t = [0, 0];
    X.forEach((x, i) => { t[Y[i]]++; if ((score(x, w, b) > 0 ? 1 : 0) === Y[i]) ok[Y[i]]++; });
    return (ok[0] / t[0] + ok[1] / t[1]) / 2;
  };
  const cw = [0, 0];
  for (const y of jLabels) cw[y]++;
  const wt = (y) => jLabels.length / (2 * cw[y]); // class weights: men and women count equally

  // the threshold that best balances the two answers on the judge photos
  const fitBias = (w) => {
    const z = XJ.map((x) => score(x, w, 0)).sort((a, b) => a - b);
    let best = -1, bb = 0;
    for (let q = 1; q < 40; q++) {
      const b = -z[Math.floor((q / 40) * z.length)], a = bal(XJ, jLabels, w, b);
      if (a > best) { best = a; bb = b; }
    }
    return bb;
  };
  const logistic = (X, Y, lam, nonneg) => {
    const w = new Float64Array(K);
    let b = 0;
    for (let ep = 0; ep < 400; ep++) {
      const g = new Float64Array(K);
      let gb = 0;
      X.forEach((x, i) => {
        const e = (1 / (1 + Math.exp(-score(x, w, b))) - Y[i]) * wt(Y[i]);
        for (let k = 0; k < K; k++) g[k] += e * x[k];
        gb += e;
      });
      for (let k = 0; k < K; k++) { w[k] -= 0.2 * (g[k] / X.length + lam * w[k]); if (nonneg && w[k] < 0) w[k] = 0; }
      b -= (0.2 * gb) / X.length;
    }
    return { w, b };
  };
  // the regularisation, chosen by 5-fold cross-validation inside the judge photos
  const pickLam = (nonneg) => {
    let best = -1, bl = 0.01;
    for (const lam of [0.001, 0.01, 0.1, 1]) {
      let a = 0;
      for (let fold = 0; fold < 5; fold++) {
        const tr = XJ.filter((_, i) => i % 5 !== fold), ty = jLabels.filter((_, i) => i % 5 !== fold);
        const va = XJ.filter((_, i) => i % 5 === fold), vy = jLabels.filter((_, i) => i % 5 === fold);
        const m = logistic(tr, ty, lam, nonneg);
        a += bal(va, vy, m.w, m.b) / 5;
      }
      if (a > best) { best = a; bl = lam; }
    }
    return bl;
  };

  const ones = new Array(K).fill(1);
  // Hebbian trust: each fly's weight = how far its margin leans the right way on average
  // (the same rule the flies themselves learn by), never negative
  const trust = Array.from({ length: K }, (_, k) => Math.max(0, XJ.reduce((s, x, i) => s + (jLabels[i] ? 1 : -1) * x[k] * wt(jLabels[i]), 0) / XJ.length));
  const lamB = pickLam(true), lamA = pickLam(false);
  const ln = logistic(XJ, jLabels, lamB, true), lg = logistic(XJ, jLabels, lamA, false);
  const rows = [
    ['equal votes (margins scaled)', ones, 0],
    ['equal votes + fitted threshold', ones, fitBias(ones)],
    ['Hebbian trust + fitted threshold', trust, fitBias(trust)],
    ['learned judge, weights >= 0 (L2 ' + lamB + ')', ln.w, ln.b],
    ['learned judge, any weights (L2 ' + lamA + ')', lg.w, lg.b],
  ];
  log('judges fitted on ' + jLabels.length + ' separate photos, scored on the ' + tLabels.length + ' exam photos (balanced):');
  const res = {};
  for (const [name, w, b] of rows) {
    res[name] = bal(XT, tLabels, w, b);
    log('  ' + name.padEnd(42) + ' ' + pct(res[name]) + '   (on its own photos ' + pct(bal(XJ, jLabels, w, b)) + ')');
  }
  log('  the weights >= 0 judge relies on ' + Array.from(ln.w).filter((v) => v > 1e-3).length + ' of ' + K + ' flies');
  return res;
}
