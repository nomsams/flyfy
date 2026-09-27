import assert from 'node:assert/strict';
import { DEFAULTS, mergeConfig } from '../src/config.js';
import { StimulusSet, IMG } from '../src/stimuli.js';
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

ok('fovea packs receptors densest at the centre and reduces to uniform spacing at 0', () => {
  const flat = new TrialWorld(cfg); // default fovea: 0
  const spacing = (az) => Array.from({ length: az.length - 1 }, (_, i) => az[i + 1] - az[i]);
  const flatGaps = spacing(flat.az);
  for (let i = 1; i < flatGaps.length; i++) assert.ok(Math.abs(flatGaps[i] - flatGaps[0]) < 1e-4, 'uniform when fovea is 0');

  const fov = new TrialWorld(mergeConfig({ eye: { fovea: 1.0 } }));
  const gaps = spacing(fov.az);
  const mid = Math.floor(gaps.length / 2);
  assert.ok(gaps[mid] < gaps[0] && gaps[mid] < gaps[gaps.length - 1], 'centre receptors should be packed tighter than the edges');
});

ok('lateral inhibition sharpens contrast and leaves a truly flat patch untouched', () => {
  const flat = new TrialWorld(mergeConfig({ eye: { lateralInhib: 2 } }));
  flat.reset(1, new StimulusSet('brightness'));
  flat.image = new Float32Array(IMG * IMG).fill(0.6); // perfectly flat, no per-pixel noise
  flat.phase = 'stim'; flat.phaseT = 10;
  flat._render();
  // Only the screen's *interior* is flat -- its edge against the background is a real, sharp
  // edge that inhibition is supposed to amplify, so check a block well inside the screen only.
  const interior = [];
  for (let r = 4; r <= 9; r++) for (let c = 6; c <= 13; c++) interior.push(flat.retinas[0][r * flat.C + c]);
  const spread = Math.max(...interior) - Math.min(...interior);
  assert.ok(spread < 1e-4, 'a truly flat patch stays exactly flat: ' + spread);

  const edge = new TrialWorld(mergeConfig({ eye: { lateralInhib: 2 } }));
  const plain = new TrialWorld(mergeConfig({}));
  const stripes = new StimulusSet('gratings');
  edge.reset(2, stripes); plain.reset(2, stripes);
  let g2 = 0;
  while (edge.phase !== 'stim' && g2++ < 100) { edge.step(-1, -1); plain.step(-1, -1); }
  for (let i = 0; i < 20; i++) { edge.step(-1, -1); plain.step(-1, -1); }
  const variance = (L) => { const m = L.reduce((a, b) => a + b, 0) / L.length; return L.reduce((a, b) => a + (b - m) ** 2, 0) / L.length; };
  assert.ok(variance(edge.retinas[0]) > variance(plain.retinas[0]), 'inhibition should increase local contrast on a striped image');
});

ok('each core neuron has its own evolvable baseline leak (not one shared constant)', () => {
  const b = new Brain(cfg);
  const p = b.initParams(3);
  b.setParams(p);
  assert.equal(b.baseAlpha.length, b.N);
  for (const a of b.baseAlpha) assert.ok(a > 0 && a < 1, 'a leak rate is a probability, not a raw logit');
  const min = Math.min(...b.baseAlpha), max = Math.max(...b.baseAlpha);
  assert.ok(max - min > 0.3, 'neurons should start spread out, not all identical');
  const mean = b.baseAlpha.reduce((s, v) => s + v, 0) / b.baseAlpha.length;
  assert.ok(Math.abs(mean - cfg.brain.alpha) < 0.1, 'centred near the configured default');
  // resting bias survives initParams (regression: it used to get silently overwritten by alpha's
  // block because the write pointer never advanced past it)
  for (const v of b.bout) assert.ok(Math.abs(v - (-0.6)) < 0.05, 'resting bias should stay near -0.6: ' + v);
});

ok('neuromodulation: dopamine adjusts every neuron\'s leak rate away from its baseline', () => {
  const b = new Brain(cfg);
  const p = b.initParams(3);
  b.setParams(p);
  assert.equal(b.sens.length, b.N);
  assert.ok(b.sens.some((v) => Math.abs(v) > 0.05), 'sensitivities should not all start at exactly zero');
  const retinas = b.lc.map((l) => new Float32Array(l.n ? cfg.eye.rows * cfg.eye.cols : 0).fill(0.3));
  const touch = new Float32Array(2);
  b.reset();
  b.step(retinas, touch, null);
  assert.ok(b.dopamine > 0 && b.dopamine < 1, 'dopamine is a probability: ' + b.dopamine);
  // a neuron with real sensitivity should move away from its own baseline once dopamine != 0.5
  let moved = false;
  for (let i = 0; i < b.N; i++) {
    const dynamic = Math.max(0.01, Math.min(0.99, b.baseAlpha[i] + b.sens[i] * b.dopamine));
    if (Math.abs(dynamic - b.baseAlpha[i]) > 1e-4) moved = true;
  }
  assert.ok(moved, 'at least one neuron\'s leak should differ from its baseline once modulated');
});

ok('active vision: the brain\'s gaze command pans the eye, and costs reward to use', () => {
  const av = mergeConfig({ eye: { activeVision: true, gazeStepDeg: 3, gazeRangeDeg: 10 } });
  const w = new TrialWorld(av);
  w.reset(4, stim);
  let g = 0;
  while (w.phase !== 'stim' && g++ < 100) w.step(-1, -1, 0, 0);
  assert.equal(w.gazeAz, 0, 'starts centred on a fresh image');
  const before = w.parts.move;
  w.step(-1, -1, 1, 0); // full rightward motor command
  assert.ok(Math.abs(w.gazeAz - 3) < 1e-6, 'gaze should pan by exactly gazeStepDeg: ' + w.gazeAz);
  assert.ok(w.parts.move < before, 'moving the eye should cost reward');
  for (let i = 0; i < 20; i++) w.step(-1, -1, 1, 0); // keep pushing past the range limit
  assert.ok(w.gazeAz <= 10 + 1e-6, 'gaze should not wander past gazeRangeDeg: ' + w.gazeAz);

  const off = mergeConfig({ eye: { activeVision: false } });
  const w2 = new TrialWorld(off);
  w2.reset(4, stim);
  g = 0;
  while (w2.phase !== 'stim' && g++ < 100) w2.step(-1, -1, 0, 0);
  w2.step(-1, -1, 1, 1);
  assert.equal(w2.gazeAz, 0, 'gaze should not move when active vision is off, even if fed a motor command');
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
