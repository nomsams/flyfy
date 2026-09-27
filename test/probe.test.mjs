import assert from 'node:assert/strict';
import { mergeConfig } from '../src/config.js';
import { StimulusSet } from '../src/stimuli.js';
import { probeFrontEnd } from '../src/probe.js';
const cfg = mergeConfig({});
for (const mode of ['brightness', 'gratings']) {
  const r = probeFrontEnd(cfg, new StimulusSet(mode), 150);
  console.log(`${mode.padEnd(10)} features=${r.features}  train ${(r.train * 100).toFixed(0)}%  held-out ${(r.test * 100).toFixed(0)}%`);
  assert.ok(r.test > 0.9, mode + ' should be linearly readable from the LC layer');
}

// "The loop trick": summing a fixed classifier's scores over several jittered sub-receptor looks
// at test time should beat a single centred look, on a task that isn't already saturated at 100%.
{
  const stim = new StimulusSet('faint'); // faint, noisy stripes -- hard enough to have room to improve
  const r = probeFrontEnd(cfg, stim, 250, 5, 10);
  console.log(`loop trick   single look ${(r.test * 100).toFixed(0)}%  10 jittered looks summed ${(r.testEnsembled * 100).toFixed(0)}%`);
  assert.ok(r.testEnsembled > r.test + 0.03, `ensembling (${r.testEnsembled}) should beat a single look (${r.test})`);
}
