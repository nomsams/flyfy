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
  // With server.js the listing comes from the live dataset folder; on static hosting
  // (GitHub Pages) there is no API, so fall back to the bundled manifest. Relative URLs only.
  let list;
  try {
    const r = await fetch('api/dataset');
    if (!r.ok) throw new Error('no api');
    list = await r.json();
  } catch {
    const r = await fetch('dataset/manifest.json');
    if (!r.ok) throw new Error('no dataset found (run node server.js, or add dataset/manifest.json)');
    list = await r.json();
  }
  if (!list.men.length || !list.women.length) throw new Error('server found no images (check DATASET_DIR)');
  let seed = 1234;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const jobs = [];
  for (const [label, dir, names] of [[0, 'men', list.men], [1, 'women', list.women]]) {
    const shuffled = [...names];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    for (const n of shuffled.slice(0, cap)) jobs.push({ label, url: `dataset/${dir}/${encodeURIComponent(n)}` });
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

// ---------------------------------------------------------------- rewards
// Every number the fly is scored on, with a plain-language explanation. Built into the page
// from this table so the UI cannot drift from what the simulation actually uses.
const REWARD_UI = [
  ['reward', 'Answers'],
  ['reward.correct', 'Correct answer', 'Pressed the foot that matches the image (left foot = man, right foot = woman).', 1],
  ['reward.wrong', 'Wrong answer', 'Pressed the other foot. The foot also feels pain (see below).', 1],
  ['reward.respond', 'Any-answer bonus', 'Paid for every answer, right or wrong. Only there to get the fly to try; too high and it just mashes buttons.', 0.5],
  ['reward.miss', 'No answer in time', 'The image timed out with no press (only possible when forced choice is off). Keep it bad: if a miss costs much less than a wrong answer, the fly learns to skip cues it is unsure of.', 1],
  ['reward.premature', 'Pressed on a blank screen', 'Pressing while the screen is blank, or within 0.3 s of an image appearing (it has to look first).', 0.5],
  ['reward.repeat', 'Same foot over and over', 'Anti-button-mashing: charged on every answer with the same foot after the free streak below.', 0.5],
  ['reward.repeatFree', '...free streak (answers)', 'How many answers in a row with one foot are free. Chance alone makes short streaks.', 1],
  ['reward', 'Every second'],
  ['reward.timePerSec', 'Time cost per second', 'A small constant drain so slow is worse than fast.', 0.05],
  ['reward.marginPerSec', 'Steering per second', 'Live nudge while an image is up: paid for pushing the correct foot harder than the wrong one. Helps learning a lot, but it is a hint, not the goal.', 0.5],
  ['pain', 'Pain (nociceptors, one per foot)'],
  ['pain.strength', 'Pain strength', 'How hard a wrong answer hurts the foot that pressed. This is the punishment signal that weakens the synapses behind that foot (it learns not to do that again). 0 = it feels nothing and only learns from reward.', 0.1],
  ['pain.onPremature', 'Pain for blank-screen press', 'Fraction of the full pain given for pressing a foot while no image is up.', 0.1],
  ['pain.tauSec', 'Pain fades over (s)', 'Time constant of the pain fading away (shown as the red glow on the foot).', 0.1],
  ['pain.feel', 'Pain as brain input', 'Also feed the pain nociceptors into the recurrent brain as a sensory input (0 = off). In my tests this slowed down evolution on these tasks, so it is off by default.', 0.1],
  ['learn', 'Learning from reward and pain (how the fly actually gets better)'],
  ['learn.eta', 'Learning speed', 'How much each answer changes the synapses from the eye onto the feet: reward strengthens the foot that was right, pain weakens the foot that was wrong. 0 = off (only evolution can teach it).', 0.05],
  ['learn.anneal', 'Slow down after (answers)', 'Experience makes it change its mind more slowly: the learning speed halves after this many answers. Settles the weights on noisy tasks like faces. 0 = never slows.', 50],
  ['learn.reward', 'Reward signal', 'Strength of the "that was right" signal. Pain strength is the matching "that was wrong" signal.', 0.1],
  ['timing', 'Timing'],
  ['timing.reactionSec', 'Reaction time (s)', 'A press earlier than this after an image appears counts as premature: the fly has to look first.', 0.05],
  ['timing.forceAtSec', 'Forced choice after (s)', 'No press by then: the foot with the stronger output is pressed for the fly. 0 = free response (the fly can also just never answer).', 0.05],
  ['loop', '"The loop trick": jittered-look ensembling'],
  ['eye.jitterFrac', 'Eye jitter (microsaccades)', 'Every frame, nudges the image by a random sub-receptor amount (as a fraction of receptor spacing) before sampling it, like a real fly’s fixational eye movements. Shift + resample is exactly the "loop trick": each frame is a slightly different, cheap look at the same still image. 0 = off, every frame is identical.', 0.1],
  ['brain.decisionAlpha', 'Decide from a running average', 'On its own, jitter just adds noise to a single frame’s decision. This sums/averages the foot signal over recent frames before deciding, the same idea as adding up several jittered looks’ scores instead of trusting just one. 1 = off (decide from this instant alone); lower = averages over more frames. In my tests this combination did not clearly help this task’s live decisions (the reaction-time and forced-choice window is short), but it reliably helps the passive "Probe the eye" test below - try it there.', 0.05],
];
const rwId = (path) => 'rw_' + path.replace('.', '_');

function buildRewardUI() {
  const host = $('rewardRows');
  host.innerHTML = '';
  for (const row of REWARD_UI) {
    if (row.length === 2) { const h3 = document.createElement('h3'); h3.textContent = row[1]; host.appendChild(h3); continue; }
    const [path, name, hint, step] = row;
    const [grp, key] = path.split('.');
    const div = document.createElement('div');
    div.className = 'rr';
    div.innerHTML = `<input id="${rwId(path)}" type="number" step="${step}"><div class="name"><b>${name}</b></div><div class="mut">${hint}</div>`;
    host.appendChild(div);
    $(rwId(path)).value = DEFAULTS[grp][key];
    $(rwId(path)).onchange = () => applyRewards();
  }
}

function readRewards() {
  const out = {};
  for (const row of REWARD_UI) {
    if (row.length === 2) continue;
    const [grp, key] = row[0].split('.');
    out[grp] ||= {};
    const v = num(rwId(row[0]));
    out[grp][key] = Number.isFinite(v) ? v : DEFAULTS[grp][key];
  }
  return out;
}

// Every group these live-editable numbers touch is read fresh on every simulation step, so they
// can all change while training runs (that includes eye.jitterFrac and brain.decisionAlpha: they
// are not part of the brain's shape, so nothing needs to be reset when they change).
function applyRewards() {
  const groups = readRewards();
  for (const g in groups) S.cfg[g] = { ...S.cfg[g], ...groups[g] };
  for (const r of [S.runner, S.watch, S.life]) if (r) for (const g in groups) r.cfg[g] = S.cfg[g];
  S.pool?.workers.forEach((w) => w.postMessage({ type: 'setcfg', ...groups }));
  log(`settings changed${S.gen || S.lifeEp ? ' mid-training - returns before/after are not directly comparable' : ''}`);
}

const PART_NAMES = {
  correct: 'correct answers', wrong: 'wrong answers', respond: 'any-answer bonus', miss: 'no answer in time',
  premature: 'pressed on blank screen', repeat: 'same foot over and over', margin: 'steering', time: 'time cost',
};
function renderLedger(ev) {
  const rows = Object.keys(PART_NAMES).map((k) => [PART_NAMES[k], ev.parts[k] || 0]);
  const total = rows.reduce((a, r) => a + r[1], 0);
  const cell = (v) => `<td class="v ${v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'mut'}">${v > 0 ? '+' : ''}${v.toFixed(1)}</td>`;
  $('ledger').innerHTML = '<tbody>' + rows.map(([n, v]) => `<tr><td>${n}</td>${cell(v)}</tr>`).join('')
    + `<tr><td><b>total</b></td><td class="v"><b>${total.toFixed(1)}</b></td></tr></tbody>`;
}

// ---------------------------------------------------------------- setup
// Anything that changes the brain's shape (so trained parameters can't carry over).
const shapeKey = (c) => JSON.stringify([c.eye.eyes, c.eye.rows, c.eye.cols, c.eye.lcStatic, c.brain.core, c.brain.kIn]);

function readCfg() {
  const fine = $('eyeRes').value === 'fine';
  const rw = readRewards(); // includes eye.jitterFrac and brain.decisionAlpha
  return mergeConfig({
    ...rw,
    eye: { ...rw.eye, eyes: num('eyes'), layout: $('eyeLayout').value, rows: fine ? 28 : 14, cols: fine ? 40 : 20, lcStatic: fine ? [10, 12] : [5, 6] },
    brain: { ...rw.brain, core: num('core'), kIn: fine ? 20 : 10 },
    es: { pairs: num('pairs'), sigma: num('sigma'), lr: num('lr'), episodesPerCandidate: num('eps') },
  });
}

function buildRunners() {
  S.runner = new Runner(S.cfg, S.train);
  S.watch = new Runner(S.cfg, S.train);
  S.life = new Runner(S.cfg, S.train);
  S.lifeState = null; // what the fly learned by pain belongs to this task and this eye
  S.watchStarted = false;
  $('neurons').textContent = `${S.runner.brain.neuronCount} neurons (${S.runner.brain.nLC} LC + ${S.runner.brain.N} core + 2 feet + 2 touch + 2 pain)`;
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
  S.hist = []; S.gen = 0; S.histKind = null; S.lifeEp = 0;
  viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist);
  log(`stimulus: ${mode}${mode === 'faces' ? ` (${S.train.size} train / ${S.test.size} held-out images)` : ''}`);
}

