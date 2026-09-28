// Route following over a Wonderland maze. A fly is trained by flights along a predetermined route
// (the maze's way through) with a teacher, learning by reward and pain which wing to beat harder
// (steer left or right) from the view straight down. Then it is released at random points near the
// route, with a wrong heading, learning frozen, and must reach the goal from what it sees alone.
//
// Usage: node tools/route.mjs [--cells 6] [--wobble 0.6] [--variety 0.7] [--worlds 2] [--seeds 3]
//        [--flights 40] [--releases 30] [--alt 0] (height jitter while training and testing, e.g. 0.15)
//        [--setups raw,memory,colour,edges,fovea] [--png out.png]
//        [--test-variant 1] (test over a slightly changed version of the maze)
//        [--policy steer|familiar] [--kc 4000] [--sparsity 0.02] (memory-centre size for familiarity)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mergeConfig } from '../src/config.js';
import { setupConfig } from '../src/abilities.js';
import { Brain } from '../src/brain.js';
import { mulberry32 } from '../src/rng.js';
import { makeWonderland } from '../src/route/terrain.js';
import { RouteFlight } from '../src/route/flight.js';
import { encodePNG } from './png.mjs';
import { mapImage } from './route-map.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

// what each setup switches on (everything else off)
export const SETUPS = {
  raw: {},
  memory: { memory: true },
  colour: { memory: true, colour: true },
  edges: { memory: true, colour: true, orient: true, edges: true },
  fovea: { memory: true, colour: true, orient: true, edges: true, fovea: true },
};
const TURN = (10 * Math.PI) / 180; // radians per step
const gauss = (r) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / Math.SQRT1_2; };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

function tangent(world, i) { const { x, y } = world.route, j = Math.min(x.length - 1, i + 4), k = Math.max(0, i - 4); return Math.atan2(y[j] - y[k], x[j] - x[k]); }

// fly one flight; policy(p) returns +1 (right) or -1 (left) or a turn in radians (teacher)
function fly(world, F, p, policy, { maxSteps, onStep }) {
  const speed = world.cell / 8, goalS = world.route.length - 0.3 * world.cell, track = [];
  F.hint = F.nearest(p, true).i;
  let s0 = F.nearest(p).s, maxS = s0, dev = 0, n = 0, reached = false, lost = false;
  for (let t = 0; t < maxSteps; t++) {
    const turn = policy(p);
    p.th = wrap(p.th + turn);
    p.x += speed * Math.cos(p.th); p.y += speed * Math.sin(p.th);
    const nr = F.nearest(p);
    maxS = Math.max(maxS, nr.s); dev += nr.d; n++; track.push([p.x, p.y]);
    onStep?.(nr);
    if (nr.s >= goalS && nr.d < 0.6 * world.cell) { reached = true; break; }
    if (nr.d > 1.5 * world.cell) { lost = true; break; }
  }
  const remaining = world.route.length - s0;
  return { reached, lost, progress: Math.max(0, Math.min(1, (maxS - s0) / Math.max(1, remaining))), dev: dev / Math.max(1, n) / world.cell, track };
}

function releasePose(world, r, alt, spanEnd = 0.7) {
  const n = world.route.x.length, i = Math.floor(r() * n * spanEnd), th0 = tangent(world, i);
  const off = (r() * 2 - 1) * 0.35 * world.cell;
  return { x: world.route.x[i] - Math.sin(th0) * off, y: world.route.y[i] + Math.cos(th0) * off, th: wrap(th0 + (r() * 2 - 1) * (Math.PI / 4)), alt: Math.exp((r() * 2 - 1) * alt) };
}

