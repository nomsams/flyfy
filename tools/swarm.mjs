// A swarm of flies deciding together. Trains K flies (Quick learn), then shows every fly the SAME
// held-out photos, several "looks" each, and records each answer and its margin (how far the chosen
// foot's output led the other). From that one table it reports:
//   - one fly, one look                 (the usual exam)
//   - one fly, several looks            (mirrored / slightly nearer or further; margins summed)
//   - swarms of 3, 5, 9, ... flies      (majority vote, and margin-weighted vote)
//   - how alike the flies' mistakes are (a swarm only helps if they differ)
//
// Usage: node tools/swarm.mjs [--flies 9] [--looks 4] [--wiring same|own] [--task faces]
//        [--with a,b] (abilities; default = the app's defaults) [--cfg JSON] [--episodes 150]
//        [--circle R] (each fly its own centre of gaze on a circle, degrees) [--lookset tolerance|jitter] [--rings 0,5,10,15]
//        [--judge] (20% of the training photos set aside to fit a judge that combines the votes)
//        [--judge-sizes 5,9,25] (team sizes to judge; small teams drawn several times and averaged)
//        [--out file.json] (raw table, for re-analysis) [--jobs N]
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from '../src/config.js';
import { Runner } from '../src/rollout.js';
import { IMG } from '../src/stimuli.js';
import { mulberry32 } from '../src/rng.js';
import { setupConfig, DEFAULT_ABILITIES } from '../src/abilities.js';
import { taskSets } from './lib.mjs';
import { splitForJudge, judges } from './swarm-judge.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

// the looks: 0 = as is; then mirrored, a little nearer, a little further, and combinations
export const LOOKS = [
  { mirror: false, dist: 1 }, { mirror: true, dist: 1 },
  { mirror: false, dist: 0.9 }, { mirror: true, dist: 0.9 },
  { mirror: false, dist: 1.1 }, { mirror: true, dist: 1.1 },
];
// --lookset tolerance: how far can the view change before the fly stops recognising? (distance
// factors, and sideways shifts in degrees; one sensor gap is 5 degrees)
export const TOLERANCE = [
  { dist: 1 }, { dist: 0.97 }, { dist: 1.03 }, { dist: 0.94 }, { dist: 1.06 }, { dist: 0.9 }, { dist: 1.1 },
  { shift: 1.25 }, { shift: 2.5 }, { shift: 5 },
];
// --lookset jitter: "the loop trick" as whole looks - the view as is, then 8 looks nudged by half a
// sensor gap (2.5 degrees) evenly around a small circle; each fly sums its margins over them
const J = 2.5, D = J * Math.SQRT1_2;
export const JITTER = [
  {}, { shift: J }, { shift: -J }, { shiftEl: J }, { shiftEl: -J },
  { shift: D, shiftEl: D }, { shift: -D, shiftEl: -D }, { shift: D, shiftEl: -D }, { shift: -D, shiftEl: D },
];
const LOOKSETS = { default: LOOKS, tolerance: TOLERANCE, jitter: JITTER };
let LOOKSET = LOOKS;

function mirrored(src, planes) {
  const out = new Float32Array(src.length);
  for (let c = 0; c < planes; c++) for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) {
    out[c * IMG * IMG + y * IMG + x] = src[c * IMG * IMG + y * IMG + (IMG - 1 - x)];
  }
  return out;
}

// Train one fly by reward and pain (as the app's Quick learn does); returns its evolved-free
// parameters and what it learned.
export function trainFly(cfg, train, seed, episodes = 150) {
  const r = new Runner(cfg, train);
  const theta = r.brain.initParams(seed);
  for (let ep = 0; ep < episodes; ep++) r.episode(ep === 0 ? theta : null, seed * 100003 + ep, null, ep > 0);
  return { theta, plastic: r.brain.getPlastic() };
}

