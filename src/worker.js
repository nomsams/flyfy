// Web Worker: evaluates candidate brains for evolution, and runs whole Compare-tab trials.
// One of these per CPU core.

import { StimulusSet } from './stimuli.js';
import { Runner } from './rollout.js';
import { runTrial } from './experiment.js';
import { flyJob } from './swarm.js';

let runner = null;

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      runner = new Runner(m.cfg, StimulusSet.fromMessage(m.stim));
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'setcfg') {
      // whichever config groups changed -- all are read fresh every step, so this is immediate
      const { type, ...groups } = m;
      for (const g in groups) runner.cfg[g] = { ...runner.cfg[g], ...groups[g] };
    } else if (m.type === 'setwiring') {
      runner.brain.setWiring(m.wiring);
    } else if (m.type === 'eval') {
      const results = m.params.map((p) => runner.evaluate(p, m.seeds));
      self.postMessage({ type: 'result', id: m.id, results });
    } else if (m.type === 'swarmfly') {
      // one member of a swarm: train it (on weighted photos when boosting), answer the exam photos, return its votes
      let last = 0;
      const res = flyJob({
        cfg: m.cfg, train: StimulusSet.fromMessage(m.train), test: StimulusSet.fromMessage(m.test), seed: m.seed, episodes: m.episodes, looks: m.looks,
        weights: m.weights || null, trainMargins: !!m.trainMargins,
        onProgress: (f) => { if (f - last >= 0.05 || f === 1) { last = f; self.postMessage({ type: 'progress', id: m.id, frac: f }); } },
      });
      self.postMessage({ type: 'result', id: m.id, results: res });
    } else if (m.type === 'trial') {
      let last = 0;
      const res = runTrial({
        cfg: m.cfg, train: StimulusSet.fromMessage(m.train), test: StimulusSet.fromMessage(m.test),
        method: m.method, seed: m.seed, budget: m.budget,
        onProgress: (f) => { if (f - last >= 0.05 || f === 1) { last = f; self.postMessage({ type: 'progress', id: m.id, frac: f }); } },
      });
      self.postMessage({ type: 'result', id: m.id, results: res });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
  }
};
