import { DEFAULTS, mergeConfig } from './config.js';
import { StimulusSet, splitFaces, IMG } from './stimuli.js';
import { Runner } from './rollout.js';
import { EVENT } from './world.js';
import { ES } from './es.js';
import { probeFrontEnd } from './probe.js';
import * as viz from './viz.js';

const $ = (id) => document.getElementById(id);
const num = (id) => +$(id).value;
const EVAL_SEEDS = Array.from({ length: 8 }, (_, i) => 900000 + i);

const S = {
  cfg: null, stimMode: 'brightness', faces: null, train: null, test: null,
  runner: null, watch: null, es: null, gen: 0, hist: [], pool: null,
  training: false, busy: false, watchParams: null, flash: null,
  imgCanvas: null, imgSerial: -1, watchStats: { trials: 0, correct: 0 }, tmpCanvas: document.createElement('canvas'),
};

function log(msg) {
  const el = $('log');
  const t = new Date().toLocaleTimeString();
  el.textContent = `${t}  ${msg}\n` + el.textContent.split('\n').slice(0, 120).join('\n');
}

// ---------------------------------------------------------------- workers
class WorkerPool {
  constructor(n) { this.n = n; this.workers = []; this.pending = new Map(); this.nextId = 1; }

  async init(cfg, stimMsg) {
    this.terminate();
    const ready = [];
    for (let i = 0; i < this.n; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      ready.push(new Promise((res, rej) => { w._ready = res; w._fail = rej; }));
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') return w._ready();
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.type === 'error') p.reject(new Error(m.message)); else p.resolve(m.results);
      };
      w.onerror = (e) => { w._fail(new Error(e.message || 'worker failed to start')); };
      this.workers.push(w);
      w.postMessage({ type: 'init', cfg, stim: stimMsg });
    }
    await Promise.all(ready);
  }

  async evalAll(params, seeds) {
    const size = Math.ceil(params.length / this.workers.length);
    const jobs = this.workers.map((w, i) => {
      const chunk = params.slice(i * size, (i + 1) * size);
      if (!chunk.length) return Promise.resolve([]);
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        w.postMessage({ type: 'eval', id, params: chunk, seeds });
      });
    });
    return (await Promise.all(jobs)).flat();
  }

  terminate() { this.workers.forEach((w) => w.terminate()); this.workers = []; this.pending.clear(); }
}

