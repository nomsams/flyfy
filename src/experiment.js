// One fair trial of one setup: a fresh fly from a given seed, trained one of two ways, then
// examined on pictures it never trained on. The Compare tab runs these in Web Workers; the
// command-line tools/compare.mjs runs the very same function, so the two can't disagree.

import { mergeConfig } from './config.js';
import { Runner } from './rollout.js';
import { ES } from './es.js';
import { rewire } from './topology.js';
import { mulberry32 } from './rng.js';

export const METHODS = {
  // learn by pain only: one fly, reward/pain-driven synapses, no evolution
  quick: { episodes: 150 },
  // evolution (with learn-by-pain running inside every episode)
  thorough: { gens: 30, pairs: 16, eps: 4 },
};

const EXAM_EPISODES = 30;

// cfg: config overrides; train/test: StimulusSets; method: 'quick' | 'thorough'.
// Returns { acc, answered, curve } -- acc is correct out of all exam pictures.
export function runTrial({ cfg, train, test, method, seed, budget = {}, onProgress }) {
  const c = mergeConfig(cfg);
  const B = { ...METHODS[method], ...budget };
  const r = new Runner(c, train);
  const curve = [];
  if (method === 'quick') {
    const theta = r.brain.initParams(seed);
    let cues = 0, correct = 0;
    for (let ep = 0; ep < B.episodes; ep++) {
      r.episode(ep === 0 ? theta : null, seed * 100003 + ep, null, ep > 0);
      cues += r.world.trials + r.world.misses; correct += r.world.correct;
      if ((ep + 1) % 10 === 0) { curve.push(cues ? correct / cues : 0); cues = correct = 0; }
      onProgress?.((ep + 1) / B.episodes);
    }
    return { ...exam(c, test, theta, r.brain.getPlastic(), seed, null), curve };
  }
  const es = new ES(r.brain.initParams(seed), { ...c.es, pairs: B.pairs, seed });
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  for (let g = 1; g <= B.gens; g++) {
    const seeds = Array.from({ length: B.eps }, (_, i) => seed * 100003 + g * 101 + i);
    const cands = es.ask();
    es.tell(cands.map((p) => r.evaluate(p, seeds).fitness));
    if (c.es.rewire && g % c.es.rewireEvery === 0) rewire(r.brain, es, c.es.rewireFrac, rng);
    if (g % 5 === 0 || g === B.gens) {
      const ev = r.evaluate(es.theta, [seed * 7 + 1, seed * 7 + 2]);
      curve.push(ev.cues ? ev.correct / ev.cues : 0);
    }
    onProgress?.(g / B.gens);
  }
  return { ...exam(c, test, es.theta, null, seed, r.brain.getWiring()), curve };
}

// The exam: never-seen pictures. A quick-learned fly is frozen (learning off, what it learned
// kept); an evolved fly behaves as evolved (fresh life each episode, learning on inside it).
export function exam(cfg, test, theta, plastic, seed, wiring, episodes = EXAM_EPISODES) {
  const c = mergeConfig({ ...cfg, wiring: wiring || cfg.wiring, learn: { ...cfg.learn, eta: plastic ? 0 : cfg.learn.eta }, screen: { ...cfg.screen, distanceJitter: 0 } });
  const r = new Runner(c, test);
  r.brain.setParams(theta);
  let cues = 0, correct = 0, trials = 0;
  for (let i = 0; i < episodes; i++) {
    const s = 900000 + seed * 1009 + i;
    if (plastic) { r.brain.reset(false); r.brain.setPlastic(plastic); r.episode(null, s, null, true); }
    else r.episode(null, s);
    cues += r.world.trials + r.world.misses; correct += r.world.correct; trials += r.world.trials;
  }
  return { acc: cues ? correct / cues : 0, answered: cues ? trials / cues : 0 };
}
