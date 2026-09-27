// Is setup B better than setup A, or was it luck? Trains a fresh fly for each setup on each of
// several seeds (the same seeds for both, so runs pair up), examines each on never-seen pictures,
// and reports the average difference with a 95% confidence margin. Runs trials in parallel.
//
//   node tools/compare.mjs --task spot --method thorough --seeds 5 \
//        --a '{"eye":{"activeVision":0}}' --b '{"eye":{"activeVision":1}}'
//
// --task      brightness | gratings | faint | spot | faces            (default gratings)
// --method    quick (learn by pain, seconds) | thorough (evolve, minutes)   (default quick)
// --seeds N   repeats per setup (default 5)      --jobs N  parallel processes (default cores-1)
// --gens / --pairs / --episodes   override the method's budget
// --test X    shortcut: A = ability X off, B = ability X on (smartEye, fovea, edges, mood, memory,
//             selfTune, rewire). Every other ability is off unless listed in --with a,b,c.
// --a / --b   extra JSON config overrides on top; --name-a / --name-b labels for the report
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTrial } from '../src/experiment.js';
import { compareRuns, verdict } from '../src/stats.js';
import { mergeConfig } from '../src/config.js';
import { ABILITIES, setupConfig } from '../src/abilities.js';
import { taskSets } from './lib.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

// child mode: run exactly one trial and print its JSON
if (args.one) {
  const job = JSON.parse(args.one);
  const { train, test } = taskSets(job.task);
  const res = runTrial({ cfg: job.cfg, train, test, method: job.method, seed: job.seed, budget: job.budget });
  process.stdout.write(JSON.stringify(res));
  process.exit(0);
}

const task = args.task || 'gratings', method = args.method || 'quick';
const seeds = +(args.seeds || 5), jobsMax = +(args.jobs || Math.max(1, os.cpus().length - 1));
const budget = {};
for (const k of ['gens', 'pairs', 'episodes', 'eps']) if (args[k]) budget[k] = +args[k];
// Every setup starts from the task's own settings (e.g. "find the spot" gives more time to look)
// with every ability off except those in --with, so one comparison isolates one thing.
const withOn = Object.fromEntries((args.with || '').split(',').filter(Boolean).map((k) => [k, true]));
for (const k of [...Object.keys(withOn), args.test].filter(Boolean)) if (!ABILITIES.some((a) => a.id === k)) throw new Error('unknown ability ' + k);
const setup = (abil, json) => mergeConfig(JSON.parse(json || '{}'), mergeConfig(setupConfig(task, abil)));
const A = setup(args.test ? { ...withOn, [args.test]: false } : withOn, args.a);
const B = setup(args.test ? { ...withOn, [args.test]: true } : withOn, args.b);
const nameA = args['name-a'] || (args.test ? 'without ' + args.test : 'A'), nameB = args['name-b'] || (args.test ? 'with ' + args.test : 'B');

const jobs = [];
for (let s = 1; s <= seeds; s++) for (const [who, cfg] of [['A', A], ['B', B]]) jobs.push({ who, seed: s, task, method, budget, cfg });

const self = fileURLToPath(import.meta.url);
const runOne = (job) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [self, '--one', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error('trial failed: ' + JSON.stringify(job)))));
});

const t0 = Date.now();
const results = { A: [], B: [] };
let next = 0, done = 0;
async function lane() {
  while (next < jobs.length) {
    const job = jobs[next++];
    const r = await runOne(job);
    results[job.who][job.seed - 1] = r.acc;
    done++;
    process.stderr.write(`  ${done}/${jobs.length}  ${job.who} seed ${job.seed}: ${(r.acc * 100).toFixed(1)}%   (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobsMax, jobs.length) }, lane));

const r = compareRuns(results.A, results.B);
const pct = (x) => (x * 100).toFixed(1) + '%';
console.log(`\ntask ${task}, ${method}, ${seeds} seeds, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
console.log(`${nameA.padEnd(12)} ${pct(r.meanA)} +- ${pct(r.sdA)}   [${results.A.map(pct).join(', ')}]`);
console.log(`${nameB.padEnd(12)} ${pct(r.meanB)} +- ${pct(r.sdB)}   [${results.B.map(pct).join(', ')}]`);
console.log(`difference   ${(r.diff >= 0 ? '+' : '') + pct(r.diff)} +- ${pct(r.margin)} (95%)`);
console.log(verdict(r, nameA, nameB));
if (args.json) console.log(JSON.stringify({ task, method, seeds, A: results.A, B: results.B, ...r }));