function newBrain(seed = Date.now() % 100000) {
  const theta = S.runner.brain.initParams(seed);
  S.es = new ES(theta, { ...S.cfg.es, seed });
  S.gen = 0; S.hist = []; S.histKind = null; S.lifeEp = 0; S.lifeState = null;
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
  const life = S.training && S.kind === 'life', evo = S.training && S.kind === 'evo';
  $('btnLife').textContent = life ? 'Stop learning' : 'Learn by pain (fast)';
  $('btnTrain').textContent = evo ? 'Stop evolving' : 'Evolve the core (slow)';
  $('btnLife').classList.toggle('on', life); $('btnTrain').classList.toggle('on', evo);
  $('btnLife').disabled = evo; $('btnTrain').disabled = life;
}

// ---------------------------------------------------------------- training
async function trainLoop() {
  const stepsPerEp = Math.round(S.cfg.timing.episodeSec / S.cfg.timing.dt);
  if (S.histKind !== 'evo') { S.hist = []; S.histKind = 'evo'; }
  while (S.training && S.kind === 'evo') {
    const t0 = performance.now();
    const cands = S.es.ask();
    const seeds = Array.from({ length: S.cfg.es.episodesPerCandidate }, (_, i) => (S.gen + 1) * 1000 + i);
    let res;
    try { res = await S.pool.evalAll(cands, seeds); } catch (e) { log('worker error: ' + e.message); break; }
    if (!S.training) break;
    S.watchStarted = false;
    const fit = res.map((r) => r.fitness);
    S.es.tell(fit);
    S.gen++;
    const ev = S.runner.evaluate(S.es.theta, EVAL_SEEDS);
    const popCues = res.reduce((a, r) => a + r.cues, 0), popCorrect = res.reduce((a, r) => a + r.correct, 0);
    S.hist.push({
      gen: S.gen, popMean: fit.reduce((a, b) => a + b, 0) / fit.length, best: Math.max(...fit),
      theta: ev.fitness, acc: ev.cues ? ev.correct / ev.cues : 0,
    });
    if (S.hist.length > 800) S.hist.shift();
    S.watchParams = Float32Array.from(S.es.theta);
    const dt = (performance.now() - t0) / 1000;
    const p = S.hist[S.hist.length - 1];
    const answered = ev.cues ? ev.trials / ev.cues : 0, ans = ev.left + ev.right, leftShare = ans ? ev.left / ans : 0.5;
    $('genStats').textContent = `gen ${S.gen}   return ${p.theta.toFixed(1)}   correct ${(p.acc * 100).toFixed(0)}% of all images (chance 50%)   `
      + `answers ${(answered * 100).toFixed(0)}% of images   left foot ${(leftShare * 100).toFixed(0)}% / right ${((1 - leftShare) * 100).toFixed(0)}%   `
      + `(population ${(popCues ? (popCorrect / popCues) * 100 : 0).toFixed(0)}%)   ${dt.toFixed(1)} s/gen   ${((cands.length * seeds.length * stepsPerEp) / dt / 1000).toFixed(0)}k steps/s`;
    const notes = [];
    // a random brain always looks bad: wait a few generations before nagging
    if (S.gen >= 5 && ev.cues && answered < 0.8) notes.push(`only answers ${(answered * 100).toFixed(0)}% of images - it is skipping the rest (raise the "no answer in time" penalty)`);
    if (S.gen >= 5 && ans > 10 && (leftShare < 0.15 || leftShare > 0.85)) notes.push(`using almost only the ${leftShare > 0.5 ? 'left' : 'right'} foot (raise the same-foot penalty, or it may just need more generations)`);
    $('warn').textContent = notes.length ? 'Heads up: ' + notes.join('; ') : '';
    renderLedger(ev);
    viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist, 'generation');
    if (S.gen % 10 === 0) autosave();
    await new Promise((r) => setTimeout(r, 0));
  }
  S.training = false;
  autosave();
  syncButtons();
}

