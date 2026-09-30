// A swarm of flies deciding together: one fly trained by reward and pain, shown every held-out photo in
// a few "looks" while frozen, recording each answer and its margin; then the votes of many flies are added
// up. Shared by the Swarm tab (run in Web Workers) and the command-line tools, so they cannot disagree.
// What was measured (README, "A swarm of flies"): a swarm only helps if its flies see differently - each
// fly its own centre of gaze on a circle, with the sharp centre - and adding margins beats a majority.

import { mergeConfig } from './config.js';
import { Runner } from './rollout.js';
import { IMG, StimulusSet } from './stimuli.js';
import { mulberry32 } from './rng.js';

// the looks: as is, mirrored, a little nearer, a little further, and combinations
export const LOOKS = [
  { mirror: false, dist: 1 }, { mirror: true, dist: 1 },
  { mirror: false, dist: 0.9 }, { mirror: true, dist: 0.9 },
  { mirror: false, dist: 1.1 }, { mirror: true, dist: 1.1 },
];

function mirrored(src, planes) {
  const out = new Float32Array(src.length);
  for (let c = 0; c < planes; c++) for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) {
    out[c * IMG * IMG + y * IMG + x] = src[c * IMG * IMG + y * IMG + (IMG - 1 - x)];
  }
  return out;
}

// A training set whose photos are drawn in proportion to weights (within each class; the world still
// shows men and women equally often). Used by boosting: photos the swarm finds hard are shown more.
export class WeightedSet extends StimulusSet {
  constructor(base, weights) {
    super('faces', base.images, base.labels);
    this.planes = base.planes; this.scratch = base.scratch;
    this.cum = this.byLabel.map((list) => { let s = 0; return Float64Array.from(list, (i) => (s += weights[i])); });
    this.full = this.byLabel;
  }
  sample(rng, label) {
    const cum = this.cum[label], u = rng() * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < u) lo = mid + 1; else hi = mid; }
    const keep = this.byLabel;
    this.byLabel = [[], []]; this.byLabel[label] = [this.full[label][lo]];
    const img = super.sample(rng, label); // picks that one photo (and mirrors it half the time)
    this.byLabel = keep;
    return img;
  }
}

// Train one fly by reward and pain (what Quick learn does); returns what it learned.
export function trainFly(cfg, train, seed, episodes = 150, onProgress) {
  const r = new Runner(cfg, train);
  const theta = r.brain.initParams(seed);
  for (let ep = 0; ep < episodes; ep++) {
    r.episode(ep === 0 ? theta : null, seed * 100003 + ep, null, ep > 0);
    if (onProgress && (ep + 1) % 5 === 0) onProgress((ep + 1) / episodes);
  }
  return { theta, plastic: r.brain.getPlastic() };
}

// Show a frozen fly each photo in each look. Returns foot (-1 = no answer) and margin (how far the
// chosen foot's drive led the other at the moment of answering) per [photo][look].
export function judge(cfg, set, fly, nLooks, seed = 1, looks = LOOKS) {
  const c = mergeConfig({ ...cfg, learn: { ...cfg.learn, eta: 0 }, screen: { ...cfg.screen, distanceJitter: 0 } });
  const r = new Runner(c, set), w = r.world, b = r.brain;
  b.setParams(fly.theta);
  const n = set.labels.length, planes = set.planes, st = planes * IMG * IMG;
  const foot = new Int8Array(n * nLooks).fill(-1), margin = new Float32Array(n * nLooks);
  const queue = [];
  for (let l = 0; l < nLooks; l++) for (let i = 0; i < n; i++) queue.push(i * nLooks + l);
  // a fixed random order (the same for every fly): the stored photos come sorted by class
  { const rq = mulberry32(99); for (let k = queue.length - 1; k > 0; k--) { const j = Math.floor(rq() * (k + 1)); [queue[k], queue[j]] = [queue[j], queue[k]]; } }
  let qi = 0, cur = -1, last = [0, 0];
  const start = w._startTrial.bind(w), answer = w._answer.bind(w), wstep = w.step.bind(w);
  w._startTrial = () => {
    start();
    if (qi >= queue.length) { cur = -1; return; }
    cur = queue[qi++];
    const i = Math.floor(cur / nLooks), look = looks[cur % nLooks], img = set.images.subarray(i * st, (i + 1) * st);
    w.label = set.labels[i];
    w.image = look.mirror ? mirrored(img, planes) : img;
    w.dist0 = w.dist = (c.screen.distance || 1) * (look.dist || 1);
    w.gazeAz = look.shift || 0; w.gazeEl = look.shiftEl || 0;
    w._feel();
  };
  w.step = (o0, o1, ...rest) => { last = [b.z[0], b.z[1]]; return wstep(o0, o1, ...rest); };
  w._answer = (f) => {
    if (cur >= 0 && w.phase === 'stim' && w.phaseT >= c.timing.reactionSec && foot[cur] === -1) { foot[cur] = f; margin[cur] = last[1] - last[0]; }
    return answer(f);
  };
  b.reset(false); b.setPlastic(fly.plastic);
  for (let ep = 0; qi < queue.length; ep++) {
    r.episode(null, 700000 + seed * 7919 + ep, null, true);
    if (cur >= 0 && foot[cur] === -1) queue.push(cur); // cut off by the end of the session: show it again
    cur = -1;
    if (ep > 20000) throw new Error('judge did not finish');
  }
  return { foot: Array.from(foot), margin: Array.from(margin) };
}