// Show a frozen fly each test photo in each look. Returns foot (-1 = no answer) and margin
// (out1 - out0 at the moment of answering) per [photo][look].
export function judge(cfg, test, fly, nLooks, seed = 1) {
  const c = mergeConfig({ ...cfg, learn: { ...cfg.learn, eta: 0 }, screen: { ...cfg.screen, distanceJitter: 0 } });
  const r = new Runner(c, test), w = r.world, b = r.brain;
  b.setParams(fly.theta);
  const n = test.labels.length, planes = test.planes, st = planes * IMG * IMG;
  const foot = new Int8Array(n * nLooks).fill(-1), margin = new Float32Array(n * nLooks);
  const queue = [];
  for (let l = 0; l < nLooks; l++) for (let i = 0; i < n; i++) queue.push(i * nLooks + l);
  // a fixed random order (the same for every fly): the stored photos come sorted by class, and a fly that
  // keeps adapting would otherwise just adapt to "all men" and then "all women"
  { const rq = mulberry32(99); for (let k = queue.length - 1; k > 0; k--) { const j = Math.floor(rq() * (k + 1)); [queue[k], queue[j]] = [queue[j], queue[k]]; } }
  let qi = 0, cur = -1, last = [0, 0];
  const start = w._startTrial.bind(w), answer = w._answer.bind(w), wstep = w.step.bind(w);
  w._startTrial = () => {
    start();
    if (qi >= queue.length) { cur = -1; return; }
    cur = queue[qi++];
    const i = Math.floor(cur / nLooks), look = LOOKSET[cur % nLooks], img = test.images.subarray(i * st, (i + 1) * st);
    w.label = test.labels[i];
    w.image = look.mirror ? mirrored(img, planes) : img;
    w.dist0 = w.dist = (c.screen.distance || 1) * (look.dist || 1);
    w.gazeAz = look.shift || 0; w.gazeEl = look.shiftEl || 0;
    w._feel();
  };
  // margin = the feet's drive before it saturates (the outputs themselves sit at +-1 when answering)
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

// run as a program (not imported by another tool)
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === path.resolve(process.argv[1]).toLowerCase();

// ---------------------------------------------------------------- child: one fly
if (isMain && args.fly) {
  const job = JSON.parse(args.fly);
  LOOKSET = LOOKSETS[job.lookset || 'default'];
  const { train, test } = taskSets(job.task);
  if (job.judge) { // train on 80% of the training photos; answer the other 20% (for the judge) and the exam
    const { flyTrain, judgeSet } = splitForJudge(train);
    const fly = trainFly(job.cfg, flyTrain, job.seed, job.episodes);
    process.stdout.write(JSON.stringify({ test: judge(job.cfg, test, fly, job.looks, job.seed), judge: judge(job.cfg, judgeSet, fly, job.looks, job.seed + 5000) }));
  } else {
    const fly = trainFly(job.cfg, train, job.seed, job.episodes);
    process.stdout.write(JSON.stringify(judge(job.cfg, test, fly, job.looks, job.seed)));
  }
  process.exit(0);
}

// ---------------------------------------------------------------- analysis (exported for re-use)
export function analyse(labels, flies, nLooks, log = console.log) {
  log('(all accuracies balanced: men and women count equally, guessing = 50%)');
  const n = labels.length, K = flies.length, pct = (x) => (x * 100).toFixed(1) + '%';
  const says = (fly, i, looks, weighted) => { // the fly's answer on photo i from its first `looks` looks
    let s = 0;
    for (let l = 0; l < looks; l++) { const k = i * nLooks + l; if (fly.foot[k] >= 0) s += weighted ? fly.margin[k] : fly.foot[k] ? 1 : -1; }
    return s > 0 ? 1 : s < 0 ? 0 : fly.foot[i * nLooks]; // a tie: the first look decides
  };
  // balanced accuracy: men and women count equally (the held-out photos keep the dataset's 57% women,
  // so plain accuracy would reward leaning on "woman"; this way guessing scores 50%, as in the exam)
  const perClass = [0, 0];
  for (const y of labels) perClass[y]++;
  const acc = (fn) => { const ok = [0, 0]; for (let i = 0; i < n; i++) if (fn(i) === labels[i]) ok[labels[i]]++; return (ok[0] / perClass[0] + ok[1] / perClass[1]) / 2; };
  const res = { single: [], looks: {}, swarm: {}, corr: 0 };
  res.single = flies.map((f) => acc((i) => says(f, i, 1, false)));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length, sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
  log(`one fly, one look:  ${pct(mean(res.single))} (flies ${res.single.map((a) => (a * 100).toFixed(0)).join(' ')}, sd ${(sd(res.single) * 100).toFixed(1)})`);
  const lookAcc = (l) => mean(flies.map((f) => acc((i) => f.foot[i * nLooks + l])));
  const ansRate = (l) => mean(flies.map((f) => { let a = 0; for (let i = 0; i < n; i++) a += f.foot[i * nLooks + l] >= 0 ? 1 : 0; return a / n; }));
  const names = LOOKSETS[args.lookset || 'default'].slice(0, nLooks).map((l) => (l.shift || l.shiftEl) ? `shift ${(l.shift || 0).toFixed(1)},${(l.shiftEl || 0).toFixed(1)}deg` : (l.mirror ? 'mirror ' : '') + 'x' + (l.dist || 1));
  log('each look alone: ' + Array.from({ length: nLooks }, (_, l) => names[l] + ' ' + pct(lookAcc(l))).join(', '));
  for (let L = 2; L <= nLooks; L++) {
    res.looks[L] = mean(flies.map((f) => acc((i) => says(f, i, L, true))));
    log(`one fly, ${L} looks:  ${pct(res.looks[L])}  (margins summed)`);
  }
  // mistakes alike? correlation of right/wrong between pairs of flies
  const right = flies.map((f) => Array.from({ length: n }, (_, i) => (says(f, i, 1, false) === labels[i] ? 1 : 0)));
  let cs = 0, cn = 0;
  for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) {
    const ma = mean(right[a]), mb = mean(right[b]);
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < n; i++) { cov += (right[a][i] - ma) * (right[b][i] - mb); va += (right[a][i] - ma) ** 2; vb += (right[b][i] - mb) ** 2; }
    cs += cov / Math.sqrt(va * vb + 1e-12); cn++;
  }
  res.corr = cn ? cs / cn : 0;
  log(`mistakes alike: correlation ${res.corr.toFixed(2)} between flies (0 = independent, 1 = identical)`);
  const rng = mulberry32(3);
  for (const k of [3, 5, 9, 15, 25, 51, 101].filter((k) => k <= K)) {
    const reps = k === K ? 1 : 20, r = { vote: 0, weighted: 0, weightedLooks: 0 };
    for (let rep = 0; rep < reps; rep++) {
      const idx = Array.from({ length: K }, (_, i) => i);
      for (let i = K - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const team = idx.slice(0, k).map((i) => flies[i]);
      const vote = (i, looks, weighted) => {
        let s = 0;
        for (const f of team) for (let l = 0; l < looks; l++) { const q = i * nLooks + l; if (f.foot[q] >= 0) s += weighted ? f.margin[q] : f.foot[q] ? 1 : -1; }
        return s > 0 ? 1 : s < 0 ? 0 : team[0].foot[i * nLooks];
      };
      r.vote += acc((i) => vote(i, 1, false)) / reps;
      r.weighted += acc((i) => vote(i, 1, true)) / reps;
      r.weightedLooks += acc((i) => vote(i, nLooks, true)) / reps;
    }
    res.swarm[k] = r;
    log(`swarm of ${String(k).padStart(2)}: majority ${pct(r.vote)}, margin-weighted ${pct(r.weighted)}, margin-weighted with ${nLooks} looks each ${pct(r.weightedLooks)}`);
  }
  return res;
}