// Learn by pain: one fly plays trial after trial; reward and pain reshape its foot synapses as it goes.
// No population, no workers, no backprop: this is the cheap path.
async function lifeLoop() {
  const life = S.life, BLOCK = 5;
  life.brain.setParams(S.es.theta);
  life.brain.setPlastic(S.lifeState);
  if (S.histKind !== 'life') { S.hist = []; S.histKind = 'life'; }
  const recent = []; // last few blocks, for a steadier accuracy readout
  while (S.training && S.kind === 'life') {
    const t0 = performance.now();
    const b = { ret: 0, cues: 0, trials: 0, correct: 0, left: 0, right: 0 };
    const parts = {};
    for (let i = 0; i < BLOCK; i++) {
      b.ret += life.episode(null, 7000 + S.lifeEp++, null, true) / BLOCK;
      const w = life.world;
      b.cues += w.trials + w.misses; b.trials += w.trials; b.correct += w.correct; b.left += w.resp[0]; b.right += w.resp[1];
      for (const k in w.parts) parts[k] = (parts[k] || 0) + w.parts[k] / BLOCK;
    }
    S.lifeState = life.brain.getPlastic();
    S.watchStarted = false; // the watched fly picks up what was just learned
    recent.push(b); if (recent.length > 4) recent.shift();
    const sum = (k) => recent.reduce((a, r) => a + r[k], 0);
    const acc = sum('cues') ? sum('correct') / sum('cues') : 0, answered = sum('cues') ? sum('trials') / sum('cues') : 0;
    const leftShare = sum('left') + sum('right') ? sum('left') / (sum('left') + sum('right')) : 0.5;
    S.hist.push({ gen: S.lifeEp, popMean: b.ret, best: b.ret, theta: b.ret, acc: b.cues ? b.correct / b.cues : 0 });
    if (S.hist.length > 800) S.hist.shift();
    $('genStats').textContent = `episode ${S.lifeEp}   correct ${(acc * 100).toFixed(0)}% of the last ${sum('cues')} images (chance 50%)   `
      + `left foot ${(leftShare * 100).toFixed(0)}% / right ${((1 - leftShare) * 100).toFixed(0)}%   return/episode ${b.ret.toFixed(1)}   `
      + `${((performance.now() - t0) / BLOCK).toFixed(0)} ms/episode   (learning from reward and pain, no evolution)`;
    const notes = [];
    if (S.lifeEp >= 100 && acc < 0.56) notes.push('barely above chance after 100 episodes - the eye may not carry this distinction (try "Probe the eye"), or raise the learning speed');
    if (S.lifeEp >= 30 && answered < 0.9) notes.push('it is skipping images (forced choice is off?)');
    $('warn').textContent = notes.length ? 'Heads up: ' + notes.join('; ') : '';
    renderLedger({ parts });
    viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist, 'episode');
    if ((S.lifeEp / BLOCK) % 20 === 0) autosave();
    await new Promise((r) => setTimeout(r, 0));
  }
  S.training = false;
  autosave();
  syncButtons();
}