// train one fly on one world and test it; returns scores (and tracks for a picture)
// policy 'steer': learn by reward and pain which wing to beat (left/right) from the view.
// policy 'familiar': the way ants and bees are thought to do it. While flying the route (with the
// teacher), every view makes the Kenyon cells that fire for it "familiar": their synapses onto a
// novelty output neuron are silenced, as dopamine does in the mushroom body. To navigate, the fly
// looks in a few directions and flies the way that looks most familiar. It never learns the route
// itself, only what the world looked like while it was on it.
const SCAN = [-60, -45, -30, -15, 0, 15, 30, 45, 60].map((d) => (d * Math.PI) / 180);
export function trial({ worldOpts, setup, seed, flights = 40, releases = 30, alt = 0, policy = 'steer', kc = 0, sparsity = 0, testVariant = 0 }) {
  const world = makeWonderland(worldOpts);
  const over = { eye: { activeVision: 0 }, learn: { anneal: 0 } };
  if (kc) over.mb = { cells: kc, ...(sparsity ? { sparsity } : {}) };
  const cfg = mergeConfig(over, mergeConfig(setupConfig('faces', SETUPS[setup])));
  const brain = new Brain(cfg), theta = brain.initParams(seed);
  brain.setParams(theta); brain.reset(false);
  let F = new RouteFlight(world, cfg);
  const r = mulberry32(seed * 7919 + 17);
  const decide = (b, p) => { F.view(p); const o = b.step(F.retinas, F.touch, F.pain, F.pos, F.chroma); return o[1] > o[0] ? 1 : 0; };
  const onRoute = (k) => { // a training start: near the route, roughly along it
    const n = world.route.x.length, i = Math.floor(r() * n * 0.85), th0 = tangent(world, i), off = gauss(r) * 0.2 * world.cell;
    return { x: world.route.x[i] - Math.sin(th0) * off, y: world.route.y[i] + Math.cos(th0) * off, th: wrap(th0 + gauss(r) * 0.45), alt: Math.exp(gauss(r) * alt) };
  };
  const teacherTurn = (q) => Math.max(-TURN, Math.min(TURN, F.teacher(q).err));
  let testPolicy;
  if (policy === 'familiar') {
    if (!brain.nKC) throw new Error('familiarity needs the memory centre');
    // the "average view" the Kenyon cells are centred on: one teacher flight over the whole route
    const sum = new Float64Array(brain.rv.length); let n = 0;
    fly(world, F, { x: world.start[0], y: world.start[1], th: tangent(world, 0), alt: 1 }, (q) => { F.view(q); brain.step(F.retinas, F.touch, F.pain, F.pos, F.chroma); for (let j = 0; j < sum.length; j++) sum[j] += brain.rv[j]; n++; return teacherTurn(q); }, { maxSteps: 2000 });
    brain.rmean.set(Float32Array.from(sum, (v) => v / n));
    const novel = new Float32Array(brain.nKC).fill(1);
    const see = (p) => { F.view(p); brain.step(F.retinas, F.touch, F.pain, F.pos, F.chroma); return brain.kc; };
    // learning the route: a few passes from start to goal, facing along it (as ants learn a route by
    // walking it), with a little wobble so neighbouring views get learned too. Every view silences the
    // Kenyon cells it uses; learning while turned sideways would make every direction look familiar.
    for (let k = 0; k < flights; k++) {
      const th0 = tangent(world, 0), off = gauss(r) * 0.08 * world.cell;
      const p = { x: world.start[0] - Math.sin(th0) * off, y: world.start[1] + Math.cos(th0) * off, th: wrap(th0 + gauss(r) * 0.05), alt: Math.exp(gauss(r) * alt) };
      fly(world, F, p, (q) => {
        const code = see(q); for (let j = 0; j < code.length; j++) if (code[j]) novel[j] = 0; // this view is now familiar
        return teacherTurn(q) + gauss(r) * 0.03;
      }, { maxSteps: 3000 });
    }
    testPolicy = (q) => {
      let best = Infinity, turn = 0;
      for (const d of SCAN) { const code = see({ ...q, th: q.th + d }); let nov = 0; for (let j = 0; j < code.length; j++) nov += code[j] * novel[j]; if (nov < best || (nov === best && Math.abs(d) < Math.abs(turn))) { best = nov; turn = d; } }
      return turn;
    };
  } else {
    // ---- training flights: the teacher flies part of the time (more at first), the fly the rest;
    // after every step the fly is rewarded if its chosen wing was the one the teacher would have used
    for (let k = 0; k < flights; k++) {
      const teach = Math.max(0.2, 1 - k / flights);
      fly(world, F, onRoute(k), (q) => {
        const foot = decide(brain, q), { err } = F.teacher(q), want = err > 0 ? 1 : 0;
        brain.learn(foot, foot === want);
        return r() < teach ? Math.max(-TURN, Math.min(TURN, err)) : (foot ? TURN : -TURN);
      }, { maxSteps: 400 });
    }
    const frozen = new Brain(mergeConfig({ learn: { eta: 0 } }, cfg));
    frozen.setParams(theta); frozen.reset(false); frozen.setPlastic(brain.getPlastic());
    testPolicy = (q) => (decide(frozen, q) ? TURN : -TURN);
  }
  // ---- test: learning frozen, released near the route with a wrong heading (optionally over a
  // slightly changed version of the maze: same layout and route, different details)
  if (testVariant) F = new RouteFlight(makeWonderland({ ...worldOpts, variant: testVariant }), cfg);
  const rt = mulberry32(900001 + seed), out = { reached: 0, progress: 0, dev: 0, tracks: [], teacher: 0, blind: 0 };
  for (let k = 0; k < releases; k++) {
    const p0 = releasePose(world, rt, alt), maxSteps = Math.ceil((world.route.length / (world.cell / 8)) * 2.5);
    const res = fly(world, F, { ...p0 }, testPolicy, { maxSteps });
    out.reached += res.reached / releases; out.progress += res.progress / releases; out.dev += res.dev / releases;
    if (k < 8) out.tracks.push(res.track);
    // references on the same release: the teacher itself, and a blind fly that flies straight
    out.teacher += fly(world, F, { ...p0 }, (q) => Math.max(-TURN, Math.min(TURN, F.teacher(q).err)), { maxSteps }).progress / releases;
    out.blind += fly(world, F, { ...p0 }, () => 0, { maxSteps }).progress / releases;
  }
  return { out, world };
}

