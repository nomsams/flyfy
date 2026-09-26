// One fly, no evolution: it learns only from reward and pain, over its lifetime (its learned
// synapses are kept across episodes). Prints accuracy per block of episodes.
// Usage: node test/life.test.mjs [mode] [episodes] ['{"learn":{...},"pain":{...}}']
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/config.js';
import { StimulusSet } from '../src/stimuli.js';
import { Runner } from '../src/rollout.js';

const mode = process.argv[2] || 'gratings';
const episodes = +(process.argv[3] || 60);
const over = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const cfg = mergeConfig(over);
const runner = new Runner(cfg, new StimulusSet(mode));
const theta = runner.brain.initParams(1);
const BLOCK = 10;

let cues = 0, correct = 0, left = 0, right = 0, answered = 0, ret = 0, prem = 0;
const t0 = performance.now();
const rows = [];
for (let ep = 1; ep <= episodes; ep++) {
  ret += runner.episode(ep === 1 ? theta : null, 5000 + ep, null, ep > 1);
  const w = runner.world;
  cues += w.trials + w.misses; answered += w.trials; correct += w.correct; left += w.resp[0]; right += w.resp[1]; prem += w.premature;
  if (ep % BLOCK === 0) {
    const acc = correct / Math.max(1, cues);
    rows.push(acc);
    console.log(`episodes ${String(ep - BLOCK + 1).padStart(3)}-${String(ep).padStart(3)}  correct ${(acc * 100).toFixed(0)}% of ${cues} images  answered ${(100 * answered / Math.max(1, cues)).toFixed(0)}%  left ${(100 * left / Math.max(1, left + right)).toFixed(0)}%  return/ep ${(ret / BLOCK).toFixed(1)}  premature/ep ${(prem / BLOCK).toFixed(1)}`);
    cues = correct = left = right = answered = ret = prem = 0;
  }
}
console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);

// A fly with no evolution at all must learn the easy tasks purely from reward and pain.
if (!process.argv[4]) {
  const last = rows[rows.length - 1];
  if (mode === 'brightness') assert.ok(last > 0.9, 'brightness ' + last);
  if (mode === 'gratings') assert.ok(last > 0.7, 'gratings ' + last);
  if (mode === 'brightness' || mode === 'gratings') console.log('learned from reward and pain alone');
}