// ---------------------------------------------------------------- watch
function resetWatch() {
  const wr = S.watch;
  const fresh = !S.watchStarted;
  wr.brain.setParams(S.watchParams || S.es.theta);
  // a new watched life starts from what the fly has learned; later episodes just carry on learning
  if (fresh) { wr.brain.reset(false); wr.brain.setPlastic(S.lifeState); } else wr.brain.reset(true);
  const stim = $('watchData').value === 'test' && S.test ? S.test : S.train;
  wr.world.reset((Math.random() * 1e9) >>> 0, stim);
  S.watchStats = { trials: 0, correct: 0 };
  S.watchStarted = true;
}

function stepWatch() {
  const wr = S.watch;
  if (!S.watchStarted || wr.world.done) resetWatch();
  wr.step();
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
    v: 3, stimMode: S.stimMode, gen: S.gen, theta: Array.from(S.es.theta), hist: S.hist.slice(-400), lifeEp: S.lifeEp || 0,
    life: S.lifeState ? { Wp: Array.from(S.lifeState.Wp), fmean: Array.from(S.lifeState.fmean), n: S.lifeState.n } : null,
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
  S.gen = ck.gen; S.hist = ck.hist || []; S.histKind = null; S.lifeEp = ck.lifeEp || 0;
  S.lifeState = ck.life ? { Wp: Float32Array.from(ck.life.Wp), fmean: Float32Array.from(ck.life.fmean), n: ck.life.n } : null;
  S.watchParams = Float32Array.from(ck.theta); S.watchStarted = false;
  viz.drawChart($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist);
}

