// The Compare tab: "is this ability actually worth it?" Trains fresh flies with and without it,
// in pairs that start from the same luck, examines each on never-seen pictures, and says in plain
// words whether the difference is bigger than chance. Trials run in their own Web Workers.

import { mergeConfig, DEFAULTS } from './config.js';
import { TASKS, ABILITIES, MEASURED, setupConfig } from './abilities.js';
import { compareRuns, verdict } from './stats.js';
import * as viz from './viz.js';

const SECONDS_PER_TRIAL = { quick: 6, thorough: 95 }; // rough, on one core

export function initCompare(ctx) {
  const { S, $, log, toast, taskSets, readCfg, renderAbilityList, currentAbilities, syncButtons } = ctx;
  let method = 'quick', seeds = 5, running = null, customA = {}, customB = {}, last = null;

  const taskSel = $('cmpTask'), abSel = $('cmpAbility');
  for (const t of TASKS) taskSel.add(new Option(t.name, t.id));
  for (const a of ABILITIES) abSel.add(new Option(a.name, a.id));
  abSel.add(new Option('Custom setups (A vs B)...', 'custom'));
  const segClick = (id, set) => $(id).querySelectorAll('button').forEach((b) => b.onclick = () => {
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); set(b.dataset.v); refresh();
  });
  segClick('cmpMethod', (v) => { method = v; });
  segClick('cmpSeeds', (v) => { seeds = +v; });
  taskSel.onchange = refresh;
  abSel.onchange = () => {
    if (abSel.value === 'custom') {
      customA = { ...currentAbilities() }; customB = { ...currentAbilities() };
      renderAbilityList($('cmpA'), customA, (id, on) => { customA[id] = on; refresh(); }, { compact: true });
      renderAbilityList($('cmpB'), customB, (id, on) => { customB[id] = on; refresh(); }, { compact: true });
    }
    refresh();
  };

  function setups() {
    const ab = abSel.value;
    if (ab === 'custom') return { A: customA, B: customB, nameA: 'Setup A', nameB: 'Setup B' };
    const base = currentAbilities(), a = ABILITIES.find((x) => x.id === ab);
    return { A: { ...base, [ab]: false }, B: { ...base, [ab]: true }, nameA: `without ${a.name}`, nameB: `with ${a.name}` };
  }

  // Current fly's numbers and brain build, with this challenge's settings and these abilities.
  function cfgFor(taskId, abil) {
    const cur = readCfg();
    delete cur.wiring;
    const t = TASKS.find((x) => x.id === taskId);
    const taskKeys = {};
    for (const x of TASKS) for (const g in x.cfg) for (const k in x.cfg[g]) { taskKeys[g] ||= {}; taskKeys[g][k] = DEFAULTS[g][k]; }
    return JSON.parse(JSON.stringify(mergeConfig(setupConfig(taskId, abil), mergeConfig(mergeConfig(t.cfg, taskKeys), cur))));
  }

  function refresh() {
    $('cmpCustom').hidden = abSel.value !== 'custom';
    const { A, B } = setups();
    const differ = ABILITIES.filter((a) => !!A[a.id] !== !!B[a.id]);
    const notes = [];
    if (!differ.length) notes.push('Setups A and B are identical - switch something on in one of them.');
    const evoOnly = differ.filter((a) => a.needsEvolve);
    if (evoOnly.length && method === 'quick') notes.push(`${evoOnly.map((a) => a.name).join(', ')} only get${evoOnly.length > 1 ? '' : 's'} better through evolution, so with Quick learn it would be compared untrained. Choose Evolve.`);
    $('cmpHint').textContent = notes.join(' ');
    const workers = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    const secs = Math.ceil((2 * seeds) / workers) * SECONDS_PER_TRIAL[method] * (taskSel.value === 'faces' ? 1.2 : 1);
    $('cmpEta').textContent = running ? '' : `Takes about ${secs < 90 ? secs + ' seconds' : Math.round(secs / 60) + ' minutes'}.`;
  }

  function drawResult(res, names) {
    last = { res, names };
    viz.drawCompare($('cmpChart').getContext('2d'), 620, 280, { a: res.A, b: res.B, nameA: names.nameA, nameB: names.nameB }, S.T);
  }

  async function run() {
    const { A, B, nameA, nameB } = setups();
    const taskId = taskSel.value, t = TASKS.find((x) => x.id === taskId);
    if (S.training) { S.training = false; toast('Training paused so the comparison gets the whole computer.'); }
    S.comparing = true; syncButtons();
    $('btnCompare').disabled = true; $('btnCmpCancel').hidden = false; $('cmpProgress').hidden = false; $('cmpEta').textContent = '';
    const bar = $('cmpProgress').querySelector('i'), txt = $('cmpProgress').querySelector('span');
    const res = { A: new Array(seeds).fill(null), B: new Array(seeds).fill(null) };
    const names = { nameA, nameB };
    drawResult(res, names);
    $('cmpVerdict').textContent = 'Running...'; $('cmpDetail').textContent = '';
    try {
      txt.textContent = 'Getting the pictures ready...';
      const sets = await taskSets(taskId);
      const cfgs = { A: cfgFor(taskId, A), B: cfgFor(taskId, B) };
      const jobs = [];
      for (let s = 1; s <= seeds; s++) for (const who of ['A', 'B']) jobs.push({ who, seed: s });
      const n = Math.min(jobs.length, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
      const frac = new Array(jobs.length).fill(0), t0 = performance.now();
      const workers = [];
      running = { workers, cancelled: false };
      const update = () => {
        const f = frac.reduce((s, x) => s + x, 0) / jobs.length;
        bar.style.width = `${(f * 100).toFixed(1)}%`;
        const el = (performance.now() - t0) / 1000, left = f > 0.03 ? el / f - el : null;
        const done = res.A.filter((x) => x != null).length + res.B.filter((x) => x != null).length;
        txt.textContent = `${done} of ${jobs.length} flies trained and examined` + (left != null ? ` · about ${left < 90 ? Math.ceil(left) + ' s' : Math.ceil(left / 60) + ' min'} left` : '');
      };
      let next = 0;
      const lane = () => new Promise((resolve, reject) => {
        const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
        workers.push(w);
        let cur = -1;
        const give = () => {
          if (running.cancelled || next >= jobs.length) { w.terminate(); return resolve(); }
          cur = next++;
          const j = jobs[cur];
          w.postMessage({ type: 'trial', id: cur, cfg: cfgs[j.who], train: sets.train.toMessage(), test: sets.test.toMessage(), method, seed: j.seed });
        };
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'progress') { frac[m.id] = m.frac; update(); return; }
          if (m.type === 'error') { w.terminate(); return reject(new Error(m.message)); }
          if (m.type === 'result') {
            const j = jobs[m.id];
            res[j.who][j.seed - 1] = m.results.acc; frac[m.id] = 1;
            update(); drawResult(res, names);
            give();
          }
        };
        w.onerror = (e) => reject(new Error(e.message || 'worker failed'));
        give();
      });
      await Promise.all(Array.from({ length: n }, lane));
      if (running.cancelled) { $('cmpVerdict').textContent = 'Cancelled.'; return; }
      const r = compareRuns(res.A, res.B);
      $('cmpVerdict').textContent = verdict(r, nameA, nameB);
      $('cmpDetail').textContent = `${t.name}, ${method === 'quick' ? 'Quick learn' : 'Evolve'}, ${seeds} flies each. Each score is out of the exam pictures (never seen in training). `
        + `Average: ${nameA} ${(r.meanA * 100).toFixed(1)}%, ${nameB} ${(r.meanB * 100).toFixed(1)}%.`;
      log(`compare ${t.name} ${method} x${seeds}: ${nameA} ${(r.meanA * 100).toFixed(1)}% vs ${nameB} ${(r.meanB * 100).toFixed(1)}%  (diff ${(r.diff * 100).toFixed(1)} +- ${(r.margin * 100).toFixed(1)})`);
    } catch (e) {
      $('cmpVerdict').textContent = 'Something went wrong: ' + e.message;
      console.error(e);
    } finally {
      running?.workers.forEach((w) => w.terminate());
      running = null; S.comparing = false; syncButtons();
      $('btnCompare').disabled = false; $('btnCmpCancel').hidden = true; $('cmpProgress').hidden = true;
      refresh();
    }
  }

  $('btnCompare').onclick = run;
  $('btnCmpCancel').onclick = () => { if (running) { running.cancelled = true; running.workers.forEach((w) => w.terminate()); } };

  // the built-in measured results
  const m = MEASURED;
  $('measuredTable').innerHTML = m.length ? `<table><thead><tr><th>Ability</th><th>Challenge</th><th>Training</th><th class="v">Without</th><th class="v">With</th><th>Verdict</th></tr></thead><tbody>${
    m.map((r) => `<tr><td>${ABILITIES.find((a) => a.id === r.ability).name}${r.with ? ` <span class="mut">(+ ${r.with})</span>` : ''}</td><td>${TASKS.find((t) => t.id === r.task).name}</td><td>${r.method === 'quick' ? 'Quick' : 'Evolve'}</td>`
      + `<td class="v">${(r.a * 100).toFixed(1)}%</td><td class="v">${(r.b * 100).toFixed(1)}%</td>`
      + `<td class="${r.clear ? (r.diff > 0 ? 'pos' : 'neg') : 'mut'}">${r.clear ? (r.diff > 0 ? 'better' : 'worse') + ` by ${(Math.abs(r.diff) * 100).toFixed(0)} pts` : 'no clear difference'}</td></tr>`).join('')
  }</tbody></table>` : '<p class="hint">No measurements bundled yet.</p>';

  return {
    onShow() {
      if (!running) { taskSel.value = S.taskId; refresh(); }
      if (last) drawResult(last.res, last.names); else drawResult({ A: [], B: [] }, { nameA: 'Setup A', nameB: 'Setup B' });
    },
  };
}
