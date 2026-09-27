// Tests for the newer abilities and the experiment tooling.
import assert from 'node:assert/strict';
import { mergeConfig } from '../src/config.js';
import { StimulusSet, IMG } from '../src/stimuli.js';
import { Brain } from '../src/brain.js';
import { ES } from '../src/es.js';
import { rewire } from '../src/topology.js';
import { compareRuns, verdict } from '../src/stats.js';
import { ABILITIES, setupConfig, abilitiesOf } from '../src/abilities.js';
import { runTrial } from '../src/experiment.js';
import { mulberry32 } from '../src/rng.js';
import { loadFacesNode } from '../tools/lib.mjs';
import { TrialWorld } from '../src/world.js';
import { exam } from '../src/experiment.js';

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log('ok  -', name); };
const cfg = mergeConfig({});
const flat = (b, v = 0.4) => b.lc.map(() => new Float32Array(cfg.eye.rows * cfg.eye.cols).fill(v));
const stripes = (b) => b.lc.map(() => Float32Array.from({ length: cfg.eye.rows * cfg.eye.cols }, (_, i) => ((i % cfg.eye.cols) % 4 < 2 ? 0.9 : 0.1)));
const touch = new Float32Array(2);

ok('a new fly\'s eye holds still until evolution teaches it to move', () => {
  const b = new Brain(cfg);
  b.setParams(b.initParams(3)); b.reset();
  for (let i = 0; i < 5; i++) b.step(stripes(b), touch, null, new Float32Array(2));
  assert.equal(b.gaze[0], 0); assert.equal(b.gaze[1], 0);
});

ok('efference copy: where the eye points reaches the brain', () => {
  const a = new Brain(cfg), c = new Brain(cfg);
  const p = a.initParams(5);
  a.setParams(p); c.setParams(p); a.reset(); c.reset();
  a.step(flat(a), touch, null, Float32Array.of(0, 0));
  c.step(flat(c), touch, null, Float32Array.of(0.8, -0.5));
  assert.ok(a.h.some((v, i) => Math.abs(v - c.h[i]) > 1e-4), 'core state should depend on eye position');
});

ok('neuromodulation off: dopamine sensitivity has no effect', () => {
  const off = mergeConfig({ brain: { neuromod: 0 } });
  const a = new Brain(off), c = new Brain(off);
  const p = a.initParams(7), q = Float32Array.from(p);
  let o = 0; for (const k of ['win', 'wrec', 'b', 'wout', 'bout', 'alpha', 'wgaze', 'bgaze', 'wmod', 'bmod']) o += a.sizes[k];
  for (let i = 0; i < a.N; i++) q[o + i] += 2; // very different sensitivities
  a.setParams(p); c.setParams(q); a.reset(); c.reset();
  for (let i = 0; i < 4; i++) { a.step(stripes(a), touch); c.step(stripes(c), touch); }
  assert.ok(a.h.every((v, i) => Math.abs(v - c.h[i]) < 1e-9));
  assert.equal(a.dopamine, 0.5);
});

ok('memory centre: sparse Kenyon cells feed the learning synapses', () => {
  const mb = mergeConfig({ mb: { enabled: 1 } });
  const b = new Brain(mb);
  b.setParams(b.initParams(2)); b.reset();
  b.step(flat(b, 0.5), touch);              // adapt the reference to a flat view
  b.fmeanInit = true;
  b.step(stripes(b), touch);
  const active = b.kc.reduce((s, v) => s + v, 0);
  assert.ok(active > 0 && active <= b.kActive, `between 1 and ${b.kActive} cells fire, got ${active}`);
  assert.equal(b.Wp.length, 2 * mb.mb.cells);
  assert.equal(b.paramCount, new Brain(cfg).paramCount, 'switching it on must not reshape the evolved brain');
  const before = Float32Array.from(b.Wp);
  b.learn(0, true);
  const changed = b.Wp.reduce((n, v, i) => n + (v !== before[i] ? 1 : 0), 0);
  assert.equal(changed, 2 * active, 'only the synapses of cells that fired change, on both feet');
});

ok('self-tuning learning: the evolved rule scales how much one answer teaches', () => {
  const measure = (evolveRule, logSpeed) => {
    const c = mergeConfig({ learn: { evolveRule } });
    const b = new Brain(c);
    const p = b.initParams(4);
    let o = 0; for (const k of ['win', 'wrec', 'b', 'wout', 'bout', 'alpha', 'wgaze', 'bgaze', 'wmod', 'bmod', 'sens', 'wpos']) o += b.sizes[k];
    p[o] = logSpeed;
    b.setParams(p); b.reset();
    b.step(flat(b, 0.5), touch); b.step(stripes(b), touch);
    b.learn(1, true);
    return b.Wp.reduce((s, v) => s + Math.abs(v), 0);
  };
  const hand = measure(0, Math.log(2)), evolved = measure(1, Math.log(2));
  assert.ok(Math.abs(evolved / hand - 2) < 0.02, `evolved rule with log speed ln2 should learn 2x as much: ${evolved / hand}`);
  assert.ok(Math.abs(measure(1, 0) / hand - 1) < 1e-3, 'at its starting values the evolved rule matches the hand-set one (bar ~0.01% forgetting)');
});

