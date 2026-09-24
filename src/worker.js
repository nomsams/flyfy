// Web Worker: evaluates candidate brains. One of these per CPU core.

import { StimulusSet } from './stimuli.js';
import { Runner } from './rollout.js';

let runner = null;

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      runner = new Runner(m.cfg, StimulusSet.fromMessage(m.stim));
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'eval') {
      const results = m.params.map((p) => runner.evaluate(p, m.seeds));
      self.postMessage({ type: 'result', id: m.id, results });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
  }
};
