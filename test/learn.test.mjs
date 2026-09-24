// Trains on a procedural task and checks that the fly actually gets better.
// Usage: node test/learn.test.mjs [mode] [generations] [pairs]
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/config.js';
import { StimulusSet } from '../src/stimuli.js';
import { Runner } from '../src/rollout.js';
import { ES } from '../src/es.js';

const mode = process.argv[2] || 'brightness';
const gens = +(process.argv[3] || 40);
const pairs = +(process.argv[4] || 16);
const margin = process.argv[5] === undefined ? undefined : +process.argv[5];
const cfg = mergeConfig({ es: { pairs }, ...(margin === undefined ? {} : { reward: { marginPerSec: margin } }) });
const stim = new StimulusSet(mode);
const runner = new Runner(cfg, stim);
const es = new ES(runner.brain.initParams(1), { ...cfg.es, seed: 7 });

const evalSeeds = Array.from({ length: 12 }, (_, i) => 900000 + i);
const report = (theta) => {
  const r = runner.evaluate(theta, evalSeeds);
  return { ...r, acc: r.trials ? r.correct / r.trials : 0 };
};

const first = report(es.theta);
console.log(`gen   0  return ${first.fitness.toFixed(1).padStart(7)}  acc ${(first.acc * 100).toFixed(0)}%  trials/ep ${(first.trials / 12).toFixed(1)}`);
const t0 = performance.now();
let last = first;
for (let g = 1; g <= gens; g++) {
  const seeds = Array.from({ length: cfg.es.episodesPerCandidate }, (_, i) => g * 1000 + i);
  const cands = es.ask();
  const fit = cands.map((c) => runner.evaluate(c, seeds).fitness);
  es.tell(fit);
  if (g % 5 === 0 || g === gens) {
    last = report(es.theta);
    const mean = fit.reduce((a, b) => a + b, 0) / fit.length;
    console.log(`gen ${String(g).padStart(3)}  return ${last.fitness.toFixed(1).padStart(7)}  acc ${(last.acc * 100).toFixed(0)}%  trials/ep ${(last.trials / 12).toFixed(1)}  pop-mean ${mean.toFixed(1)}  ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
}
if (mode === 'brightness') {
  assert.ok(last.fitness > first.fitness + 10, 'return improved');
  assert.ok(last.acc > 0.75, `accuracy ${last.acc} should beat chance clearly on the easy task`);
  console.log('learned the brightness task');
}