// ---------------------------------------------------------------- wiring
function initUI() {
  const d = DEFAULTS;
  $('eyes').value = d.eye.eyes; $('core').value = d.brain.core;
  buildRewardUI();
  $('btnRewardDefaults').onclick = () => {
    for (const row of REWARD_UI) if (row.length > 2) { const [g, k] = row[0].split('.'); $(rwId(row[0])).value = DEFAULTS[g][k]; }
    applyRewards();
  };
  $('pairs').value = d.es.pairs; $('sigma').value = d.es.sigma; $('lr').value = d.es.lr; $('eps').value = d.es.episodesPerCandidate;
  $('workers').value = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

  const toggle = (kind, loop) => () => {
    if (S.busy) return;
    if (S.training) { S.training = false; syncButtons(); return; }
    S.training = true; S.kind = kind; syncButtons(); loop();
  };
  $('btnLife').onclick = toggle('life', lifeLoop);
  $('btnTrain').onclick = toggle('evo', trainLoop);
  $('stim').onchange = () => guarded(async () => { await applyStimulus($('stim').value); log('kept the current brain - it carries over to the new task'); });
  $('btnFaces').onclick = () => guarded(async () => { S.faces = null; $('stim').value = 'faces'; await applyStimulus('faces'); });
  for (const id of ['eyes', 'eyeLayout', 'eyeRes', 'core', 'workers']) {
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
    const seeds = Array.from({ length: 40 }, (_, i) => 700000 + i);
    let out;
    if (S.lifeState) {
      // the fly as it is now, learning switched off, on images it has not learned from
      const r = new Runner({ ...S.cfg, learn: { ...S.cfg.learn, eta: 0 } }, stim);
      r.brain.setParams(S.es.theta); r.brain.setPlastic(S.lifeState);
      out = { fitness: 0, trials: 0, cues: 0, correct: 0, premature: 0, misses: 0, left: 0, right: 0, parts: {} };
      for (const s of seeds) {
        r.episode(null, s, null, true);
        const w = r.world;
        out.trials += w.trials; out.cues += w.trials + w.misses; out.correct += w.correct; out.premature += w.premature; out.misses += w.misses; out.left += w.resp[0]; out.right += w.resp[1];
        for (const k in w.parts) out.parts[k] = (out.parts[k] || 0) + w.parts[k] / seeds.length;
      }
    } else out = new Runner(S.cfg, stim).evaluate(S.es.theta, seeds);
    const acc = out.cues ? out.correct / out.cues : 0;
    renderLedger(out);
    log(`${S.stimMode === 'faces' ? 'HELD-OUT (never trained on)' : 'fresh'} images: ${(acc * 100).toFixed(1)}% correct of ${out.cues} images (answered ${(100 * out.trials / Math.max(1, out.cues)).toFixed(0)}%, left foot ${(100 * out.left / Math.max(1, out.left + out.right)).toFixed(0)}%), `
      + `${(out.premature / 40).toFixed(1)} premature + ${(out.misses / 40).toFixed(1)} misses per episode`);
  });
  $('btnProbe').onclick = () => guarded(async () => {
    const per = Math.min(200, S.train.mode === 'faces' ? Math.min(S.train.byLabel[0].length, S.train.byLabel[1].length) : 200);
    // Also runs "the loop trick" as a test-time-only comparison: the same classifier, scored on
    // a single centred look vs. 10 independently jittered sub-receptor looks with their raw
    // scores summed before deciding. Costs nothing extra elsewhere -- this is evaluation only.
    const r = probeFrontEnd(S.cfg, S.train, per, 5, 10);
    log(`front-end probe (linear readout of the ${r.features} static LC units, no training of the core): `
      + `train ${(r.train * 100).toFixed(0)}%  held-out, single look ${(r.test * 100).toFixed(0)}%  `
      + `held-out, 10 jittered looks summed ${(r.testEnsembled * 100).toFixed(0)}%  `
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
    resetWatch(); draw(); // one still frame; nothing runs until you press Start / tick "play"
  });
  // Never resume behind your back: offer it.
  const ck = await kvGet('latest').catch(() => null);
  if (ck && ck.v === 3 && ck.shape) {
    $('btnResume').hidden = false;
    $('btnResume').textContent = `Resume saved fly (${ck.stimMode}, ${ck.lifeEp ? ck.lifeEp + ' episodes' : 'generation ' + ck.gen})`;
    $('btnResume').onclick = () => guarded(async () => {
      if (ck.stimMode !== S.stimMode) { $('stim').value = ck.stimMode; await applyStimulus(ck.stimMode); }
      newBrain(); restore(ck); resetWatch(); draw();
      $('btnResume').hidden = true;
      log(`resumed saved fly. Press a training button to continue`);
    });
  }
  startWatchLoop();
  window.__fly = S; // handy for debugging in the console
}

main();
