// Runs whole episodes: brain <-> world. Shared by the Web Worker, the
// on-screen "watch" view and the Node tests, so they cannot disagree.

import { TrialWorld } from './world.js';
import { Brain } from './brain.js';

export class Runner {
  constructor(cfg, stim) {
    this.cfg = cfg;
    this.stim = stim;
    this.world = new TrialWorld(cfg);
    this.brain = new Brain(cfg);
    this.steps = 0;
  }

  episode(params, seed, hook = null) {
    const { world, brain } = this;
    brain.setParams(params);
    brain.reset();
    world.reset(seed, this.stim);
    let ret = 0;
    while (!world.done) {
      const o = brain.step(world.retinas, world.touch);
      ret += world.step(o[0], o[1]);
      this.steps++;
      if (hook) hook(world, brain);
    }
    return ret;
  }

  // Mean return over `seeds`, plus trial statistics.
  evaluate(params, seeds) {
    let ret = 0, trials = 0, correct = 0, premature = 0, misses = 0;
    for (const s of seeds) {
      ret += this.episode(params, s);
      trials += this.world.trials; correct += this.world.correct;
      premature += this.world.premature; misses += this.world.misses;
    }
    return { fitness: ret / seeds.length, trials, correct, premature, misses };
  }
}