ok('rewiring moves the weakest wires, keeps every neuron\'s sources distinct', () => {
  const b = new Brain(cfg);
  const es = new ES(b.initParams(1), { ...cfg.es, seed: 1 });
  b.setParams(es.theta);
  const before = { inIdx: Int32Array.from(b.inIdx), recIdx: Int32Array.from(b.recIdx) };
  es.m.fill(1); es.v.fill(1);
  const n = rewire(b, es, 0.1, mulberry32(9));
  const moved = b.inIdx.reduce((s, v, i) => s + (v !== before.inIdx[i]), 0) + b.recIdx.reduce((s, v, i) => s + (v !== before.recIdx[i]), 0);
  assert.equal(n, Math.round(0.1 * (b.N * b.kIn + b.N * b.kRec)));
  assert.equal(moved, n, 'each chosen wire moves to a new source');
  const zeroed = Array.from(es.theta.subarray(0, b.N * (b.kIn + b.kRec))).filter((v, p) => v === 0 && es.m[p] === 0).length;
  assert.ok(zeroed >= n, 'moved wires restart at weight 0 with fresh optimiser state');
  for (const [idx, k] of [[b.inIdx, b.kIn], [b.recIdx, b.kRec]]) for (let i = 0; i < b.N; i++) {
    assert.equal(new Set(idx.subarray(i * k, (i + 1) * k)).size, k, 'no neuron listens to the same source twice');
  }
});

ok('rewired wiring travels: a second brain given it behaves identically', () => {
  const main = new Brain(cfg), other = new Brain(cfg);
  const es = new ES(main.initParams(2), { ...cfg.es, seed: 2 });
  rewire(main, es, 0.1, mulberry32(5));
  const saved = JSON.parse(JSON.stringify(main.getWiring())); // as posted to a worker / saved in a file
  assert.ok(other.setWiring(saved));
  main.setParams(es.theta); other.setParams(es.theta); main.reset(); other.reset();
  for (let i = 0; i < 5; i++) { main.step(stripes(main), touch); other.step(stripes(other), touch); }
  assert.ok(main.h.every((v, i) => v === other.h[i]));
  assert.ok(!other.setWiring({ inIdx: [1, 2], recIdx: [3] }), 'wiring for a different-sized brain is refused');
});

ok('find the spot: the answer lives only inside the patch', () => {
  const s = new StimulusSet('spot');
  const a = Float32Array.from(s.sample(mulberry32(3), 0)), b = Float32Array.from(s.sample(mulberry32(3), 1));
  const diff = [];
  for (let i = 0; i < IMG * IMG; i++) if (Math.abs(a[i] - b[i]) > 1e-6) diff.push(i);
  const xs = diff.map((i) => i % IMG), ys = diff.map((i) => Math.floor(i / IMG));
  assert.ok(diff.length > 20, 'the two answers must look different');
  assert.ok(Math.max(...xs) - Math.min(...xs) < 16 && Math.max(...ys) - Math.min(...ys) < 16, 'and only within a small patch');
});

ok('packed faces load in Node, normalised, split into practice and exam', () => {
  const f = loadFacesNode();
  assert.equal(f.train.size + f.test.size, 1000);
  assert.ok(f.test.size >= 100);
  let m = 0;
  for (let i = 0; i < IMG * IMG; i++) m += f.train.images[i] / (IMG * IMG);
  assert.ok(Math.abs(m - 0.5) < 0.1, 'exposure normalised: ' + m);
});

ok('comparison statistics tell a clear win from luck', () => {
  const clear = compareRuns([0.60, 0.62, 0.61, 0.59, 0.60], [0.80, 0.81, 0.79, 0.82, 0.80]);
  assert.ok(clear.clear && clear.better === 'B' && Math.abs(clear.diff - 0.2) < 1e-9);
  const noisy = compareRuns([0.5, 0.7, 0.55, 0.65, 0.6], [0.62, 0.58, 0.66, 0.54, 0.64]);
  assert.ok(!noisy.clear);
  assert.match(verdict(clear, 'old', 'new'), /^new is better/);
  assert.match(verdict(noisy), /No clear difference/);
});

ok('abilities round-trip through config', () => {
  const want = Object.fromEntries(ABILITIES.map((a, i) => [a.id, i % 2 === 0]));
  assert.deepEqual(abilitiesOf(mergeConfig(setupConfig('gratings', want))), want);
  assert.equal(mergeConfig(setupConfig('spot', {})).timing.forceAtSec, 1.2, 'the spot challenge gives more time to look');
});

