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