// ---------------------------------------------------------------- faces
async function loadFaces(cap) {
  const status = (t) => { $('facesStatus').textContent = t; };
  status('listing dataset...');
  const list = await (await fetch('/api/dataset')).json();
  if (!list.men.length || !list.women.length) throw new Error('server found no images (check DATASET_DIR)');
  let seed = 1234;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const jobs = [];
  for (const [label, dir, names] of [[0, 'men', list.men], [1, 'women', list.women]]) {
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    for (const n of shuffled.slice(0, cap)) jobs.push({ label, url: `/dataset/${dir}/${encodeURIComponent(n)}` });
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = IMG;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const images = [], labels = [];
  let done = 0, failed = 0, next = 0;
  async function worker() {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const bmp = await createImageBitmap(await (await fetch(job.url)).blob());
        const side = Math.min(bmp.width, bmp.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, IMG, IMG);
        bmp.close();
        const d = ctx.getImageData(0, 0, IMG, IMG).data;
        const g = new Float32Array(IMG * IMG);
        let m = 0;
        for (let i = 0; i < g.length; i++) { g[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255; m += g[i] / g.length; }
        // normalise exposure: mean 0.5, fixed contrast (the fly's early vision adapts to this anyway)
        let v = 0;
        for (let i = 0; i < g.length; i++) v += (g[i] - m) ** 2 / g.length;
        const k = 0.2 / (Math.sqrt(v) + 0.02);
        for (let i = 0; i < g.length; i++) g[i] = Math.max(0, Math.min(1, 0.5 + (g[i] - m) * k));
        images.push(g); labels.push(job.label);
      } catch { failed++; }
      done++;
      if (done % 20 === 0) status(`loading ${done}/${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const all = new Float32Array(images.length * IMG * IMG);
  images.forEach((g, i) => all.set(g, i * IMG * IMG));
  status(`${images.length} images loaded${failed ? `, ${failed} unreadable skipped` : ''}`);
  return splitFaces(all, Uint8Array.from(labels));
}

// ---------------------------------------------------------------- setup
// Anything that changes the brain's shape (so trained parameters can't carry over).
const shapeKey = (c) => JSON.stringify([c.eye.eyes, c.eye.rows, c.eye.cols, c.eye.lcStatic, c.brain.core, c.brain.kIn]);

function readCfg() {
  const fine = $('eyeRes').value === 'fine';
  return mergeConfig({
    eye: { eyes: num('eyes'), layout: $('eyeLayout').value, rows: fine ? 28 : 14, cols: fine ? 40 : 20, lcStatic: fine ? [10, 12] : [5, 6] },
    brain: { core: num('core'), kIn: fine ? 20 : 10 },
    reward: { respond: num('rwRespond'), premature: num('rwPremature'), miss: num('rwMiss'), timePerSec: num('rwTime'), marginPerSec: num('rwMargin') },
    es: { pairs: num('pairs'), sigma: num('sigma'), lr: num('lr'), episodesPerCandidate: num('eps') },
  });
}

function buildRunners() {
  S.runner = new Runner(S.cfg, S.train);
  S.watch = new Runner(S.cfg, S.train);
  S.watchStarted = false;
  $('neurons').textContent = `${S.runner.brain.neuronCount} neurons (${S.runner.brain.nLC} LC + ${S.runner.brain.N} core + 2 feet + 2 touch)`;
  $('params').textContent = `${S.runner.brain.paramCount.toLocaleString()} trainable parameters`;
}

async function buildPool() {
  const n = Math.max(1, num('workers'));
  if (!S.pool || S.pool.n !== n) { S.pool?.terminate(); S.pool = new WorkerPool(n); }
  $('poolStatus').textContent = 'starting workers...';
  await S.pool.init(S.cfg, S.train.toMessage());
  $('poolStatus').textContent = `${n} worker${n > 1 ? 's' : ''} ready`;
}

async function applyStimulus(mode) {
  S.stimMode = mode;
  if (mode === 'faces') {
    if (!S.faces) {
      $('facesStatus').textContent = 'loading...';
      S.faces = await loadFaces(num('facesCap'));
    }
    S.train = S.faces.train; S.test = S.faces.test;
  } else {
    S.train = new StimulusSet(mode); S.test = new StimulusSet(mode);
  }
  buildRunners();
  await buildPool();
  S.hist = []; S.gen = 0;
  viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist);
  log(`stimulus: ${mode}${mode === 'faces' ? ` (${S.train.size} train / ${S.test.size} held-out images)` : ''}`);
}

function newBrain(seed = Date.now() % 100000) {
  const theta = S.runner.brain.initParams(seed);
  S.es = new ES(theta, { ...S.cfg.es, seed });
  S.gen = 0; S.hist = [];
  S.watchParams = Float32Array.from(theta);
  S.watchStarted = false;
}

async function guarded(fn) {
  if (S.busy) return;
  S.busy = true;
  const wasTraining = S.training;
  S.training = false;
  try {
    await fn();
    if (wasTraining) log('training was stopped to apply that change - press Start again');
  } catch (e) { log('error: ' + e.message); console.error(e); } finally { S.busy = false; syncButtons(); }
}

function syncButtons() {
  $('btnTrain').textContent = S.training ? 'Stop training' : 'Start training';
  $('btnTrain').classList.toggle('on', S.training);
}

// ---------------------------------------------------------------- training
async function trainLoop() {
  const stepsPerEp = Math.round(S.cfg.timing.episodeSec / S.cfg.timing.dt);
  while (S.training) {
    const t0 = performance.now();
    const cands = S.es.ask();
    const seeds = Array.from({ length: S.cfg.es.episodesPerCandidate }, (_, i) => (S.gen + 1) * 1000 + i);
    let res;
    try { res = await S.pool.evalAll(cands, seeds); } catch (e) { log('worker error: ' + e.message); break; }
    if (!S.training) break;
    const fit = res.map((r) => r.fitness);
    S.es.tell(fit);
    S.gen++;
    const ev = S.runner.evaluate(S.es.theta, EVAL_SEEDS);
    const popTrials = res.reduce((a, r) => a + r.trials, 0), popCorrect = res.reduce((a, r) => a + r.correct, 0);
    S.hist.push({
      gen: S.gen, popMean: fit.reduce((a, b) => a + b, 0) / fit.length, best: Math.max(...fit),
      theta: ev.fitness, acc: ev.trials ? ev.correct / ev.trials : 0,
    });
    if (S.hist.length > 800) S.hist.shift();
    S.watchParams = Float32Array.from(S.es.theta);
    const dt = (performance.now() - t0) / 1000;
    const p = S.hist[S.hist.length - 1];
    $('genStats').textContent = `gen ${S.gen}   return ${p.theta.toFixed(1)}   accuracy ${(p.acc * 100).toFixed(0)}%   `
      + `(population ${(popTrials ? (popCorrect / popTrials) * 100 : 0).toFixed(0)}%)   `
      + `${dt.toFixed(1)} s/gen   ${((cands.length * seeds.length * stepsPerEp) / dt / 1000).toFixed(0)}k steps/s`;
    viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist);
    if (S.gen % 10 === 0) autosave();
    await new Promise((r) => setTimeout(r, 0));
  }
  S.training = false;
  autosave();
  syncButtons();
}

// ---------------------------------------------------------------- watch
function resetWatch() {
  const wr = S.watch;
  wr.brain.setParams(S.watchParams || S.es.theta);
  wr.brain.reset();
  const stim = $('watchData').value === 'test' && S.test ? S.test : S.train;
  wr.world.reset((Math.random() * 1e9) >>> 0, stim);
  S.watchStats = { trials: 0, correct: 0 };
  S.watchStarted = true;
}

function stepWatch() {
  const wr = S.watch;
  if (!S.watchStarted || wr.world.done) resetWatch();
  const o = wr.brain.step(wr.world.retinas, wr.world.touch);
  wr.world.step(o[0], o[1]);
  const ev = wr.world.lastEvent;
  const now = performance.now();
  if (ev === EVENT.CORRECT) { S.flash = { color: '#3fb950', until: now + 250 }; S.watchStats.trials++; S.watchStats.correct++; }
  else if (ev === EVENT.WRONG) { S.flash = { color: '#f85149', until: now + 250 }; S.watchStats.trials++; }
  else if (ev === EVENT.PREMATURE || ev === EVENT.MISS) S.flash = { color: '#d29922', until: now + 150 };
}

function draw() {
  const wr = S.watch;
  if (!wr) return;
  const w = wr.world;
  if (w.image && w.serial !== S.imgSerial) { S.imgCanvas = viz.makeImageCanvas(w.image, IMG); S.imgSerial = w.serial; }
  const sc = $('scene'), ey = $('eye'), nu = $('neuronView');
  viz.drawScene(sc.getContext('2d'), sc.width, sc.height, w, S.imgCanvas, S.flash);
  viz.drawEye(ey.getContext('2d'), ey.width, ey.height, w, S.tmpCanvas);
  viz.drawNeurons(nu.getContext('2d'), nu.width, nu.height, wr.brain);
  const st = S.watchStats;
  $('watchStats').textContent = `this episode: ${st.correct}/${st.trials} correct`;
}

function startWatchLoop() {
  let last = performance.now(), acc = 0;
  const frame = (now) => {
    if (S.watch && !document.hidden && $('watchOn').checked) {
      acc += ((now - last) / 1000) * (1 / S.cfg.timing.dt) * num('speed');
      last = now;
      let n = Math.min(Math.floor(acc), 60);
      acc = Math.min(acc - n, 1);
      while (n-- > 0) stepWatch();
      draw();
    } else last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- persistence
function checkpoint() {
  return {
    v: 1, stimMode: S.stimMode, gen: S.gen, theta: Array.from(S.es.theta), hist: S.hist.slice(-400),
    shape: { key: shapeKey(S.cfg), paramCount: S.es.n },
  };
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('fuitclassify-web', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
function autosave() { if (S.es) kvSet('latest', checkpoint()).catch(() => {}); }

function restore(ck) {
  if (!ck || ck.shape.key !== shapeKey(S.cfg) || ck.shape.paramCount !== S.es.n) throw new Error('checkpoint does not match this brain (different eye resolution / eyes / core size)');
  S.es = new ES(Float32Array.from(ck.theta), { ...S.cfg.es, seed: Date.now() % 100000 });
  S.gen = ck.gen; S.hist = ck.hist || [];
  S.watchParams = Float32Array.from(ck.theta); S.watchStarted = false;
  viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist);
}

// ---------------------------------------------------------------- wiring
function initUI() {
  const d = DEFAULTS;
  $('eyes').value = d.eye.eyes; $('core').value = d.brain.core;
  $('rwRespond').value = d.reward.respond; $('rwPremature').value = d.reward.premature;
  $('rwMiss').value = d.reward.miss; $('rwTime').value = d.reward.timePerSec; $('rwMargin').value = d.reward.marginPerSec;
  $('pairs').value = d.es.pairs; $('sigma').value = d.es.sigma; $('lr').value = d.es.lr; $('eps').value = d.es.episodesPerCandidate;
  $('workers').value = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

  $('btnTrain').onclick = () => {
    if (S.busy) return;
    if (S.training) { S.training = false; syncButtons(); return; }
    S.training = true; syncButtons(); trainLoop();
  };
  $('stim').onchange = () => guarded(async () => { await applyStimulus($('stim').value); log('kept the current brain - it carries over to the new task'); });
  $('btnFaces').onclick = () => guarded(async () => { S.faces = null; $('stim').value = 'faces'; await applyStimulus('faces'); });
  for (const id of ['eyes', 'eyeLayout', 'eyeRes', 'core', 'rwRespond', 'rwPremature', 'rwMiss', 'rwTime', 'rwMargin', 'workers']) {
    $(id).onchange = () => guarded(async () => {
      const before = S.cfg;
      S.cfg = readCfg();
      const reshaped = shapeKey(before) !== shapeKey(S.cfg);
      buildRunners();
      await buildPool();
      if (reshaped) { newBrain(); log('brain shape changed - parameters were reset'); }
      else { S.es.o = { ...S.cfg.es, seed: S.es.o.seed }; }
    });
  }
  for (const id of ['pairs', 'sigma', 'lr', 'eps']) {
    $(id).onchange = () => { S.cfg = readCfg(); if (S.es) S.es.o = { ...S.cfg.es, seed: S.es.o.seed }; };
  }
  $('btnEval').onclick = () => guarded(async () => {
    const stim = S.test || S.train;
    const r = new Runner(S.cfg, stim);
    const out = r.evaluate(S.es.theta, Array.from({ length: 40 }, (_, i) => 700000 + i));
    const acc = out.trials ? out.correct / out.trials : 0;
    log(`${S.stimMode === 'faces' ? 'HELD-OUT (never trained on)' : 'fresh'} images: ${(acc * 100).toFixed(1)}% correct over ${out.trials} responses, `
      + `${(out.premature / 40).toFixed(1)} premature + ${(out.misses / 40).toFixed(1)} misses per episode`);
  });
  $('btnProbe').onclick = () => guarded(async () => {
    const per = Math.min(200, S.train.mode === 'faces' ? Math.min(S.train.byLabel[0].length, S.train.byLabel[1].length) : 200);
    const r = probeFrontEnd(S.cfg, S.train, per);
    log(`front-end probe (linear readout of the ${r.features} static LC units, no training of the core): `
      + `train ${(r.train * 100).toFixed(0)}%  held-out ${(r.test * 100).toFixed(0)}%  `
      + `- ${r.test < 0.6 ? 'the eye barely carries this distinction' : r.test < 0.8 ? 'partly readable' : 'clearly readable'}`);
  });
  $('btnReset').onclick = () => guarded(async () => { newBrain(); log('new random brain'); });
  $('btnSave').onclick = () => {
    const blob = new Blob([JSON.stringify(checkpoint())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `fly-brain-gen${S.gen}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };
  $('fileLoad').onchange = (ev) => guarded(async () => {
    const f = ev.target.files[0];
    if (!f) return;
    restore(JSON.parse(await f.text()));
    log(`loaded ${f.name} (generation ${S.gen})`);
    ev.target.value = '';
  });
  $('btnLoad').onclick = () => $('fileLoad').click();
}

async function main() {
  initUI();
  S.cfg = readCfg();
  await guarded(async () => {
    await applyStimulus('brightness');
    newBrain();
    const ck = await kvGet('latest').catch(() => null);
    if (ck && ck.stimMode === 'brightness') {
      try { restore(ck); log(`resumed autosave (generation ${S.gen})`); } catch { /* different shape: start fresh */ }
    }
  });
  startWatchLoop();
  window.__fly = S; // handy for debugging in the console
}

main();
