// Runs whole episodes: brain <-> world. Shared by the Web Worker, the
// on-screen "watch" view and the Node tests, so they cannot disagree.

import { TrialWorld, EVENT } from './world.js';
import { Brain } from './brain.js';

export class Runner {
  constructor(cfg, stim) {
    this.cfg = cfg;
    this.stim = stim;
    this.world = new TrialWorld(cfg);
    this.brain = new Brain(cfg);
    this.steps = 0;
  }

  // One simulation step: brain -> feet -> world -> (reward or pain) -> fast learning.
  step() {
    const { world, brain } = this;
    const o = brain.step(world.retinas, world.touch, world.pain);
    const r = world.step(o[0], o[1]);
    const ev = world.lastEvent;
    if (ev === EVENT.CORRECT || ev === EVENT.WRONG) brain.learn(world.lastFoot, ev === EVENT.CORRECT);
    else if (ev === EVENT.PREMATURE) brain.punish(world.lastPress);
    this.steps++;
    return r;
  }

  // keepPlastic = true continues one fly's life across episodes (what it learned is kept).
  episode(params, seed, hook = null, keepPlastic = false) {
    const { world, brain } = this;
    if (params) brain.setParams(params);
    brain.reset(keepPlastic);
    world.reset(seed, this.stim);
    let ret = 0;
    while (!world.done) {
      ret += this.step();
      if (hook) hook(world, brain);
    }
    return ret;
  }

  // Mean return over `seeds`, plus trial statistics, foot usage and the per-episode
  // reward ledger (where the return came from).
  evaluate(params, seeds) {
    let ret = 0, trials = 0, correct = 0, premature = 0, misses = 0, left = 0, right = 0;
    const parts = {};
    for (const s of seeds) {
      ret += this.episode(params, s);
      const w = this.world;
      trials += w.trials; correct += w.correct; premature += w.premature; misses += w.misses;
      left += w.resp[0]; right += w.resp[1];
      for (const k in w.parts) parts[k] = (parts[k] || 0) + w.parts[k] / seeds.length;
    }
    // cues = every image shown (answered + timed out). Accuracy must count misses: a fly that
    // only answers the cues it is sure of would otherwise look perfect.
    return { fitness: ret / seeds.length, trials, cues: trials + misses, correct, premature, misses, left, right, parts };
  }
}
