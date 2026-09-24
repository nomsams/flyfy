import assert from 'node:assert/strict';
import { DEFAULTS, mergeConfig } from '../src/config.js';
import { StimulusSet } from '../src/stimuli.js';
import { TrialWorld, EVENT } from '../src/world.js';
import { Brain } from '../src/brain.js';
import { Runner } from '../src/rollout.js';

const cfg = mergeConfig({});
const stim = new StimulusSet('brightness');
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('ok  -', name); };

ok('episode is deterministic for a seed', () => {
  const brain = new Brain(cfg);
  const p = brain.initParams(3);
  const a = new Runner(cfg, stim).evaluate(p, [11, 12]);
  const b = new Runner(cfg, stim).evaluate(p, [11, 12]);
  assert.deepEqual(a, b);
});

ok('feet score a response: correct foot = correct, other = wrong', () => {
  const w = new TrialWorld(cfg);
  for (const foot of [0, 1]) {
    w.reset(5, stim);
    // wait through the ITI until a stimulus is on screen
    let guard = 0;
    while (w.phase !== 'stim' && guard++ < 100) w.step(-1, -1);
    assert.equal(w.phase, 'stim');
    const label = w.label;
    const press = foot === 0 ? [1, -1] : [-1, 1];
    w.step(...press);           // press
    assert.equal(w.touch[foot], 1);
    w.step(-1, -1);             // release -> scored
    assert.equal(w.lastEvent, foot === label ? EVENT.CORRECT : EVENT.WRONG);
    assert.equal(w.phase, 'iti');
    assert.equal(w.trials, 1);
  }
});

ok('responding to a blank screen is premature, not a trial', () => {
  const w = new TrialWorld(cfg);
  w.reset(1, stim);
  w.step(1, -1);
  w.step(-1, -1);
  assert.equal(w.lastEvent, EVENT.PREMATURE);
  assert.equal(w.trials, 0);
});

ok('unanswered cue times out as a miss', () => {
  const w = new TrialWorld(cfg);
  w.reset(2, stim);
  let sawMiss = false;
  for (let i = 0; i < 100 && !sawMiss; i++) { w.step(-1, -1); sawMiss = w.lastEvent === EVENT.MISS; }
  assert.ok(sawMiss);
});

ok('retina shows the screen only while a cue is up', () => {
  const w = new TrialWorld(cfg);
  w.reset(9, stim);
  const spread = (L) => Math.max(...L) - Math.min(...L);
  assert.equal(spread(w.retinas[0]), 0, 'blank screen = uniform retina');
  while (w.phase !== 'stim') w.step(-1, -1);
  for (let i = 0; i < 8; i++) w.step(-1, -1);   // let the onset finish
  const mean = w.retinas[0].reduce((a, b) => a + b, 0) / w.retinas[0].length;
  assert.ok(mean > cfg.eye.background + 0.02 || w.label === 0, 'bright cue raises retinal mean');
});

ok('LC types respond to what they should', () => {
  const brain = new Brain(cfg);
  const w = new TrialWorld(cfg);
  brain.reset();
  w.reset(21, stim);
  const lc = brain.lc[0];
  const range = (name) => lc.types.find((t) => t.name === name);
  const peak = (name) => {
    const t = range(name);
    return Math.max(...lc.out.subarray(t.start, t.start + t.count));
  };
  let onsetLoom = 0, onsetLC4 = 0, steadyLoom = 0, steadyLC4 = 0, steadyStatic = 0;
  let inStim = 0;
  for (let i = 0; i < 40; i++) {
    brain.step(w.retinas, w.touch);
    w.step(-1, -1);
    if (w.phase === 'stim') {
      inStim++;
      if (w.phaseT <= cfg.timing.onsetSec + 0.1) {
        onsetLoom = Math.max(onsetLoom, peak('LPLC2'));
        onsetLC4 = Math.max(onsetLC4, peak('LC4'));
      } else if (inStim > 12) {
        steadyLoom = Math.max(steadyLoom, peak('LPLC2'));
        steadyLC4 = Math.max(steadyLC4, peak('LC4'));
        steadyStatic = Math.max(steadyStatic, peak('LUM'), peak('LC11'), peak('LC_ON'));
      }
    }
  }
  console.log(`      onset   LPLC2 ${onsetLoom.toFixed(3)}  LC4 ${onsetLC4.toFixed(3)}`);
  console.log(`      steady  LPLC2 ${steadyLoom.toFixed(3)}  LC4 ${steadyLC4.toFixed(3)}  static ${steadyStatic.toFixed(3)}`);
  assert.ok(onsetLoom > 0.2, 'LPLC2 fires when the image expands into view');
  assert.ok(onsetLoom > 5 * steadyLoom, 'LPLC2 is quiet on a static image');
  assert.ok(steadyStatic > 0.05, 'static LC types carry the image');
});

ok('two-eye layouts: split gives each eye its own side of the screen', () => {
  const lit = (retina, C, from, to) => { let n = 0; for (let i = 0; i < retina.length; i++) { const c = i % C; if (c >= from && c < to && retina[i] > 0.3) n++; } return n; };
  for (const layout of ['overlap', 'split']) {
    const c2 = mergeConfig({ eye: { eyes: 2, layout } });
    const w = new TrialWorld(c2);
    w.reset(1, new StimulusSet('brightness'));
    let g = 0;
    while (w.phase !== 'stim' && g++ < 100) w.step(-1, -1);
    while (w.scale() < 1) w.step(-1, -1);
    const C = w.C, [l, r] = w.retinas;
    // left eye (0): screen sits to its right, so it sees its own inner edge lit; mirrored for the right eye
    const left = { inner: lit(l, C, C >> 1, C), outer: lit(l, C, 0, C >> 1) };
    const right = { inner: lit(r, C, 0, C >> 1), outer: lit(r, C, C >> 1, C) };
    assert.ok(left.outer <= left.inner && right.outer <= right.inner, layout + ': screen is on the inner side of each eye');
    if (layout === 'split') assert.ok(left.outer === 0 && right.outer === 0 || left.inner > 3 * left.outer, 'split: eyes are clearly off-axis');
  }
});

ok('size + speed', () => {
  const r = new Runner(cfg, stim);
  const p = r.brain.initParams(1);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) r.episode(p, i);
  const sec = (performance.now() - t0) / 1000;
  console.log(`      neurons=${r.brain.neuronCount} (LC ${r.brain.nLC}, core ${r.brain.N}, out 2)  params=${r.brain.paramCount}`);
  console.log(`      ${(r.steps / sec / 1000).toFixed(0)}k steps/s on one thread`);
});

console.log(`\n${passed} passed`);
