// The swarm card on the Train tab: many flies, each looking at the photos from its own spot, vote on every
// answer. Each fly trains in its own Web Worker (Quick learn), then answers the never-seen exam photos;
// the page adds up their scaled margins. With boosting the flies join in rounds and each round practises on
// the photos the swarm so far gets wrong. Measured (README): one fly 60%, a swarm of 9-25 about 65-66%,
// a boosting swarm of 25 about 68-69%.

import { mergeConfig, DEFAULTS } from './config.js';
import { TASKS, setupConfig } from './abilities.js';
import { gazeSpots, gazeConfig, balanced, flyScore, scaledScores, mistakeCorrelation, boostWeights, flySay } from './swarm.js';
import * as viz from './viz.js';

const SECONDS_PER_FLY = 18; // rough: training 150 sessions + answering the exam photos, on one core

export function initSwarm(ctx) {
  const { S, $, log, toast, taskSets, readCfg, currentAbilities, syncButtons } = ctx;
  let size = 25, episodes = 150, userBoost = true, running = null;
  const LOOKS = 4, RADIUS = 12; // each fly also takes 4 looks (mirrored, a little nearer and further) at every exam photo; gaze circle in degrees

  const segClick = (id, set) => $(id).querySelectorAll('button').forEach((b) => b.onclick = () => {
    $(id).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); set(b.dataset.v); refresh();
  });
  segClick('swSize', (v) => { size = +v; });
  segClick('swEps', (v) => { episodes = +v; });
  segClick('swBoost', (v) => { userBoost = v === '1'; });

  // the current fly's numbers and brain build with this challenge's settings and the given abilities (as in the Compare tab)
  function cfgFor(taskId, abil) {
    const cur = readCfg();
    delete cur.wiring;
    const t = TASKS.find((x) => x.id === taskId);
    const taskKeys = {};
    for (const x of TASKS) for (const g in x.cfg) for (const k in x.cfg[g]) { taskKeys[g] ||= {}; taskKeys[g][k] = DEFAULTS[g][k]; }
    return JSON.parse(JSON.stringify(mergeConfig(setupConfig(taskId, abil), mergeConfig(mergeConfig(t.cfg, taskKeys), cur))));
  }

  function refresh() {
    const workers = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
    const secs = Math.ceil(size / workers) * SECONDS_PER_FLY * (0.35 + 0.65 * episodes / 150) * (userBoost && size >= 15 ? 1.1 : 1);
    $('swarmEta').textContent = running ? '' : `${size} flies on ${workers} core${workers > 1 ? 's' : ''}: about ${secs < 90 ? Math.ceil(secs) + ' seconds' : Math.round(secs / 60) + ' minutes'}.`;
    const notes = [];
    if (S.taskId !== 'faces') notes.push('The swarm works on the face photos, so it will use "Man or woman" whatever challenge is picked above.');
    if (userBoost && size < 15) notes.push('Boosting only pays off from about 15 flies on (measured), so a swarm of ' + size + ' votes without it.');
    $('swarmNote').textContent = notes.join(' ');
  }

  // where the flies look: a circle of gaze centres, coloured by how well each fly does alone
  function drawMap(accs) {
    const cv = $('swarmMap'), c = cv.getContext('2d'), W = cv.width, H = cv.height, T = S.T, spots = gazeSpots(accs.length || size, RADIUS);
    c.fillStyle = T.bg; c.fillRect(0, 0, W, H);
    const sc = (Math.min(W, H) / 2 - 18) / (RADIUS * 1.15), cx = W / 2, cy = H / 2;
    c.strokeStyle = T.line; c.lineWidth = 1; c.beginPath(); c.arc(cx, cy, RADIUS * sc, 0, 7); c.stroke();
    c.strokeStyle = T.line; c.strokeRect(cx - 12 * sc * 1.3, cy - 12 * sc * 1.5, 12 * sc * 2.6, 12 * sc * 3); // a photo
    spots.forEach(([a, b], i) => {
      const acc = accs[i]; c.beginPath(); c.arc(cx + a * sc, cy + b * sc, 6, 0, 7);
      c.fillStyle = acc == null ? T.line : acc >= 0.6 ? T.green : acc >= 0.55 ? T.accent : T.amber; c.fill();
    });
    c.fillStyle = T.mut; c.font = '11px system-ui'; c.textAlign = 'center'; c.fillText('each dot: where one fly looks', cx, H - 4);
  }

  async function run() {
    if (running || S.comparing) return;
    const boost = userBoost && size >= 15; // measured: boosting only pays off from about 15 flies on (a swarm of 10 that boosts scored 61% against 64% without)
    if (S.training) { S.training = false; syncButtons(); toast('Training paused so the swarm gets the whole computer.'); }
    S.comparing = true; syncButtons();
    $('btnSwarm').disabled = true; $('btnSwarmCancel').hidden = false; $('swarmProgress').hidden = false; $('swarmEta').textContent = '';
    const bar = $('swarmProgress').querySelector('i'), txt = $('swarmProgress').querySelector('span');
    $('swarmNum').textContent = '–'; $('swarmSub').textContent = 'Training…'; S.swarmHist = [];
    try {
      txt.textContent = 'Getting the photos ready...';
      const sets = await taskSets('faces');
      const abil = { ...currentAbilities(), memory: true, fovea: true }; // the swarm needs the memory centre and the sharp centre (so each fly sees a different part of the face)
      const base = cfgFor('faces', abil);
      const trainL = Array.from(sets.train.labels), testL = Array.from(sets.test.labels), nTe = testL.length;
      const per = boost ? 5 : size, rounds = boost ? Math.max(1, Math.round(size / 5)) : 1, K = per * rounds;
      const spots = gazeSpots(K, RADIUS);
      const flies = [], frac = new Array(K).fill(0), t0 = performance.now();
      running = { workers: [], cancelled: false };
      let weights = null, trainScores = [], says = [];
      const update = (single) => {
        const f = frac.reduce((s, x) => s + x, 0) / K;
        bar.style.width = `${(f * 100).toFixed(1)}%`;
        const el = (performance.now() - t0) / 1000, left = f > 0.03 ? el / f - el : null;
        txt.textContent = `${flies.length} of ${K} flies trained` + (boost ? ` · round ${Math.min(rounds, Math.floor(flies.length / per) + 1)} of ${rounds}` : '') + (left != null ? ` · about ${left < 90 ? Math.ceil(left) + ' s' : Math.ceil(left / 60) + ' min'} left` : '');
        if (single) drawMap(spots.map((_, i) => (flies[i] ? balanced(testL, (q) => flyScore(flies[i].test, q, LOOKS, 1)) : null)));
      };
      const scoresNow = () => scaledScores(flies.map((f) => f.test), nTe, LOOKS);
      const swarmAcc = (sc) => balanced(testL, (i) => sc.reduce((a, s) => a + s[i], 0));
      for (let r = 0; r < rounds && !running.cancelled; r++) {
        const jobs = Array.from({ length: per }, (_, j) => {
          const idx = boost ? j * rounds + r : j; // every round covers the whole circle
          return { slot: flies.length + j, cfg: mergeConfig(gazeConfig(spots[idx]), base), seed: 1 + r * per + j, spot: idx };
        });
        const out = new Array(per), jobFlies = new Array(per);
        let next = 0;
        const n = Math.min(per, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
        const lane = () => new Promise((resolve, reject) => {
          const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
          running.workers.push(w);
          let cur = -1;
          const give = () => {
            if (running.cancelled || next >= per) { w.terminate(); return resolve(); }
            cur = next++;
            const j = jobs[cur];
            w.postMessage({ type: 'swarmfly', id: cur, cfg: j.cfg, train: sets.train.toMessage(), test: sets.test.toMessage(), seed: j.seed, episodes, looks: LOOKS, weights, trainMargins: boost });
          };
          w.onmessage = (ev) => {
            const m = ev.data;
            if (m.type === 'progress') { frac[jobs[m.id].slot] = m.frac; update(); return; }
            if (m.type === 'error') { w.terminate(); return reject(new Error(m.message)); }
            if (m.type === 'result') {
              out[m.id] = m.results; frac[jobs[m.id].slot] = 1;
              jobFlies[m.id] = { test: m.results.test, train: m.results.train, spot: jobs[m.id].spot, say: 1 }; flies.push(jobFlies[m.id]);
              const sc = scoresNow(), acc = swarmAcc(sc);
              S.swarmHist.push({ gen: flies.length, acc });
              $('swarmNum').textContent = `${(acc * 100).toFixed(0)}%`;
              $('swarmNum').style.color = acc >= 0.65 ? 'var(--green)' : 'var(--accent)';
              viz.drawAccuracy($('swarmChart').getContext('2d'), $('swarmChart').width, $('swarmChart').height, S.swarmHist, 'flies in the swarm', S.T);
              update(true);
              give();
            }
          };
          w.onerror = (e) => reject(new Error(e.message || 'worker failed'));
          give();
        });
        await Promise.all(Array.from({ length: n }, lane));
        if (running.cancelled) break;
        if (boost) { // each fly's say (from its error on the photos as weighted when it practised); the swarm so far then tells the next round which photos are hard
          const wNow = weights || new Array(trainL.length).fill(1);
          out.forEach((o, q) => {
            const m = o.train.margin, sd = Math.sqrt(m.reduce((s, v) => s + v * v, 0) / m.length) || 1, sy = flySay(trainL, m, wNow).say;
            jobFlies[q].say = sy; says.push(sy); trainScores.push(m.map((v) => v / sd));
          });
          if (r < rounds - 1) weights = boostWeights(trainL, trainScores, says, 1, 4);
        }
      }
      if (running.cancelled) { $('swarmSub').textContent = 'Cancelled.'; return; }
      const sc = scoresNow(), equalAcc = swarmAcc(sc), weightedAcc = boost ? balanced(testL, (i) => sc.reduce((a, s, k) => a + flies[k].say * s[i], 0)) : equalAcc;
      const acc = boost && K >= 15 ? weightedAcc : equalAcc; // with boosting, votes weighted by each fly's say came out ahead from 15 flies on (README)
      const singles = flies.map((f) => balanced(testL, (q) => flyScore(f.test, q, LOOKS, 1)));
      const one = singles.reduce((a, b) => a + b, 0) / singles.length, best = Math.max(...singles), corr = mistakeCorrelation(testL, flies.map((f) => Array.from({ length: nTe }, (_, i) => flyScore(f.test, i, LOOKS, 1))));
      $('swarmNum').textContent = `${(acc * 100).toFixed(1)}%`;
      $('swarmSub').textContent = `Swarm of ${K}${boost ? (K >= 15 ? ' (boosting, votes weighted by each fly\u2019s say)' : ' (boosting)') : ''} on ${nTe} photos it never saw, men and women counted equally (guessing 50%). Equal votes: ${(equalAcc * 100).toFixed(1)}%. One fly alone: ${(one * 100).toFixed(1)}% on average, the best ${(best * 100).toFixed(1)}%. Mistakes alike: ${corr.toFixed(2)} (0 = independent, 1 = identical).`;
      drawMap(spots.map((_, i) => { const f = flies.find((x) => x.spot === i); return f ? balanced(testL, (q) => flyScore(f.test, q, LOOKS, 1)) : null; }));
      log(`swarm of ${K}${boost ? ' boosting' : ''}, ${episodes} sessions each: ${(acc * 100).toFixed(1)}% (one fly ${(one * 100).toFixed(1)}%)`);
    } catch (e) {
      $('swarmSub').textContent = 'Something went wrong: ' + e.message;
      console.error(e);
    } finally {
      running?.workers.forEach((w) => w.terminate());
      running = null; S.comparing = false; syncButtons();
      $('btnSwarm').disabled = false; $('btnSwarmCancel').hidden = true; $('swarmProgress').hidden = true;
      refresh();
    }
  }

  $('btnSwarm').onclick = run;
  $('btnSwarmCancel').onclick = () => { if (running) { running.cancelled = true; running.workers.forEach((w) => w.terminate()); } };
  drawMap([]); refresh();
  return { refresh, run, setOptions(o) { if (o.size) { size = o.size; } if (o.episodes) episodes = o.episodes; if (o.boost != null) userBoost = o.boost; const mark = (id, v) => $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); mark('swSize', size); mark('swEps', episodes); mark('swBoost', userBoost ? 1 : 0); refresh(); } };
}
