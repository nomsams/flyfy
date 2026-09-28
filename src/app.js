// Fly Lab: the page. Four tabs -- Train (a guided flow), Compare (is an ability worth it?),
// Inside the brain, and Settings (every number). The friendly controls on the Train tab (task
// cards, ability switches) only ever *write into* the Settings table, and the simulation only
// ever *reads from* it, so the two can never disagree.

import { DEFAULTS, mergeConfig } from './config.js';
import { StimulusSet, splitFaces, unpackFaces, normalizeFace, IMG } from './stimuli.js';
import { Runner } from './rollout.js';
import { EVENT } from './world.js';
import { ES } from './es.js';
import { Brain, BRAIN_VERSION } from './brain.js';
import { probeFrontEnd } from './probe.js';
import { rewire } from './topology.js';
import { exam } from './experiment.js';
import { mulberry32 } from './rng.js';
import { TASKS, ABILITIES, DEFAULT_ABILITIES, abilitiesOf, MEASURED } from './abilities.js';
import { ICONS } from './icons.js';
import { initCompare } from './compare.js';
import * as viz from './viz.js';

const $ = (id) => document.getElementById(id);
const num = (id) => +$(id).value;
const EVAL_SEEDS = Array.from({ length: 8 }, (_, i) => 900000 + i);
const SAVE_KEY = 'fly-v4';

const S = {
  cfg: null, taskId: 'brightness', faces: null, train: null, test: null,
  runner: null, watch: null, life: null, es: null, gen: 0, hist: [], histKind: null, lifeEp: 0, lifeState: null,
  wiring: null, rewired: 0, pool: null, training: false, kind: null, busy: false,
  watchOn: false, speed: 1, watchTest: false, watchStarted: false, flash: null,
  imgCanvas: null, imgSerial: -1, watchStats: { trials: 0, correct: 0 }, tmpCanvas: document.createElement('canvas'),
  T: null, tab: 'train', lastParts: null, faceSource: 'bundled',
};