// ---------------------------------------------------------------- child: one trial
const self = fileURLToPath(import.meta.url);
const isMain = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === self.toLowerCase();
if (isMain && args.one) {
  const job = JSON.parse(args.one);
  const { out } = trial(job);
  delete out.tracks;
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ---------------------------------------------------------------- parent
if (isMain && !args.one) {
  const worldBase = { cells: +(args.cells || 6), wobble: +(args.wobble ?? 0.6), variety: +(args.variety ?? 0.7) };
  const worlds = +(args.worlds || 2), seeds = +(args.seeds || 3), setups = (args.setups || 'raw,memory,colour,edges,fovea').split(',');
  const common = { flights: +(args.flights || 40), releases: +(args.releases || 30), alt: +(args.alt || 0), policy: args.policy || 'steer', kc: +(args.kc || 0), sparsity: +(args.sparsity || 0), testVariant: +(args['test-variant'] || 0) };
  const jobs = [];
  for (const setup of setups) for (let w = 1; w <= worlds; w++) for (let s = 1; s <= seeds; s++) jobs.push({ ...common, setup, seed: s, worldOpts: { ...worldBase, seed: w } });
  const runOne = (job) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [self, '--one', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let o = ''; p.stdout.on('data', (d) => (o += d));
    p.on('close', (code) => (code === 0 ? resolve({ job, out: JSON.parse(o) }) : reject(new Error('trial failed'))));
  });
  const t0 = Date.now(), res = [], jobsMax = +(args.jobs || Math.max(1, os.cpus().length - 1));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobsMax, jobs.length) }, async () => { while (next < jobs.length) { const j = next++; res.push(await runOne(jobs[j])); } }));
  const pct = (x) => (x * 100).toFixed(0) + '%';
  console.log(`route following (${common.policy}${common.kc ? ', ' + common.kc + ' Kenyon cells' : ''}): ${worldBase.cells}x${worldBase.cells} maze, wobble ${worldBase.wobble}, variety ${worldBase.variety}, height jitter ${common.alt}${common.testVariant ? ', tested on variant ' + common.testVariant : ''}; ${worlds} worlds x ${seeds} flies per setup, ${common.flights} training flights, ${common.releases} releases each (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log('setup'.padEnd(10) + 'reached goal'.padStart(14) + 'route flown'.padStart(13) + 'off-route'.padStart(12) + '   (teacher / blind: route flown)');
  for (const setup of setups) {
    const rs = res.filter((x) => x.job.setup === setup).map((x) => x.out), m = (k) => rs.reduce((a, o) => a + o[k], 0) / rs.length;
    const per = rs.map((o) => Math.round(o.reached * 100)).join(' ');
    console.log(setup.padEnd(10) + pct(m('reached')).padStart(14) + pct(m('progress')).padStart(13) + (m('dev').toFixed(2) + ' cells').padStart(12) + `   (${pct(m('teacher'))} / ${pct(m('blind'))})   flies: ${per}`);
  }
  if (args.png) { // a picture of one fly's test flights
    const { out, world } = trial({ ...common, setup: setups[setups.length - 1], seed: 1, worldOpts: { ...worldBase, seed: 1 } });
    const cols = [[255, 200, 0], [0, 220, 255], [255, 80, 200], [120, 255, 120], [255, 140, 40], [180, 120, 255], [255, 255, 255], [80, 160, 255]];
    fs.writeFileSync(args.png, encodePNG(world.W, world.H, mapImage(world, out.tracks.map((pts, i) => ({ pts, col: cols[i % cols.length] })))));
    console.log('picture: ' + args.png);
  }
}