// ---------------------------------------------------------------- parent
if (isMain) {
const task = args.task || 'faces', K = +(args.flies || 9), nLooks = args.lookset && args.lookset !== 'default' ? LOOKSETS[args.lookset].length : Math.min(LOOKS.length, +(args.looks || 4));
const abil = args.with ? Object.fromEntries(args.with.split(',').map((k) => [k, true])) : DEFAULT_ABILITIES;
const base = mergeConfig(JSON.parse(args.cfg || '{}'), mergeConfig(setupConfig(task, abil)));
const jobsMax = +(args.jobs || Math.max(1, os.cpus().length - 1));
// --circle R: each fly looks at a different point of a circle of radius R degrees around the picture's
// centre (fly k at angle 2*pi*k/K) - trained and examined from that viewpoint, so the swarm sees
// the face from K different centres of gaze instead of K copies of the same view.
const R = +(args.circle || 0);
// --rings 0,5,10,15: several circles instead of one; flies shared out in proportion to each ring's
// size (a ring of radius 0 is one fly at the centre), each ring turned a little so no two line up
const spots = [];
if (args.rings) {
  const radii = args.rings.split(',').map(Number), centre = radii.includes(0) ? 1 : 0, rs = radii.filter((r) => r > 0);
  if (centre) spots.push([0, 0]);
  const tot = rs.reduce((a, b) => a + b, 0);
  let left = K - centre;
  rs.forEach((r, j) => {
    const n = j === rs.length - 1 ? left : Math.round(((K - centre) * r) / tot);
    left -= n;
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * (i + 0.5 * j)) / n; spots.push([r * Math.cos(a), r * Math.sin(a)]); }
  });
} else for (let s = 0; s < K; s++) spots.push(R ? [R * Math.cos((2 * Math.PI * s) / K), R * Math.sin((2 * Math.PI * s) / K)] : [0, 0]);
const view = (s) => (spots[s][0] || spots[s][1] ? { screen: { centerAzDeg: spots[s][0], centerElDeg: spots[s][1] } } : {});
const jobs = Array.from({ length: K }, (_, s) => ({
  task, seed: s + 1 + (+args.seedbase || 0), looks: nLooks, lookset: args.lookset, episodes: +(args.episodes || 150), judge: !!args.judge,
  cfg: mergeConfig({ ...view(s), ...(args.wiring === 'own' ? { brain: { netSeed: 12345 + 7919 * (s + 1) } } : {}) }, base),
}));
const self = fileURLToPath(import.meta.url);
const runOne = (job) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [self, '--fly', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error('fly failed: ' + job.seed))));
});
const t0 = Date.now(), results = new Array(K);
let next = 0;
await Promise.all(Array.from({ length: Math.min(jobsMax, K) }, async () => { while (next < K) { const j = next++; results[j] = await runOne(jobs[j]); } }));
const { test } = taskSets(task);
console.log(`${task}: ${K} flies (${args.wiring === 'own' ? 'each its own wiring' : 'shared wiring'}${args.rings ? ', gaze centres on rings ' + args.rings + ' deg' : R ? ', gaze centres on a circle of ' + R + ' deg' : ''}), ${test.labels.length} test photos x ${nLooks} looks, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
const testFlies = args.judge ? results.map((r) => r.test) : results;
analyse(Array.from(test.labels), testFlies, nLooks);
let jl = null;
if (args.judge) { // the judge: fitted on the set-aside photos, scored on the exam, for a few swarm sizes
  jl = Array.from(splitForJudge(taskSets(task).train).judgeSet.labels);
  const jf = results.map((r) => r.judge), rng = mulberry32(8);
  // --judge-sizes 5,9,25: team sizes to judge; small teams are drawn several times and averaged
  const sizes = (args['judge-sizes'] || '9,25,' + K).split(',').map(Number).filter((k, i, a) => k <= K && a.indexOf(k) === i);
  const summary = [];
  for (const k of sizes) {
    const reps = k === K ? 1 : k <= 25 ? 5 : 3, sum = {};
    for (let rep = 0; rep < reps; rep++) {
      const idx = Array.from({ length: K }, (_, i) => i);
      for (let i = K - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const team = idx.slice(0, k);
      const quiet = reps > 1 && rep > 0 ? () => {} : console.log;
      if (rep === 0) console.log('\nswarm of ' + k + (reps > 1 ? ' (first of ' + reps + ' random teams shown; averages below)' : '') + ':');
      const r = judges(jl, team.map((i) => jf[i]), Array.from(test.labels), team.map((i) => testFlies[i]), nLooks, quiet);
      for (const [name, v] of Object.entries(r)) { const key = name.replace(/ \(L2 [^)]*\)/, ''); sum[key] = (sum[key] || 0) + v / reps; }
    }
    summary.push([k, reps, sum]);
  }
  console.log('\naverage over random teams (balanced exam accuracy):');
  const names = Object.keys(summary[0][2]);
  console.log('  ' + 'flies'.padEnd(8) + names.map((n) => n.slice(0, 22).padStart(24)).join(''));
  for (const [k, reps, sum] of summary) console.log('  ' + (k + ' (x' + reps + ')').padEnd(8) + names.map((n) => ((sum[n] * 100).toFixed(1) + '%').padStart(24)).join(''));
}
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ labels: Array.from(test.labels), nLooks, flies: testFlies, judgeLabels: jl, judgeFlies: args.judge ? results.map((r) => r.judge) : null, args }));
}
