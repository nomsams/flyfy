// A swarm that specialises: boosting, fly-style. Flies join in rounds. After each round the swarm so
// far answers every training photo, and each photo gets a weight - photos the swarm gets wrong, or
// only just right, count more (AdaBoost's exp(-alpha * y * F)). The next round's flies practise on
// the photos in proportion to those weights: the swarm tells newcomers which pictures it finds hard.
// Weights are capped (label noise: a few photos are simply mislabelled, and uncapped boosting would
// chase them). In the end every fly votes with equal, scaled margins, as in tools/swarm.mjs.
//
// Usage: node tools/boost.mjs [--rounds 5] [--per 5] [--alpha 1] [--cap 4] [--circle 10]
//        [--dists 0.9,1,1.1] [--with a,b] [--episodes 150] [--seedbase 0] [--jobs N]
// --alpha 0 is the same swarm without boosting (same seeds, same gaze positions), for comparison.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from '../src/config.js';
import { StimulusSet } from '../src/stimuli.js';
import { setupConfig, DEFAULT_ABILITIES } from '../src/abilities.js';
import { taskSets } from './lib.mjs';
import { trainFly, judge } from './swarm.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

// A training set whose photos are drawn in proportion to weights (within each class; the world still
// shows men and women equally often).
class WeightedSet extends StimulusSet {
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

// ---------------------------------------------------------------- child: one fly
if (args.bfly) {
  const job = JSON.parse(args.bfly);
  const { train, test } = taskSets('faces');
  const set = job.weightsFile ? new WeightedSet(train, JSON.parse(fs.readFileSync(job.weightsFile, 'utf8'))) : train;
  const fly = trainFly(job.cfg, set, job.seed, job.episodes);
  process.stdout.write(JSON.stringify({ test: judge(job.cfg, test, fly, 2, job.seed), train: judge(job.cfg, train, fly, 1, job.seed + 7000) }));
  process.exit(0);
}

// ---------------------------------------------------------------- parent
const rounds = +(args.rounds || 5), per = +(args.per || 5), K = rounds * per;
const alpha = +(args.alpha ?? 1), cap = +(args.cap || 4), R = +(args.circle ?? 10);
const abil = args.with ? Object.fromEntries(args.with.split(',').map((k) => [k, true])) : { ...DEFAULT_ABILITIES, fovea: true };
const base = mergeConfig(setupConfig('faces', abil));
const jobsMax = +(args.jobs || Math.max(1, os.cpus().length - 1));
const { train, test } = taskSets('faces');
const nTr = train.labels.length, nTe = test.labels.length;
const self = fileURLToPath(import.meta.url);
const runOne = (job) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [self, '--bfly', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error('fly failed'))));
});
// fly (round r, j) sits at angle 2*pi*(j*rounds + r)/K: every round covers the whole circle
// --dists 0.9,1,1.1: the flies also look from different distances (fly k at distance dists[k mod n]): one more way for the swarm to see differently
const dists = args.dists ? args.dists.split(',').map(Number) : null;
const spot = (r, j) => { const k = j * rounds + r, a = (2 * Math.PI * k) / K, scr = {}; if (R) { scr.centerAzDeg = R * Math.cos(a); scr.centerElDeg = R * Math.sin(a); } if (dists) scr.distance = dists[k % dists.length]; return Object.keys(scr).length ? { screen: scr } : {}; };

const flies = [];
// the weights reach each fly through a file (too long for a command line)
let weightsFile = null;
const pct = (x) => (x * 100).toFixed(1) + '%';
const bal = (labels, score) => { const ok = [0, 0], t = [0, 0]; labels.forEach((y, i) => { t[y]++; if ((score(i) > 0 ? 1 : 0) === y) ok[y]++; }); return (ok[0] / t[0] + ok[1] / t[1]) / 2; };
const t0 = Date.now();
console.log(`boosting swarm: ${rounds} rounds x ${per} flies, alpha ${alpha}, weight cap ${cap}x, gaze circle ${R} deg`);
for (let r = 0; r < rounds; r++) {
  const jobs = Array.from({ length: per }, (_, j) => ({ seed: 1 + r * per + j + (+args.seedbase || 0), episodes: +(args.episodes || 150), cfg: mergeConfig(spot(r, j), base), weightsFile }));
  const out = new Array(per);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobsMax, per) }, async () => { while (next < per) { const j = next++; out[j] = await runOne(jobs[j]); } }));
  const wNow = weightsFile ? JSON.parse(fs.readFileSync(weightsFile, 'utf8')) : new Array(nTr).fill(1);
  for (const o of out) {
    // each fly's margins scaled by its own typical size on the training photos (no exam labels used)
    const m = o.train.margin, sd = Math.sqrt(m.reduce((s, v) => s + v * v, 0) / m.length) || 1;
    // AdaBoost's say for this fly: from its error on the photos as weighted when it practised
    let e = 0, tot = 0;
    m.forEach((v, i) => { tot += wNow[i]; if ((v > 0 ? 1 : 0) !== train.labels[i]) e += wNow[i]; });
    e = Math.min(0.999, Math.max(0.001, e / tot));
    flies.push({ say: Math.max(0, 0.5 * Math.log((1 - e) / e)), err: e, tr: m.map((v) => v / sd), te: Array.from({ length: nTe }, (_, i) => (o.test.margin[2 * i] + o.test.margin[2 * i + 1]) / sd) });
  }
  const sumSay = flies.reduce((s, f) => s + f.say, 0) || 1;
  const F = (i) => flies.reduce((s, f) => s + f.say * f.tr[i], 0) / sumSay; // the swarm's weighted opinion
  const vote = (i) => flies.reduce((s, f) => s + f.te[i], 0);
  const voteSay = (i) => flies.reduce((s, f) => s + f.say * f.te[i], 0);
  const L = Array.from(test.labels);
  const one = flies.slice(-per).map((f) => bal(L, (i) => f.te[i]));
  console.log(`round ${r + 1}: new flies alone ${pct(one.reduce((a, b) => a + b, 0) / per)} (their weighted practice error ${flies.slice(-per).map((f) => (f.err * 100).toFixed(0) + '%').join(' ')}) | swarm of ${flies.length}: equal votes ${pct(bal(L, vote))}, AdaBoost votes ${pct(bal(L, voteSay))}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  if (alpha > 0) {
    // AdaBoost weights from the swarm so far, capped, normalised to mean 1 within each class
    const w = Array.from({ length: nTr }, (_, i) => Math.exp(-alpha * (train.labels[i] ? 1 : -1) * F(i)));
    for (const y of [0, 1]) {
      const idx = [...Array(nTr).keys()].filter((i) => train.labels[i] === y);
      let mean = idx.reduce((s, i) => s + w[i], 0) / idx.length;
      for (const i of idx) w[i] = Math.min(cap, w[i] / mean);
      mean = idx.reduce((s, i) => s + w[i], 0) / idx.length;
      for (const i of idx) w[i] /= mean;
    }
    weightsFile = path.join(os.tmpdir(), 'flylab-boost-' + process.pid + '-' + r + '.json');
    fs.writeFileSync(weightsFile, JSON.stringify(w));
    const sorted = [...w].sort((a, b) => a - b);
    console.log(`  next round practises with weights: median ${sorted[nTr >> 1].toFixed(2)}, top 10% above ${sorted[Math.floor(nTr * 0.9)].toFixed(2)}, ${w.filter((v) => v >= cap / 1.2).length} photos near the cap`);
  }
}
