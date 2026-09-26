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
    while (w.phaseT < cfg.timing.reactionSec) w.step(-1, -1);   // let the image finish appearing
    const label = w.label;
    const press = foot === 0 ? [1, -1] : [-1, 1];
    w.step(...press);           // a press is the answer, scored immediately
    assert.equal(w.touch[foot], 1);
    assert.equal(w.lastEvent, foot === label ? EVENT.CORRECT : EVENT.WRONG);
    assert.equal(w.phase, 'iti');
    assert.equal(w.trials, 1);
  }
});

ok('responding to a blank screen is premature, not a trial', () => {
  const w = new TrialWorld(cfg);
  w.reset(1, stim);
  w.step(1, -1);
  assert.equal(w.lastEvent, EVENT.PREMATURE);
  assert.equal(w.trials, 0);
});

ok('free response: an unanswered cue times out as a miss', () => {
  const w = new TrialWorld(mergeConfig({ timing: { forceAtSec: 0 } }));
  w.reset(2, stim);
  let sawMiss = false;
  for (let i = 0; i < 100 && !sawMiss; i++) { w.step(-1, -1); sawMiss = w.lastEvent === EVENT.MISS; }
  assert.ok(sawMiss);
});

ok('forced choice: no press by forceAtSec = the stronger foot is pressed for the fly', () => {
  for (const strong of [0, 1]) {
    const w = new TrialWorld(cfg);
    w.reset(6, stim);
    let g = 0;
    while (w.phase !== 'stim' && g++ < 100) w.step(-1, -1);
    const label = w.label;
    let steps = 0;
    while (w.phase === 'stim' && steps++ < 40) w.step(strong === 0 ? 0.2 : -0.5, strong === 1 ? 0.2 : -0.5); // both below the press threshold
    assert.equal(w.trials, 1, 'answered without ever crossing the threshold');
    assert.equal(w.misses, 0);
    assert.equal(w.resp[strong], 1, 'the stronger foot answered');
    assert.equal(w.lastEvent, strong === label ? EVENT.CORRECT : EVENT.WRONG);
    assert.ok(w.phaseT >= 0, 'sane');
  }
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
  const w = new TrialWorld(mergeConfig({ timing: { forceAtSec: 0 } })); // nobody answers: the image just stays up
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

ok('pain: a wrong answer hurts that foot, then fades; a right one does not', () => {
  const w = new TrialWorld(cfg);
  for (const wrong of [true, false]) {
    w.reset(9, stim);
    let g = 0;
    while (w.phase !== 'stim' && g++ < 100) w.step(-1, -1);
    while (w.phaseT < cfg.timing.reactionSec) w.step(-1, -1);
    const foot = wrong ? 1 - w.label : w.label;
    const press = foot === 0 ? [1, -1] : [-1, 1];
    w.step(...press);
    if (wrong) {
      assert.equal(w.pain[foot], cfg.pain.strength, 'pressed foot feels pain');
      assert.equal(w.pain[1 - foot], 0, 'other foot does not');
      for (let i = 0; i < 60; i++) w.step(-1, -1);
      assert.ok(w.pain[foot] < 0.01, 'pain fades');
    } else assert.equal(w.pain[0] + w.pain[1], 0, 'no pain for a correct answer');
  }
});

ok('ledger adds up to the return; repeat penalty only after repeatFree in a row', () => {
  const r = new Runner(cfg, stim);
  const p = r.brain.initParams(4);
  const ret = r.episode(p, 21);
  const sum = Object.values(r.world.parts).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(ret - sum) < 1e-6, 'ledger ' + sum + ' vs return ' + ret);
  const w = new TrialWorld(cfg);
  w.reset(3, stim);
  let answers = 0, g = 0;
  while (answers < 4 && g++ < 2000) {
    if (w.phase === 'stim' && w.phaseT >= cfg.timing.reactionSec) { w.step(1, -1); w.step(-1, -1); answers++; } else w.step(-1, -1); // press answers, then release re-arms
  }
  assert.equal(w.resp[0], 4);
  assert.equal(w.parts.repeat, cfg.reward.repeat * (4 - cfg.reward.repeatFree), 'answers 3 and 4 with the same foot are charged');
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