ok('a quick-learn trial learns the easy task and passes its exam', () => {
  const r = runTrial({ cfg: setupConfig('brightness', {}), train: new StimulusSet('brightness'), test: new StimulusSet('brightness'), method: 'quick', seed: 1, budget: { episodes: 30 } });
  assert.ok(r.acc > 0.9, 'exam accuracy ' + r.acc);
});

// a world showing one fixed picture, long past its onset
function showing(cfgOver, img) {
  const w = new TrialWorld(mergeConfig(cfgOver));
  w.reset(1, new StimulusSet('brightness'));
  w.image = img; w.phase = 'stim'; w.phaseT = 10;
  w._render();
  return w;
}
const contrast = (L) => Math.max(...L) - Math.min(...L);
const centre = (w) => { const out = []; for (let r = 4; r < 10; r++) for (let c = 6; c < 14; c++) out.push(w.retinas[0][r * w.C + c]); return out; };

ok('lens blur: fine stripes melt into grey, a flat picture stays flat', () => {
  const fine = Float32Array.from({ length: IMG * IMG }, (_, i) => ((i % IMG) % 2 ? 0.9 : 0.1)); // 1-pixel stripes
  const pin = showing({ eye: { acceptance: 0 } }, fine), lens = showing({ eye: { acceptance: 1 } }, fine);
  assert.ok(contrast(centre(lens)) < 0.1, 'through the lens, stripes finer than a receptor average out: ' + contrast(centre(lens)));
  assert.ok(contrast(centre(pin)) > 0.5, 'a pinhole reads single points, so it sees (aliased) stripes');
  const flatImg = new Float32Array(IMG * IMG).fill(0.6);
  assert.ok(contrast(centre(showing({ eye: { acceptance: 1 } }, flatImg))) < 1e-3);
});

ok('viewing distance: twice as far covers about a quarter of the receptors', () => {
  const bright = new Float32Array(IMG * IMG).fill(0.95);
  const lit = (d) => showing({ screen: { distance: d } }, bright).retinas[0].filter((v) => v > 0.5).length;
  const near = lit(1), far = lit(2);
  assert.ok(far > 0 && far / near > 0.15 && far / near < 0.4, `${far} of ${near}`);
});

ok('step closer or back: moves, stops at its limits, costs points, and is felt', () => {
  const c = mergeConfig({ eye: { activeZoom: 1 } });
  const w = new TrialWorld(c);
  w.reset(4, new StimulusSet('brightness'));
  let g = 0;
  while (w.phase !== 'stim' && g++ < 100) w.step(-1, -1);
  const before = w.parts.move;
  w.step(-1, -1, 0, 0, -1);
  assert.ok(Math.abs(w.dist - Math.exp(-c.eye.zoomStep)) < 1e-9, 'one step closer: ' + w.dist);
  assert.ok(w.parts.move < before, 'stepping costs points');
  assert.ok(w.pos[2] < 0, 'the brain feels that it is closer than normal');
  for (let i = 0; i < 12; i++) w.step(-1, -1, 0, 0, -1);
  assert.ok(Math.abs(w.dist - c.eye.zoomMin) < 1e-9, 'stops at the closest allowed distance');
  const off = new TrialWorld(mergeConfig({}));
  off.reset(4, new StimulusSet('brightness'));
  g = 0; while (off.phase !== 'stim' && g++ < 100) off.step(-1, -1);
  off.step(-1, -1, 0, 0, -1);
  assert.equal(off.dist, 1, 'no stepping when the ability is off');
});

ok('practise at many distances: varies within range in training, never in the exam', () => {
  const c = mergeConfig({ screen: { distanceJitter: 0.35 } });
  const w = new TrialWorld(c);
  w.reset(7, new StimulusSet('brightness'));
  const seen = new Set();
  for (let i = 0; i < 400; i++) { w.step(-1, -1); if (w.phase === 'stim') seen.add(w.dist0.toFixed(3)); }
  const ds = [...seen].map(Number);
  assert.ok(ds.length > 5, 'different pictures come at different distances');
  assert.ok(Math.min(...ds) >= Math.exp(-0.35) - 1e-9 && Math.max(...ds) <= Math.exp(0.35) + 1e-9);
  // exam() must switch the variation off: check the config it builds by running a tiny exam and
  // watching the distance every picture is shown at
  const b = new Brain(c);
  const theta = b.initParams(1);
  const seenExam = new Set();
  const orig = TrialWorld.prototype._startTrial;
  TrialWorld.prototype._startTrial = function () { orig.call(this); seenExam.add(this.dist0); };
  try { exam(c, new StimulusSet('brightness'), theta, null, 1, null, 2); } finally { TrialWorld.prototype._startTrial = orig; }
  assert.deepEqual([...seenExam], [1], 'every exam picture is at the set distance');
});

console.log(`\n${passed} passed`);