// where the flies look: fly k of K on a circle of radius R degrees around the picture's centre (R = 0: all at the centre)
export function gazeSpots(K, R) {
  return Array.from({ length: K }, (_, s) => (R ? [R * Math.cos((2 * Math.PI * s) / K), R * Math.sin((2 * Math.PI * s) / K)] : [0, 0]));
}
export const gazeConfig = ([az, el]) => (az || el ? { screen: { centerAzDeg: az, centerElDeg: el } } : {});

// one fly's whole job: train (optionally on weighted photos), answer the exam photos in `looks` looks, and optionally the
// training photos once (boosting needs its margins there). Returns plain arrays.
export function flyJob({ cfg, train, test, seed, episodes = 150, looks = 4, weights = null, trainMargins = false, onProgress }) {
  const set = weights ? new WeightedSet(train, weights) : train;
  const fly = trainFly(cfg, set, seed, episodes, onProgress ? (f) => onProgress(f * 0.6) : undefined);
  const te = judge(cfg, test, fly, looks, seed);
  onProgress?.(trainMargins ? 0.85 : 1);
  const out = { test: te };
  if (trainMargins) out.train = judge(cfg, train, fly, 1, seed + 7000);
  onProgress?.(1);
  return out;
}

// balanced accuracy (men and women count equally, guessing = 50%) of a score per photo (> 0 means label 1)
export function balanced(labels, score) {
  const ok = [0, 0], t = [0, 0];
  for (let i = 0; i < labels.length; i++) { const y = labels[i]; t[y]++; if ((score(i) > 0 ? 1 : 0) === y) ok[y]++; }
  return ((t[0] ? ok[0] / t[0] : 0) + (t[1] ? ok[1] / t[1] : 0)) / 2;
}

// a fly's margins summed over its first `looks` looks (or its foot choice as +-1 when weighted is false)
export function flyScore(fly, i, nLooks, looks = nLooks, weighted = true) {
  let s = 0;
  for (let l = 0; l < looks; l++) { const k = i * nLooks + l; if (fly.foot[k] >= 0) s += weighted ? fly.margin[k] : fly.foot[k] ? 1 : -1; }
  return s;
}

// each fly's score per photo, scaled by its own typical size (so a loud fly does not drown the others)
export function scaledScores(flies, n, nLooks) {
  return flies.map((f) => {
    const raw = Array.from({ length: n }, (_, i) => flyScore(f, i, nLooks));
    const sd = Math.sqrt(raw.reduce((a, v) => a + v * v, 0) / Math.max(1, n)) || 1;
    return raw.map((v) => v / sd);
  });
}

// how alike the flies' mistakes are: mean correlation of right/wrong between pairs (0 = independent, 1 = identical)
export function mistakeCorrelation(labels, scores) {
  const right = scores.map((sc) => Array.from({ length: labels.length }, (_, i) => ((sc[i] > 0 ? 1 : 0) === labels[i] ? 1 : 0)));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  let cs = 0, cn = 0;
  for (let a = 0; a < right.length; a++) for (let b = a + 1; b < right.length; b++) {
    const ma = mean(right[a]), mb = mean(right[b]); let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < labels.length; i++) { cov += (right[a][i] - ma) * (right[b][i] - mb); va += (right[a][i] - ma) ** 2; vb += (right[b][i] - mb) ** 2; }
    cs += cov / Math.sqrt(va * vb + 1e-12); cn++;
  }
  return cn ? cs / cn : 0;
}

// Boosting weights from the swarm so far (AdaBoost): photos it gets wrong, or only just right, count more; capped (a few photos are
// mislabelled) and normalised to mean 1 within each class. trainScores: each fly's scaled margin per training photo; says: each fly's say.
export function boostWeights(trainLabels, trainScores, says, alpha = 1, cap = 4) {
  const n = trainLabels.length, sum = says.reduce((a, b) => a + b, 0) || 1;
  const w = Array.from({ length: n }, (_, i) => { let F = 0; trainScores.forEach((sc, k) => { F += says[k] * sc[i]; }); return Math.exp(-alpha * (trainLabels[i] ? 1 : -1) * (F / sum)); });
  for (const y of [0, 1]) {
    const idx = []; for (let i = 0; i < n; i++) if (trainLabels[i] === y) idx.push(i);
    let mean = idx.reduce((s, i) => s + w[i], 0) / idx.length;
    for (const i of idx) w[i] = Math.min(cap, w[i] / mean);
    mean = idx.reduce((s, i) => s + w[i], 0) / idx.length;
    for (const i of idx) w[i] /= mean;
  }
  return w;
}

// AdaBoost's "say" of a fly: from its error on the training photos as weighted when it practised
export function flySay(trainLabels, margins, weights) {
  let e = 0, tot = 0;
  for (let i = 0; i < trainLabels.length; i++) { tot += weights[i]; if ((margins[i] > 0 ? 1 : 0) !== trainLabels[i]) e += weights[i]; }
  e = Math.min(0.999, Math.max(0.001, e / tot));
  return { say: Math.max(0, 0.5 * Math.log((1 - e) / e)), err: e };
}