// ---------------------------------------------------------------- small helpers
function log(msg) {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n` + el.textContent.split('\n').slice(0, 150).join('\n');
}
let toastTimer = 0;
function toast(msg, ms = 3500) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const pct = (x) => `${Math.round(x * 100)}%`;
// Let the page breathe between training steps. A MessageChannel tick instead of setTimeout(0):
// browsers throttle timers in background tabs (eventually to once a minute), which would make
// training crawl as soon as you switch tabs; message events aren't throttled that way.
const tick = new MessageChannel();
const tickWaiters = [];
tick.port1.onmessage = () => tickWaiters.shift()?.();
const yieldToPage = () => new Promise((r) => { tickWaiters.push(r); tick.port2.postMessage(0); });
const task = () => TASKS.find((t) => t.id === S.taskId) || TASKS[0];
function fillIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = ICONS[el.dataset.icon] || ''; });
}
function seg(id, onChange) {
  const el = $(id);
  el.querySelectorAll('button').forEach((b) => b.onclick = () => {
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    onChange(b.dataset.v);
  });
  return () => el.querySelector('button.on')?.dataset.v;
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
  post(msg) { this.workers.forEach((w) => w.postMessage(msg)); }
  terminate() { this.workers.forEach((w) => w.terminate()); this.workers = []; this.pending.clear(); }
}

// ---------------------------------------------------------------- faces
// Default: the 1,000 bundled photos, pre-packed as one small file (fast, and identical to what
// the command-line tools test on). Optional: a full local photo folder, via node server.js.
async function loadPackedFaces() {
  const [meta, buf, cbuf] = await Promise.all([
    fetch('data/faces32.json').then((r) => { if (!r.ok) throw new Error('data/faces32.json missing'); return r.json(); }),
    fetch('data/faces32.bin').then((r) => { if (!r.ok) throw new Error('data/faces32.bin missing'); return r.arrayBuffer(); }),
    fetch('data/faces32c.bin').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  ]);
  return unpackFaces(new Uint8Array(buf), meta.labels, Infinity, cbuf && meta.chromaSize ? new Uint8Array(cbuf) : null, meta.chromaSize);
}

async function loadFacesFromFolder(cap, status) {
  const list = await (await fetch('api/dataset')).json();
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
  let done = 0, next = 0;
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
        for (let i = 0; i < g.length; i++) g[i] = (0.299 * d[4 * i] + 0.587 * d[4 * i + 1] + 0.114 * d[4 * i + 2]) / 255;
        images.push(normalizeFace(g)); labels.push(job.label);
      } catch { /* unreadable file: skip */ }
      if (++done % 25 === 0) status(`Loading photos... ${done} of ${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  const all = new Float32Array(images.length * IMG * IMG);
  images.forEach((g, i) => all.set(g, i * IMG * IMG));
  return splitFaces(all, Uint8Array.from(labels));
}

async function taskSets(taskId) {
  if (taskId !== 'faces') return { train: new StimulusSet(taskId), test: new StimulusSet(taskId) };
  if (!S.faces) { $('taskStatus').textContent = 'Loading photos...'; S.faces = await loadPackedFaces(); }
  return S.faces;
}

// ---------------------------------------------------------------- every number (Settings tab)
// [path, name, hint, step] rows and [group, heading] headers. Built into the page from this table
// so the UI cannot drift from what the simulation actually reads.
const REWARD_UI = [
  ['reward', 'Answers'],
  ['reward.correct', 'Right answer', 'Points for pressing the foot that matches the picture.', 1],
  ['reward.wrong', 'Wrong answer', 'Points for pressing the other foot (it also hurts that foot, see Pain).', 1],
  ['reward.respond', 'Any answer', 'Paid for every answer, right or wrong - just enough to make it try. Too high and it mashes buttons.', 0.5],
  ['reward.miss', 'No answer in time', 'Only possible when forced choice is off. Keep it bad, or the fly learns to skip hard pictures.', 1],
  ['reward.premature', 'Pressed too early', 'Pressing while the screen is blank, or before the reaction time.', 0.5],
  ['reward.repeat', 'Same foot again and again', 'Charged for each answer with the same foot after the free streak below (stops button mashing).', 0.5],
  ['reward.repeatFree', '...free streak', 'How many answers in a row with one foot are free.', 1],
  ['reward', 'Every second'],
  ['reward.timePerSec', 'Time cost', 'A small drain per second, so slow is worse than fast.', 0.05],
  ['reward.marginPerSec', 'Steering hint', 'While a picture is up: points for pushing the right foot harder than the wrong one. A hint, not the goal.', 0.5],
  ['reward.movePerSec', 'Eye movement cost', 'Smart eye: a small charge for moving the eye, so it only looks around when that pays off. Keep negative.', 0.05],
  ['pain', 'Pain (one pain sensor per foot)'],
  ['pain.strength', 'Pain strength', 'How much a wrong answer hurts the foot that pressed. This is the "don\'t do that again" learning signal.', 0.1],
  ['pain.onPremature', 'Pain for early press', 'Fraction of full pain for pressing too early.', 0.1],
  ['pain.tauSec', 'Pain fades over (s)', 'How long the pain (red glow on the foot) lasts.', 0.1],
  ['pain.feel', 'Feel pain in the brain', 'Also send the pain signal into the brain as a sense (0 = off). Slowed evolution in testing.', 0.1],
  ['learn', 'Learning from rewards and pain'],
  ['learn.eta', 'Learning speed', 'How much each answer changes the synapses behind the feet. 0 = no learning by pain.', 0.05],
  ['learn.anneal', 'Settle down after', 'Learning slows to half after this many answers - steadier on noisy tasks. 0 = never.', 50],
  ['learn.reward', 'Reward signal', 'Strength of the "that was right" signal (pain strength is the "wrong" one).', 0.1],
  ['learn.surprise', 'Learn from surprises', '1 = learn in proportion to how unexpected each outcome was (dopamine as prediction error), not the same amount every time (ability switch).', 1],
  ['learn.evolveRule', 'Self-tuning learning', '1 = evolution tunes the learning rule itself (speeds, reward and pain weights, forgetting). Ability switch.', 1],
  ['timing', 'Timing'],
  ['timing.reactionSec', 'Reaction time (s)', 'Presses earlier than this after a picture appears count as too early: look first.', 0.05],
  ['timing.forceAtSec', 'Forced choice after (s)', 'No press by then: the stronger foot is pressed for the fly. 0 = it may never answer. Set by the challenge.', 0.05],
  ['eye', 'Eye'],
  ['eye.activeVision', 'Smart eye', '1 = the brain moves the eye (ability switch). Moves up to the step size per moment, within the range below.', 1],
  ['eye.gazeStepDeg', '...step size (deg)', 'How far the eye can move in one moment.', 0.5],
  ['eye.gazeRangeDeg', '...range (deg)', 'How far from the centre of the screen the eye may look.', 1],
  ['eye.acceptance', 'Lens blur', 'How wide a cone of light each sensor averages, in sensor gaps (real flies: about 1). Makes pictures smooth instead of full of false moire patterns. 0 = pinhole (reads one exact point).', 0.1],
  ['eye.colour', 'Colour vision', '1 = each sensor also reports red-green and blue-yellow; reaches the brain through the memory centre (ability switch).', 1],
  ['eye.orient', 'Edge-direction cells', '1 = pooled edge energy in several directions reaches the memory centre (ability switch).', 1],
  ['eye.orientBins', 'Edge directions', 'how many edge directions are told apart (8 = every 22.5 degrees).', 1],
  ['eye.orientPool', 'Edge-direction patch', 'patch size in sensors that each edge-direction cell sums over.', 1],
  ['mb.fanInOrient', 'Kenyon edge inputs', 'edge-direction inputs mixed into each Kenyon cell, on top of brightness (0 = none; they reach learning directly anyway).', 1],
  ['eye.orientGain', 'Edge cells to learning', 'weight of the gain-adapted edge-direction cells read straight by the learning synapses (0 = only via Kenyon cells).', 0.1],
  ['eye.reflex', 'Look at what stands out', 'Strength of the innate turn-toward-and-approach reflex (0 = off; ability switch sets 1). Moves the eye and legs even without the learned abilities.', 0.1],
  ['eye.activeZoom', 'Step closer or back', '1 = a third eye-motor output moves toward or away from the picture (ability switch).', 1],
  ['eye.zoomStep', '...speed', 'How much the picture can grow or shrink per moment (0.06 = 6%).', 0.01],
  ['eye.zoomMin', '...closest', 'Closest allowed distance (0.6 = the picture looks 1.7x bigger).', 0.1],
  ['eye.zoomMax', '...furthest', 'Furthest allowed distance (2.5 = the picture looks 2.5x smaller).', 0.1],
  ['screen', 'Viewing distance'],
  ['screen.distance', 'Distance', '1 = normal. 2 = twice as far away (half the size, with dark around it); 0.6 = closer (bigger, edges out of view).', 0.1],
  ['screen.distanceJitter', 'Practise at many distances', 'Show each practice picture from a random distance between e^-x and e^+x times the one above (0.35: about 0.7x to 1.4x). The exam is always at the set distance. Ability switch.', 0.05],
  ['eye.fovea', 'Sharp centre', 'How strongly sensors are packed at the centre (0 = even; ability switch sets 1.1).', 0.1],
  ['eye.lateralInhib', 'Edge boost', 'How strongly each sensor dims its neighbours (0 = off; ability switch sets 1.5).', 0.5],
  ['eye.jitterFrac', 'Fixed jitter scan', 'The old, scripted alternative to Smart eye: a tiny circular scan every moment. 0 = off.', 0.1],
  ['brain', 'Brain'],
  ['brain.neuromod', 'Mood chemical', '1 = a dopamine-like signal adjusts how long each cell holds a thought (ability switch).', 1],
  ['brain.decisionAlpha', 'Decision smoothing', 'Average the foot signal over recent moments before deciding. 1 = off.', 0.05],
  ['mb.enabled', 'Memory centre', '1 = add the mushroom-body layer of Kenyon cells (ability switch).', 1],
  ['mb.retina', '...reads raw sensors', '1 = Kenyon cells sample the raw light sensors directly instead of the coarse eye-cell tiles (more detail).', 1],
  ['es.rewire', 'Rewiring', '1 = evolution moves the weakest connections to new places (ability switch).', 1],
  ['es.rewireEvery', '...every (generations)', 'How often rewiring happens.', 1],
  ['es.rewireFrac', '...fraction moved', 'What share of all connections is moved each time.', 0.01],
];
const rwId = (path) => 'rw_' + path.replace('.', '_');

function buildRewardUI() {
  const host = $('rewardRows');
  host.innerHTML = '';
  for (const row of REWARD_UI) {
    if (row.length === 2) { const h3 = document.createElement('h3'); h3.className = 'grp'; h3.textContent = row[1]; host.appendChild(h3); continue; }
    const [path, name, hint, step] = row;
    const [grp, key] = path.split('.');
    const div = document.createElement('div');
    div.className = 'rr';
    div.innerHTML = `<input id="${rwId(path)}" type="number" step="${step}" aria-label="${name}"><div><b>${name}</b><div class="mut">${hint}</div></div>`;
    host.appendChild(div);
    $(rwId(path)).value = DEFAULTS[grp][key];
    $(rwId(path)).onchange = () => applySettings();
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

// Write a partial config ({ grp: { key: value } }) into the Settings table (only known rows).
function writeRewards(partial) {
  for (const grp in partial) for (const key in partial[grp]) {
    const el = $(rwId(`${grp}.${key}`));
    if (el) el.value = partial[grp][key];
  }
}

// ---------------------------------------------------------------- config + brain shape
// Anything that changes the brain's parameter layout (so trained parameters can't carry over).
const shapeKey = (c) => JSON.stringify([BRAIN_VERSION, c.eye.eyes, c.eye.rows, c.eye.cols, c.eye.lcStatic, c.brain.core, c.brain.kIn]);

function readCfg() {
  const fine = $('eyeRes').value === 'fine';
  const rw = readRewards();
  return mergeConfig({
    ...rw,
    eye: { ...rw.eye, eyes: num('eyes'), layout: $('eyeLayout').value, rows: fine ? 28 : 14, cols: fine ? 40 : 20, lcStatic: fine ? [10, 12] : [5, 6] },
    brain: { ...rw.brain, core: num('core'), kIn: fine ? 20 : 10 },
    es: { ...rw.es, pairs: num('pairs'), sigma: num('sigma'), lr: num('lr'), episodesPerCandidate: num('eps') },
    wiring: S.wiring || undefined,
  });
}

function buildRunners() {
  S.runner = new Runner(S.cfg, S.train);
  S.watch = new Runner(S.cfg, S.train);
  S.life = new Runner(S.cfg, S.train);
  S.watchStarted = false;
  const b = S.runner.brain;
  $('brainSize').textContent = `${b.neuronCount} cells · ${b.paramCount.toLocaleString()} evolvable numbers`;
}

async function buildPool() {
  const n = Math.max(1, num('workers'));
  if (!S.pool || S.pool.n !== n) { S.pool?.terminate(); S.pool = new WorkerPool(n); }
  await S.pool.init(S.cfg, S.train.toMessage());
}

async function newBrain(seed = Date.now() % 100000) {
  S.wiring = null; S.rewired = 0;
  S.cfg = readCfg();
  buildRunners();
  await buildPool();
  const theta = S.runner.brain.initParams(seed);
  S.es = new ES(theta, { ...S.cfg.es, seed });
  S.gen = 0; S.hist = []; S.histKind = null; S.lifeEp = 0; S.lifeState = null;
  S.watchParams = Float32Array.from(theta);
  S.watchStarted = false; S.lastParts = null;
  $('examResult').innerHTML = '';
  refreshScore();
}

// Only a few things change the structure of the simulation without changing its parameters:
// right now that is the memory centre (it adds or removes a layer of cells).
const structKey = (c) => JSON.stringify([c.mb.enabled ? c.mb.cells : 0, c.mb.enabled ? c.mb.retina : 0, c.mb.enabled ? c.eye.colour : 0, c.mb.enabled ? [c.eye.orient, c.eye.orientPool, c.eye.orientBins, c.eye.orientGain > 0] : 0]);

// The Settings table changed (directly, or via an ability switch / task card).
async function applySettings() {
  const before = S.cfg;
  S.cfg = readCfg();
  syncAbilitySwitches();
  if (!before) return;
  if (shapeKey(before) !== shapeKey(S.cfg)) {
    await guarded(async () => { await newBrain(); toast('That change needs a differently shaped brain, so the fly starts over.'); });
    return;
  }
  if (structKey(before) !== structKey(S.cfg)) {
    await guarded(async () => {
      buildRunners();
      await buildPool();
      S.lifeState = null; S.lifeEp = 0; // what it learned by pain was stored in the old layer
      log('memory centre switched - learned-by-pain memories cleared, evolved brain kept');
    });
    return;
  }
  const groups = readRewards();
  for (const r of [S.runner, S.watch, S.life]) if (r) for (const g in groups) r.cfg[g] = S.cfg[g];
  S.pool?.post({ type: 'setcfg', ...groups });
  if (S.es) S.es.o = { ...S.cfg.es, seed: S.es.o.seed };
  log('settings changed' + (S.gen || S.lifeEp ? ' mid-training' : ''));
  updateNotes();
}

async function guarded(fn) {
  if (S.busy) return;
  S.busy = true;
  const wasTraining = S.training;
  S.training = false;
  syncButtons();
  try {
    await fn();
    if (wasTraining) toast('Training paused to apply that change - press it again to continue.');
  } catch (e) { log('error: ' + e.message); toast('Something went wrong: ' + e.message, 6000); console.error(e); }
  finally { S.busy = false; syncButtons(); }
}

// ---------------------------------------------------------------- Train tab: challenge cards
function renderTasks() {
  const host = $('taskGrid');
  host.innerHTML = '';
  for (const t of TASKS) {
    const b = document.createElement('button');
    b.className = 'task' + (t.id === S.taskId ? ' on' : '');
    b.innerHTML = `<span class="t1">${ICONS[t.icon]}${t.name}</span><span class="lvl">${t.level}</span><span class="bl">${t.blurb}</span>`;
    b.onclick = () => setTask(t.id);
    host.appendChild(b);
  }
}

async function setTask(id, quiet = false) {
  await guarded(async () => {
    S.taskId = id;
    renderTasks();
    // the challenge's own settings (e.g. more time to look), everything else back to default
    const t = task();
    const keys = new Set(TASKS.flatMap((x) => Object.entries(x.cfg).flatMap(([g, o]) => Object.keys(o).map((k) => `${g}.${k}`))));
    const partial = {};
    for (const p of keys) { const [g, k] = p.split('.'); partial[g] ||= {}; partial[g][k] = t.cfg[g]?.[k] ?? DEFAULTS[g][k]; }
    writeRewards(partial);
    S.cfg = readCfg();
    const sets = await taskSets(id);
    S.train = sets.train; S.test = sets.test;
    buildRunners();
    await buildPool();
    S.hist = []; S.histKind = null; S.lifeEp = 0; S.lifeState = null;
    $('taskStatus').textContent = id === 'faces'
      ? `${S.train.size} practice photos and ${S.test.size} exam photos the fly never trains on.`
      : 'Every picture is new: made up on the spot.';
    $('footHint').textContent = `Left foot means "${t.answers[0]}", right foot means "${t.answers[1]}". A green flash means right, red means wrong.`;
    $('examResult').innerHTML = '';
    refreshScore(); updateNotes();
    if (!quiet) { log(`challenge: ${t.name}`); if (S.gen) toast('New challenge - your fly keeps its evolved brain, but starts learning this one from scratch.'); }
  });
}

// ---------------------------------------------------------------- Train tab: ability switches
function measuredTag(id) {
  const m = MEASURED.find((r) => r.ability === id && r.clear && r.diff > 0);
  return m ? `<span class="tag good">+${Math.round(m.diff * 100)} pts on ${TASKS.find((t) => t.id === m.task).name.toLowerCase()}</span>` : '';
}
function measuredText(id) {
  const rows = MEASURED.filter((r) => r.ability === id);
  if (!rows.length) return '';
  return '<p><b>Measured:</b> ' + rows.map((r) => r.summary).join(' ') + '</p>';
}

export function renderAbilityList(host, state, onToggle, opts = {}) {
  host.innerHTML = '';
  for (const a of ABILITIES) {
    const row = document.createElement('div');
    row.className = 'ab';
    const id = `${host.id}_${a.id}`;
    row.innerHTML = `<span class="ic">${ICONS[a.icon]}</span>
      <span class="nm"><label for="${id}">${a.name}</label>${a.needsEvolve ? '<span class="tag evo">needs Evolve</span>' : ''}${opts.compact ? '' : measuredTag(a.id)}</span>
      <label class="switch" title="${a.name}"><input type="checkbox" id="${id}" ${state[a.id] ? 'checked' : ''}><span></span></label>
      <span class="sh">${a.short}</span>
      ${opts.compact ? '' : `<details><summary>more</summary><p>${a.long}</p>${measuredText(a.id)}</details>`}`;
    row.querySelector('input').onchange = (e) => onToggle(a.id, e.target.checked);
    host.appendChild(row);
  }
}

function currentAbilities() { return abilitiesOf(S.cfg || readCfg()); }

function setAbility(id, on) {
  const a = ABILITIES.find((x) => x.id === id);
  writeRewards(on ? a.on : a.off);
  applySettings();
}

function syncAbilitySwitches() {
  const d = S.cfg.screen.distance;
  document.querySelectorAll('#distSeg button').forEach((b) => b.classList.toggle('on', Math.abs(+b.dataset.v - d) < 1e-6));
  const st = abilitiesOf(S.cfg);
  for (const a of ABILITIES) { const el = $(`abilityList_${a.id}`); if (el) el.checked = !!st[a.id]; }
}

// ---------------------------------------------------------------- training
function syncButtons() {
  const life = S.training && S.kind === 'life', evo = S.training && S.kind === 'evo';
  const q = $('btnQuick'), e = $('btnEvolve');
  q.querySelector('span').textContent = life ? 'Stop' : 'Quick learn';
  e.querySelector('span').textContent = evo ? 'Stop' : 'Evolve';
  q.classList.toggle('running', life); e.classList.toggle('running', evo);
  q.classList.toggle('primary', !life && !evo);
  q.disabled = evo || S.busy || S.comparing; e.disabled = life || S.busy || S.comparing;
  $('btnExam').disabled = S.training || S.busy;
}

function refreshScore(acc, label, sub) {
  $('scoreNum').textContent = acc == null ? '–' : pct(acc);
  $('scoreNum').style.color = acc == null ? '' : acc >= 0.8 ? 'var(--green)' : acc >= 0.6 ? 'var(--accent)' : '';
  $('scoreLabel').textContent = label || 'correct lately';
  $('scoreSub').textContent = sub || 'Press a button above to start. Guessing scores 50%.';
  viz.drawAccuracy($('chart').getContext('2d'), $('chart').width, $('chart').height, S.hist, S.histKind === 'evo' ? 'generation' : 'session', S.T);
}

// Friendly heads-ups, recomputed whenever something changes.
function updateNotes(extra = []) {
  const notes = [...extra];
  const ab = currentAbilities();
  const evoOnly = ABILITIES.filter((a) => a.needsEvolve && ab[a.id]).map((a) => a.name);
  const list = (xs) => (xs.length < 2 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  if (S.kind === 'life' && S.training && evoOnly.length && !S.gen) {
    notes.push(`${list(evoOnly)} only ${evoOnly.length > 1 ? 'improve' : 'improves'} through Evolve. Quick learn trains just the learning synapses, so for now ${evoOnly.length > 1 ? 'they stay' : 'it stays'} untrained (a new fly's eye holds still until evolution teaches it to move).`);
  }
  $('trainNote').textContent = notes.join(' ');
}

async function trainLoop() {
  const stepsPerEp = Math.round(S.cfg.timing.episodeSec / S.cfg.timing.dt);
  if (S.histKind !== 'evo') { S.hist = []; S.histKind = 'evo'; }
  S.rewireRng = S.rewireRng || mulberry32(4242);
  updateNotes();
  while (S.training && S.kind === 'evo') {
    const t0 = performance.now();
    const cands = S.es.ask();
    const seeds = Array.from({ length: S.cfg.es.episodesPerCandidate }, (_, i) => (S.gen + 1) * 1000 + i);
    let res;
    try { res = await S.pool.evalAll(cands, seeds); } catch (e) { log('worker error: ' + e.message); break; }
    if (!S.training) break;
    S.es.tell(res.map((r) => r.fitness));
    S.gen++;
    if (S.cfg.es.rewire && S.gen % S.cfg.es.rewireEvery === 0) {
      S.rewired += rewire(S.runner.brain, S.es, S.cfg.es.rewireFrac, S.rewireRng);
      S.wiring = S.runner.brain.getWiring();
      S.cfg.wiring = S.wiring;
      S.watch.brain.setWiring(S.wiring); S.life.brain.setWiring(S.wiring);
      S.pool.post({ type: 'setwiring', wiring: S.wiring });
    }
    S.watchStarted = false;
    const ev = S.runner.evaluate(S.es.theta, EVAL_SEEDS);
    const acc = ev.cues ? ev.correct / ev.cues : 0;
    S.hist.push({ gen: S.gen, acc, ret: ev.fitness });
    if (S.hist.length > 800) S.hist.shift();
    S.watchParams = Float32Array.from(S.es.theta);
    S.lastParts = ev.parts;
    const dt = (performance.now() - t0) / 1000;
    const ans = ev.left + ev.right, leftShare = ans ? ev.left / ans : 0.5;
    refreshScore(acc, 'correct on practice pictures',
      `Generation ${S.gen} · ${dt.toFixed(1)} s each · ${Math.round((cands.length * seeds.length * stepsPerEp) / dt / 1000)}k moments/s${S.rewired ? ` · ${S.rewired} wires moved` : ''}`);
    const notes = [];
    if (S.gen >= 8 && (leftShare < 0.15 || leftShare > 0.85)) notes.push(`It is mostly pressing the ${leftShare > 0.5 ? 'left' : 'right'} foot. Usually it grows out of this; if not, raise "Same foot again and again" in Settings.`);
    if (S.gen >= 40 && acc < 0.56) notes.push('Still close to guessing. Check "How much can this eye see?" on the Inside the brain tab - the answer may just not be visible to this eye.');
    updateNotes(notes);
    if (S.tab === 'brain') drawBrainTab();
    if (S.gen % 10 === 0) autosave();
    await yieldToPage();
  }
  S.training = false; S.kind = null;
  autosave(); syncButtons(); updateNotes();
}

// Learn by pain: one fly plays session after session; rewards and pain reshape its synapses.
async function lifeLoop() {
  const life = S.life, BLOCK = 5;
  life.brain.setParams(S.es.theta);
  life.brain.setPlastic(S.lifeState);
  if (S.histKind !== 'life') { S.hist = []; S.histKind = 'life'; }
  const recent = [];
  updateNotes();
  while (S.training && S.kind === 'life') {
    const t0 = performance.now();
    const b = { cues: 0, trials: 0, correct: 0, left: 0, right: 0 };
    const parts = {};
    for (let i = 0; i < BLOCK; i++) {
      life.episode(null, 7000 + S.lifeEp++, null, true);
      const w = life.world;
      b.cues += w.trials + w.misses; b.trials += w.trials; b.correct += w.correct; b.left += w.resp[0]; b.right += w.resp[1];
      for (const k in w.parts) parts[k] = (parts[k] || 0) + w.parts[k] / BLOCK;
    }
    S.lifeState = life.brain.getPlastic();
    S.watchStarted = false;
    recent.push(b); if (recent.length > 4) recent.shift();
    const sum = (k) => recent.reduce((a, r) => a + r[k], 0);
    const acc = sum('cues') ? sum('correct') / sum('cues') : 0;
    S.hist.push({ gen: S.lifeEp, acc: b.cues ? b.correct / b.cues : 0 });
    if (S.hist.length > 800) S.hist.shift();
    S.lastParts = parts;
    refreshScore(acc, `correct in the last ${sum('cues')} pictures`, `${S.lifeEp} sessions · ${((performance.now() - t0) / BLOCK).toFixed(0)} ms each · learning from rewards and pain`);
    const notes = [];
    if (S.lifeEp >= 150 && acc < 0.56) notes.push('Still close to guessing. Try the Memory centre ability, or check "How much can this eye see?" on the Inside the brain tab.');
    updateNotes(notes);
    if (S.tab === 'brain') drawBrainTab();
    if ((S.lifeEp / BLOCK) % 20 === 0) autosave();
    await yieldToPage();
  }
  S.training = false; S.kind = null;
  autosave(); syncButtons(); updateNotes();
}

function toggleTraining(kind) {
  if (S.busy || S.comparing) return;
  if (S.training) { S.training = false; syncButtons(); return; }
  S.training = true; S.kind = kind; syncButtons();
  if (!S.watchOn) setWatch(true);
  (kind === 'life' ? lifeLoop : trainLoop)();
}

// ---------------------------------------------------------------- exam
function runExam() {
  const t = task();
  const res = exam(S.cfg, S.test, S.es.theta, S.lifeState, 1, S.wiring, 40);
  const total = Math.round(res.acc * 100);
  const verdict = res.acc < 0.55 ? 'That is about the same as guessing - keep training, or try other abilities.'
    : res.acc < 0.7 ? 'Better than guessing. There is room to improve.'
      : res.acc < 0.9 ? 'Good - it has clearly learned something real.'
        : 'Excellent - it has really got this.';
  $('examResult').innerHTML = `<div class="big-line">${total} out of 100 new pictures right</div>
    <div class="meter" aria-hidden="true"><i style="width:${total}%"></i><b title="guessing"></b></div>
    <p class="hint">${verdict} The line in the middle is guessing (50%).${t.id === 'faces' ? ' These are photos the fly never saw while training.' : ''}</p>`;
  log(`exam (${t.name}): ${total}% correct, answered ${pct(res.answered)}`);
}

// ---------------------------------------------------------------- watch
function setWatch(on) {
  S.watchOn = on;
  const b = $('btnPlay');
  b.innerHTML = (on ? ICONS.pause : ICONS.play) + `<span>${on ? 'Pause' : 'Play'}</span>`;
  $('watchStats').textContent = on ? 'watching' : 'paused';
}

function resetWatch() {
  const wr = S.watch;
  const fresh = !S.watchStarted;
  wr.brain.setParams(S.watchParams || S.es.theta);
  if (fresh) { wr.brain.reset(false); wr.brain.setPlastic(S.lifeState); } else wr.brain.reset(true);
  const stim = S.watchTest && S.test ? S.test : S.train;
  wr.world.reset((Math.random() * 1e9) >>> 0, stim);
  S.watchStats = { trials: 0, correct: 0 };
  S.watchStarted = true;
}

function stepWatch() {
  const wr = S.watch;
  if (!S.watchStarted || wr.world.done) resetWatch();
  wr.step();
  const ev = wr.world.lastEvent, now = performance.now();
  if (ev === EVENT.CORRECT) { S.flash = { color: S.T.green, text: 'Right!', until: now + 350 }; S.watchStats.trials++; S.watchStats.correct++; }
  else if (ev === EVENT.WRONG) { S.flash = { color: S.T.red, text: 'Wrong', until: now + 350 }; S.watchStats.trials++; }
  else if (ev === EVENT.PREMATURE) S.flash = { color: S.T.amber, text: 'Too early', until: now + 250 };
  else if (ev === EVENT.MISS) S.flash = { color: S.T.amber, text: 'Too slow', until: now + 250 };
}

function draw() {
  const wr = S.watch;
  if (!wr) return;
  const w = wr.world;
  if (w.image && w.serial !== S.imgSerial) { S.imgCanvas = viz.makeImageCanvas(w.image, IMG); S.imgSerial = w.serial; }
  const sc = $('scene');
  viz.drawScene(sc.getContext('2d'), sc.width, sc.height, w, S.imgCanvas, S.flash, task().answers, S.T);
  const ey = $('eye');
  if (ey.offsetParent) viz.drawEye(ey.getContext('2d'), ey.width, ey.height, w, S.tmpCanvas, S.T);
  if (S.tab === 'brain') { const nu = $('neuronView'); viz.drawNeurons(nu.getContext('2d'), nu.width, nu.height, wr.brain, S.T); }
  const st = S.watchStats;
  if (S.watchOn) $('watchStats').textContent = st.trials ? `${st.correct} of ${st.trials} right this session` : 'watching';
}

function startWatchLoop() {
  let last = performance.now(), acc = 0;
  const frame = (now) => {
    if (S.watch && !document.hidden && S.watchOn) {
      acc += ((now - last) / 1000) * (1 / S.cfg.timing.dt) * S.speed;
      last = now;
      let n = Math.min(Math.floor(acc), 80);
      acc = Math.min(acc - n, 1);
      while (n-- > 0) stepWatch();
      draw();
    } else last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- Inside the brain tab
const PART_NAMES = {
  correct: 'Right answers', wrong: 'Wrong answers', respond: 'Answering at all', miss: 'Too slow',
  premature: 'Too early', repeat: 'Same foot again and again', margin: 'Steering hint', time: 'Time cost', move: 'Moving the eye or stepping',
};
function renderLedger(parts) {
  if (!parts) return;
  const rows = Object.keys(PART_NAMES).map((k) => [PART_NAMES[k], parts[k] || 0]).filter(([, v]) => Math.abs(v) > 0.005);
  const total = rows.reduce((a, r) => a + r[1], 0);
  const cell = (v) => `<td class="v ${v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'mut'}">${v > 0 ? '+' : ''}${v.toFixed(1)}</td>`;
  $('ledger').innerHTML = '<tbody>' + rows.map(([n, v]) => `<tr><td>${n}</td>${cell(v)}</tr>`).join('')
    + `<tr><td><b>Total</b></td><td class="v"><b>${total.toFixed(1)}</b></td></tr></tbody>`;
}

function drawBrainTab() {
  const T = S.T;
  const b = S.runner.brain;
  b.setParams(S.es.theta);
  viz.drawHistogram($('histLeak').getContext('2d'), 300, 150, Array.from(b.baseAlpha), { min: 0, max: 1, title: 'Memory length (baseline leak)', color: T.accent }, T);
  const sens = Array.from(b.sens);
  const sMax = Math.max(0.5, Math.ceil(Math.max(...sens.map(Math.abs)) * 10) / 10);
  viz.drawHistogram($('histSens').getContext('2d'), 300, 150, sens, { min: -sMax, max: sMax, title: 'Mood sensitivity', color: T.amber }, T);
  const R = b.ruleNow();
  const x = (v) => `×${v.toFixed(2)}`;
  $('ruleBox').innerHTML = S.cfg.learn.evolveRule
    ? `<table><tbody><tr><th colspan="2">Learning rule evolution chose</th></tr>
        <tr><td>Learning speed</td><td class="v">${x(R.eta / S.cfg.learn.eta)}</td></tr>
        <tr><td>Weight of rewards</td><td class="v">${x(R.reward / S.cfg.learn.reward)}</td></tr>
        <tr><td>Weight of pain</td><td class="v">${x(R.pain / S.cfg.pain.strength)}</td></tr>
        <tr><td>Forgetting per answer</td><td class="v">${(R.forget * 100).toFixed(2)}%</td></tr></tbody></table>`
    : '<p class="hint">Switch on <b>Self-tuning learning</b> and Evolve to see the learning rule evolution picks.</p>';
  renderLedger(S.lastParts);
  if (!S.watchOn) viz.drawNeurons($('neuronView').getContext('2d'), 620, 330, S.watch.brain, T);
}

function runProbe() {
  const per = Math.min(200, S.train.mode === 'faces' ? Math.min(S.train.byLabel[0].length, S.train.byLabel[1].length) : 200);
  const r = probeFrontEnd(S.cfg, S.train, per, 5, 10);
  const verdict = r.test < 0.6 ? 'This eye barely carries the answer - a better brain alone won\'t fix that. Try Sharp centre or Edge boost.'
    : r.test < 0.8 ? 'The answer is partly visible to this eye.' : 'The answer is clearly visible to this eye.';
  $('probeResult').innerHTML = `<table><tbody>
    <tr><td>From one glance</td><td class="v"><b>${pct(r.test)}</b></td></tr>
    <tr><td>From 10 slightly shifted glances, added up</td><td class="v"><b>${pct(r.testEnsembled)}</b></td></tr></tbody></table>
    <p class="hint">${verdict} (A simple reader trained on what the eye sends, scored on pictures it didn't train on. It ignores the brain entirely.)</p>`;
}

// ---------------------------------------------------------------- saving
function checkpoint() {
  return {
    v: 4, brainVersion: BRAIN_VERSION, savedAt: Date.now(), taskId: S.taskId,
    build: { eyes: $('eyes').value, eyeLayout: $('eyeLayout').value, eyeRes: $('eyeRes').value, core: $('core').value },
    settings: readRewards(),
    gen: S.gen, theta: Array.from(S.es.theta), hist: S.hist.slice(-400), histKind: S.histKind, lifeEp: S.lifeEp || 0,
    life: S.lifeState ? { Wp: Array.from(S.lifeState.Wp), fmean: Array.from(S.lifeState.fmean), rmean: S.lifeState.rmean ? Array.from(S.lifeState.rmean) : null, ovar: S.lifeState.ovar ? Array.from(S.lifeState.ovar) : null, n: S.lifeState.n } : null,
    wiring: S.wiring, shape: { key: shapeKey(S.cfg), paramCount: S.es.n },
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
async function kvSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); }
async function kvGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
function autosave() { if (S.es && (S.gen || S.lifeEp)) kvSet(SAVE_KEY, checkpoint()).catch(() => {}); }

function describe(ck) {
  const t = TASKS.find((x) => x.id === ck.taskId);
  const parts = [t ? t.name : ck.taskId];
  if (ck.gen) parts.push(`evolved ${ck.gen} generations`);
  if (ck.lifeEp) parts.push(`${ck.lifeEp} learning sessions`);
  return parts.join(', ');
}

// A saved fly carries its settings: loading it restores the challenge, abilities and brain build.
async function restore(ck) {
  if (!ck || ck.v !== 4) throw new Error('this file is from an older version of the app and can\'t be loaded');
  if (ck.brainVersion !== BRAIN_VERSION) throw new Error('this fly was saved with a different brain design and can\'t be loaded here');
  for (const k in ck.build) $(k).value = ck.build[k];
  writeRewards(ck.settings);
  S.wiring = ck.wiring || null;
  await setTask(ck.taskId, true);
  S.busy = true;
  try {
    S.cfg = readCfg();
    buildRunners(); await buildPool();
    if (ck.shape.paramCount !== S.runner.brain.paramCount) throw new Error('this fly\'s brain doesn\'t fit these settings');
    S.es = new ES(Float32Array.from(ck.theta), { ...S.cfg.es, seed: Date.now() % 100000 });
    S.gen = ck.gen; S.hist = ck.hist || []; S.histKind = ck.histKind || null; S.lifeEp = ck.lifeEp || 0;
    S.lifeState = ck.life ? { Wp: Float32Array.from(ck.life.Wp), fmean: Float32Array.from(ck.life.fmean), rmean: ck.life.rmean ? Float32Array.from(ck.life.rmean) : null, ovar: ck.life.ovar ? Float32Array.from(ck.life.ovar) : null, n: ck.life.n } : null;
    S.watchParams = Float32Array.from(ck.theta); S.watchStarted = false;
    syncAbilitySwitches();
    const last = S.hist[S.hist.length - 1];
    refreshScore(last?.acc, 'correct at the last save', describe(ck));
  } finally { S.busy = false; syncButtons(); }
}

// ---------------------------------------------------------------- wiring the page together
function initUI() {
  fillIcons();
  $('logo').innerHTML = ICONS.fly;
  const d = DEFAULTS;
  $('eyes').value = d.eye.eyes; $('core').value = d.brain.core;
  $('pairs').value = d.es.pairs; $('sigma').value = d.es.sigma; $('lr').value = d.es.lr; $('eps').value = d.es.episodesPerCandidate;
  $('workers').value = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  buildRewardUI();
  // abilities start at the recommended defaults
  for (const a of ABILITIES) writeRewards(DEFAULT_ABILITIES[a.id] ? a.on : a.off);
  renderTasks();
  renderAbilityList($('abilityList'), abilitiesOf(readCfg()), setAbility);

  document.querySelectorAll('.tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
  $('btnPlay').onclick = () => setWatch(!S.watchOn);
  seg('speedSeg', (v) => { S.speed = +v; });
  seg('picsSeg', (v) => { S.watchTest = v === 'test'; S.watchStarted = false; });
  seg('distSeg', (v) => { $(rwId('screen.distance')).value = v; S.watchStarted = false; applySettings(); });
  $('btnQuick').onclick = () => toggleTraining('life');
  $('btnEvolve').onclick = () => toggleTraining('evo');
  $('btnExam').onclick = () => guarded(async () => runExam());
  $('btnProbe').onclick = () => guarded(async () => runProbe());
  $('btnAbilDefault').onclick = () => { for (const a of ABILITIES) writeRewards(DEFAULT_ABILITIES[a.id] ? a.on : a.off); applySettings(); };
  $('btnRewardDefaults').onclick = () => {
    for (const row of REWARD_UI) if (row.length > 2) { const [g, k] = row[0].split('.'); $(rwId(row[0])).value = DEFAULTS[g][k]; }
    for (const a of ABILITIES) writeRewards(DEFAULT_ABILITIES[a.id] ? a.on : a.off);
    const t = task(); writeRewards(t.cfg);
    applySettings();
  };
  for (const id of ['eyes', 'eyeLayout', 'eyeRes', 'core', 'workers']) $(id).onchange = () => applySettings();
  for (const id of ['pairs', 'sigma', 'lr', 'eps']) $(id).onchange = () => { S.cfg = readCfg(); if (S.es) S.es.o = { ...S.cfg.es, seed: S.es.o.seed }; };
  $('btnReset').onclick = () => { if (confirm('Start over with a brand-new fly? The current one is lost unless you saved it.')) guarded(async () => { await newBrain(); toast('A brand-new fly. It knows nothing yet.'); }); };
  $('btnSave').onclick = () => {
    const blob = new Blob([JSON.stringify(checkpoint())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `fly-${S.taskId}-${S.gen ? 'gen' + S.gen : S.lifeEp + 'sessions'}.json`; a.click();
    URL.revokeObjectURL(a.href);
    toast('Saved. Load it again any time with "Load fly".');
  };
  $('btnLoad').onclick = () => $('fileLoad').click();
  $('fileLoad').onchange = async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    try { await restore(JSON.parse(await f.text())); toast(`Loaded ${f.name}.`); } catch (e) { toast('Could not load that file: ' + e.message, 6000); }
  };
  $('btnFullFaces').onclick = () => guarded(async () => {
    const status = (t) => { $('faceSrc').textContent = t; };
    S.faces = await loadFacesFromFolder(1500, status);
    S.faceSource = 'folder';
    status(`Using your local photo folder: ${S.faces.train.size} practice and ${S.faces.test.size} exam photos.`);
    if (S.taskId === 'faces') { S.busy = false; await setTask('faces'); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { S.T = viz.readTheme(); refreshScore(); draw(); });
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); setWatch(!S.watchOn); } });
}

function showTab(name) {
  S.tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => { b.classList.toggle('active', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'brain') drawBrainTab();
  if (name === 'compare') S.compare?.onShow();
}

async function main() {
  S.T = viz.readTheme();
  initUI();
  S.cfg = readCfg();
  await setTask('brightness', true);
  await guarded(async () => { await newBrain(); resetWatch(); draw(); });
  S.compare = initCompare({
    S, $, log, toast, taskSets, readCfg, renderAbilityList, currentAbilities, syncButtons,
  });
  // the full-folder option only makes sense when node server.js is serving a bigger folder
  fetch('api/dataset').then((r) => (r.ok ? r.json() : null)).then((l) => {
    if (l && l.men.length + l.women.length > 3330) { $('btnFullFaces').hidden = false; $('faceSrc').textContent += ` Your local folder has ${l.men.length + l.women.length}.`; }
  }).catch(() => {});
  startWatchLoop();
  window.__fly = S; // handy for debugging in the console
  // Never resume behind your back: offer it. Checked in the background, so the app is ready at once
  // even when browser storage is slow (or paused, as it is in a tab that isn't visible).
  const ck = await kvGet(SAVE_KEY).catch(() => null);
  if (ck && ck.v === 4 && ck.brainVersion === BRAIN_VERSION && !S.gen && !S.lifeEp) {
    const b = $('banner');
    b.innerHTML = `<span>Welcome back. Continue with your saved fly <b>(${describe(ck)})</b>?</span>`;
    const yes = document.createElement('button'); yes.className = 'btn primary'; yes.textContent = 'Continue';
    const no = document.createElement('button'); no.className = 'btn'; no.textContent = 'No, start fresh';
    yes.onclick = async () => { b.hidden = true; try { await restore(ck); toast('Welcome back - your fly is ready.'); } catch (e) { toast(e.message, 6000); } };
    no.onclick = () => { b.hidden = true; };
    b.append(yes, no); b.hidden = false;
  }
}

main();
