// Route following over a Wonderland maze. A fly is trained by flights along a predetermined route
// (the maze's way through) with a teacher, learning by reward and pain which wing to beat harder
// (steer left or right) from the view straight down. Then it is released at random points near the
// route, with a wrong heading, learning frozen, and must reach the goal from what it sees alone.
//
// Usage: node tools/route.mjs [--cells 6] [--wobble 0.6] [--variety 0.7] [--worlds 2] [--seeds 3]
//        [--flights 40] [--releases 30] [--alt 0] (height jitter while training and testing, e.g. 0.15)
//        [--setups raw,memory,colour,edges,fovea] [--png out.png]
//        [--test-variant 1] (test over a slightly changed version of the maze)
//        [--train-alts 0.5,0.7,1,1.4] (practise the route at these heights) [--banks] (a memory per height)
//        [--test-alt 0.6] (release at this height) [--swarm 5 --gaze 0.25] (flies with gaze centres on a circle)
//        [--cast] (sweep side to side when nothing looks familiar) [--cast-thr 0.1]
//        [--approach 1] (learning flights toward the route from a grid every 1 cell over the map)
//        [--drop] (release anywhere on the map instead of near the route)
//        [--track] (keep a belief of where on the route it is, from its own motion and stored views)
//        [--arrive] (the fly stops when it believes it has arrived; off by default: no gain measured, a few false stops)
//        [--map] (a belief over the whole map from north-up views, used until the route is found)
//        [--weather fog] [--train-weather clear] (clear, haze, fog, overcast, dusk, night, noisy)
//        [--normalize] (contrast filter: every view stretched to the same spread) [--edges] (edge boost)
//        [--aversive] (a wrong-way memory) [--climb 1.4] (climb when unsure) [--row 2,3] (three circles in a row: side,middle members)
//        [--burst 8] (the camera averages 8 frames per step: less noise) [--smooth 1] (spatial smoothing of every view)
//        [--odo-bias 0.02 --odo-noise 0.05 --odo-scale 0.1] (imperfect odometry: heading bias/noise in radians per step, distance scale error)
//        [--w0 3] (start at maze number 3, to test one particular maze)
//        [--calibrate 0.5] (the fly measures how new the best direction looks on and off the route, and judges "on the route" halfway between)
//        [--tilt 10] (the helicopter rolls and pitches: slowly varying random tilts, standard deviation in degrees; the camera is fixed to it)
//        [--tilt-comp --tilt-est 2] (the fly knows its attitude to within 2 degrees and counter-rotates its camera; without --tilt-est: perfectly)
//        [--tilt-train] (also practise the route in rough air)
//        [--yaw-walk 0.01] (a gyro compass: the heading error random-walks, radians per step) [--yaw-compass 0.1] (a sky compass: error each step, radians, does not accumulate)
//        [--flow-odo] (optic flow: the odometer sees the true ground motion, wind included)
//        [--scales 1,0.7,1.4] (swarm members look at the ground zoomed by different amounts: a normal, a close and a wide view)
//        [--map-swarm] (every swarm member also votes in the map localisation) [--map-sharp 20] (a sharper map belief)
//        [--decay 0.9] (how much each learning-flight view dims the cells it uses; default 0.5)
//        [--wind 0.3] (a steady wind of 0.3 x the flying speed, in a random direction, that the fly does not know about)
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
import { FamiliarSwarm, rowOfCircles } from '../src/route/familiar.js';
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
// lostAt: how far from the route (cells) counts as lost; global: search the whole route for the
// nearest point every step (needed when the fly starts far from it)
function fly(world, F, p, policy, { maxSteps, onStep, lostAt = 1.5, global = false, drift = null, att = null }) {
  const speed = world.cell / 8, goalS = world.route.length - 0.3 * world.cell, track = [];
  F.hint = F.nearest(p, true).i;
  let s0 = F.nearest(p).s, maxS = s0, dev = 0, n = 0, reached = false, lost = false, found = false, near = false, falseStop = false;
  const gx = world.route.x[world.route.x.length - 1], gy = world.route.y[world.route.y.length - 1];
  for (let t = 0; t < maxSteps; t++) {
    p.arrived = false;
    if (att) { // the helicopter's roll and pitch: slowly varying random tilts; with compensation only the error of the estimate is left
      att.roll = att.ar * att.roll + Math.sqrt(1 - att.ar ** 2) * att.sd * gauss(att.rng); att.pitch = att.ar * att.pitch + Math.sqrt(1 - att.ar ** 2) * att.sd * gauss(att.rng);
      p.roll = att.comp ? att.est * gauss(att.rng) : att.roll; p.pitch = att.comp ? att.est * gauss(att.rng) : att.pitch;
    }
    if (drift && (drift.walk || drift.compass)) { drift.walkState = (drift.walkState || 0) + (drift.walk || 0) * gauss(drift.rng); p.yawErr = drift.walkState + (drift.compass || 0) * gauss(drift.rng); } // the compass is off
    const turn = policy(p);
    if (p.arrived) { if (Math.hypot(p.x - gx, p.y - gy) < 0.8 * world.cell) near = true; else falseStop = true; break; } // it believes it is at the goal: it stops
    p.th = wrap(p.th + turn);
    if (drift) { // imperfect odometry (its heading is off by a bias plus noise, its distance by a scale error) and wind (a steady push the fly does not know about)
      if (!p.ox) { p.ox = p.x; p.oy = p.y; }
      const e = drift.bias + drift.noise * gauss(drift.rng) + (p.yawErr || 0), sc = 1 + drift.scale;
      const tx = speed * Math.cos(p.th) + drift.wind * speed * Math.cos(drift.windDir), ty = speed * Math.sin(p.th) + drift.wind * speed * Math.sin(drift.windDir);
      // without optic flow the odometer believes it flew exactly as commanded (wind unseen); with it, the odometer sees the true ground motion (still turned by the heading error)
      const bx = drift.flow ? tx : speed * Math.cos(p.th), by = drift.flow ? ty : speed * Math.sin(p.th);
      p.ox += sc * (bx * Math.cos(e) - by * Math.sin(e)); p.oy += sc * (bx * Math.sin(e) + by * Math.cos(e));
      p.x += drift.wind * speed * Math.cos(drift.windDir); p.y += drift.wind * speed * Math.sin(drift.windDir);
    }
    p.x += speed * Math.cos(p.th); p.y += speed * Math.sin(p.th);
    const nr = F.nearest(p, global);
    maxS = Math.max(maxS, nr.s); dev += nr.d; n++; track.push([p.x, p.y]);
    if (nr.d < 0.3 * world.cell) found = true;
    if (Math.hypot(p.x - gx, p.y - gy) < 0.8 * world.cell) near = true;
    onStep?.(nr);
    if (nr.s >= goalS && nr.d < 0.6 * world.cell) { reached = true; break; }
    if (nr.d > lostAt * world.cell || p.x < -world.cell || p.y < -world.cell || p.x > world.W + world.cell || p.y > world.H + world.cell) { lost = true; break; }
  }
  const remaining = world.route.length - s0;
  return { reached, lost, found, near, falseStop, progress: Math.max(0, Math.min(1, (maxS - s0) / Math.max(1, remaining))), dev: dev / Math.max(1, n) / world.cell, track };
}

function releasePose(world, r, alt, spanEnd = 0.7) {
  const n = world.route.x.length, i = Math.floor(r() * n * spanEnd), th0 = tangent(world, i);
  const off = (r() * 2 - 1) * 0.35 * world.cell;
  return { x: world.route.x[i] - Math.sin(th0) * off, y: world.route.y[i] + Math.cos(th0) * off, th: wrap(th0 + (r() * 2 - 1) * (Math.PI / 4)), alt: Math.exp((r() * 2 - 1) * alt) };
}

// dropped anywhere on the map, at least 0.6 cells from the route, facing anywhere
function releaseAnywhere(world, F, r, alt) {
  let p;
  do { p = { x: r() * world.W, y: r() * world.H, th: r() * 2 * Math.PI - Math.PI, alt: Math.exp((r() * 2 - 1) * alt) }; } while (F.nearest(p, true).d < 0.6 * world.cell);
  return p;
}

// train one fly on one world and test it; returns scores (and tracks for a picture)
// policy 'steer': learn by reward and pain which wing to beat (left/right) from the view.
// policy 'familiar': the way ants and bees are thought to do it. While flying the route (with the
// teacher), every view makes the Kenyon cells that fire for it "familiar": their synapses onto a
// novelty output neuron are silenced, as dopamine does in the mushroom body. To navigate, the fly
// looks in a few directions and flies the way that looks most familiar. It never learns the route
// itself, only what the world looked like while it was on it.
export function trial({ worldOpts, setup, seed, flights = 40, releases = 30, alt = 0, policy = 'steer', kc = 0, sparsity = 0, testVariant = 0,
  trainAlts = null, altBanks = false, testAlt = 0, swarm = 1, gazeR = 0.25, cast = false, castThr = 0.1, approach = 0, drop = false, track = false,
  aversive = false, climb = 0, row = null, map = false, arrive = false, weather = 'clear', trainWeather = 'clear', normalize = false, edges = false, burst = 0, smooth = 0, approachDecay = 0.5, calibrate = 0, odoBias = 0, odoNoise = 0, odoScale = 0, wind = 0, tilt = 0, tiltEst = 0, tiltComp = false, tiltTrain = false, yawWalk = 0, yawCompass = 0, flowOdo = false, mapSwarm = false, mapSharp = 12, scales = null }) {
  const world = makeWonderland(worldOpts);
  const over = { eye: { activeVision: 0, normalize: normalize ? 1 : 0, lateralInhib: edges ? 1.5 : 0, ...(burst ? { burst } : {}), ...(smooth ? { smooth: 1 } : {}) }, learn: { anneal: 0 } };
  if (kc) over.mb = { cells: kc, ...(sparsity ? { sparsity } : {}) };
  const cfg = mergeConfig(over, mergeConfig(setupConfig('faces', SETUPS[setup])));
  const brain = new Brain(cfg), theta = brain.initParams(seed);
  brain.setParams(theta); brain.reset(false);
  let F = new RouteFlight(world, cfg);
  F.setWeather(trainWeather); // the weather while it learns
  const r = mulberry32(seed * 7919 + 17);
  const mkAtt = (rng) => ({ sd: (tilt * Math.PI) / 180, est: (tiltEst * Math.PI) / 180, comp: tiltComp, ar: 0.8, roll: 0, pitch: 0, rng });
  const decide = (b, p) => { F.view(p); const o = b.step(F.retinas, F.touch, F.pain, F.pos, F.chroma); return o[1] > o[0] ? 1 : 0; };
  const onRoute = (k) => { // a training start: near the route, roughly along it
    const n = world.route.x.length, i = Math.floor(r() * n * 0.85), th0 = tangent(world, i), off = gauss(r) * 0.2 * world.cell;
    return { x: world.route.x[i] - Math.sin(th0) * off, y: world.route.y[i] + Math.cos(th0) * off, th: wrap(th0 + gauss(r) * 0.45), alt: Math.exp(gauss(r) * alt) };
  };
  const teacherTurn = (q) => Math.max(-TURN, Math.min(TURN, F.teacher(q).err));
  let testPolicy;
  let fam = null;
  if (policy === 'familiar') {
    // familiarity navigation (src/route/familiar.js, the same code the web app runs)
    const alts = trainAlts && trainAlts.length ? trainAlts : [1];
    fam = new FamiliarSwarm(brain, F, { swarm, gazeR, alts, banks: altBanks, castThr, track, aversive, layout: row ? rowOfCircles(row) : null, mapTrack: map, arrive, approachDecay, mapSwarm, mapSharp, scales });
    const trainAtt = () => (tilt && tiltTrain ? mkAtt(r) : null); // (practise the route in rough air, too)
    // each member's "average view": one teacher flight along the route at every training height
    for (const h of alts) fly(world, F, { x: world.start[0], y: world.start[1], th: tangent(world, 0), alt: h }, (q) => { fam.addToAverage(q); return teacherTurn(q); }, { maxSteps: 2000, att: trainAtt() });
    fam.finishAverage();
    // learning the route: a few passes from start to goal at each training height, facing along it
    // (as ants learn a route by walking it), with a little wobble so neighbouring views are learned too
    for (const h of alts) for (let k = 0; k < flights; k++) {
      const th0 = tangent(world, 0), off = gauss(r) * 0.08 * world.cell;
      const p = { x: world.start[0] - Math.sin(th0) * off, y: world.start[1] + Math.cos(th0) * off, th: wrap(th0 + gauss(r) * 0.05), alt: h * Math.exp(gauss(r) * 0.04) };
      fly(world, F, p, (q) => { fam.learn(q, h); return teacherTurn(q) + gauss(r) * 0.03; }, { maxSteps: 3000, att: trainAtt() });
    }
    // learning flights toward the route from all over the map (the approach memory)
    if (approach) for (const h of alts) for (const _ of fam.approachFlights(world, { spacing: approach, h, rng: r })) { /* learning happens inside */ }
    // calibrate: the fly measures how new the best direction looks on and off the route and judges "on the route" between the two (see FamiliarSwarm.calibrate)
    if (calibrate) fam.calibrate(calibrate, r);
    // climb: when unsure, rise toward height `climb`; back to the release height when sure
    testPolicy = () => { let nav = null; return (q) => { nav ||= fam.navigator({ cast, climb: climb ? { cruise: q.alt, top: climb, rate: 0.04 } : null }); const r = nav(q); if (r.climb) q.alt += r.climb; if (r.arrived) q.arrived = true; return r.turn; }; };
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
    testPolicy = () => (q) => (decide(frozen, q) ? TURN : -TURN);
  }
  // ---- test: learning frozen, released near the route with a wrong heading (optionally over a
  // slightly changed version of the maze: same layout and route, different details)
  if (testVariant) { F = new RouteFlight(makeWonderland({ ...worldOpts, variant: testVariant }), cfg); if (fam) fam.F = F; }
  F.setWeather(weather); // the weather while it is tested
  const rt = mulberry32(900001 + seed), out = { reached: 0, progress: 0, dev: 0, tracks: [], teacher: 0, blind: 0, found: 0, near: 0, falseStop: 0 };
  for (let k = 0; k < releases; k++) {
    const p0 = drop ? releaseAnywhere(world, F, rt, alt) : releasePose(world, rt, alt);
    if (testAlt) p0.alt = testAlt;
    const maxSteps = Math.ceil((world.route.length / (world.cell / 8)) * (drop ? 3.5 : 2.5));
    const how = drop ? { maxSteps, lostAt: Infinity, global: true } : { maxSteps };
    const windDir = rt() * 2 * Math.PI; // (always drawn, so runs with and without wind release the fly at the same places)
    const drift = odoBias || odoNoise || odoScale || wind || yawWalk || yawCompass || flowOdo ? { bias: odoBias, noise: odoNoise, scale: odoScale, wind, windDir, rng: rt, walk: yawWalk, compass: yawCompass, flow: flowOdo } : null;
    const att = tilt ? mkAtt(rt) : null;
    const res = fly(world, F, { ...p0 }, testPolicy(), { ...how, drift, att });
    out.found += res.found / releases; out.near += res.near / releases; out.falseStop += res.falseStop / releases;
    out.reached += res.reached / releases; out.progress += res.progress / releases; out.dev += res.dev / releases;
    if (k < 8) out.tracks.push(res.track);
    // references on the same release: the teacher itself, and a blind fly that flies straight
    out.teacher += fly(world, F, { ...p0 }, (q) => Math.max(-TURN, Math.min(TURN, F.teacher(q).err)), how)[drop ? 'reached' : 'progress'] / releases;
    out.blind += fly(world, F, { ...p0 }, () => 0, how)[drop ? 'reached' : 'progress'] / releases;
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
  const common = { flights: +(args.flights || 40), releases: +(args.releases || 30), alt: +(args.alt || 0), policy: args.policy || 'steer', kc: +(args.kc || 0), sparsity: +(args.sparsity || 0), testVariant: +(args['test-variant'] || 0),
    trainAlts: args['train-alts'] ? args['train-alts'].split(',').map(Number) : null, altBanks: !!args.banks, testAlt: +(args['test-alt'] || 0),
    swarm: +(args.swarm || 1), gazeR: +(args.gaze ?? 0.25), cast: !!args.cast, castThr: +(args['cast-thr'] || 0.1), approach: +(args.approach || 0), drop: !!args.drop, track: !!args.track,
    aversive: !!args.aversive, map: !!args.map, arrive: !!args.arrive, weather: args.weather || 'clear', trainWeather: args['train-weather'] || 'clear', normalize: !!args.normalize, edges: !!args.edges, burst: +(args.burst || 0), tilt: +(args.tilt || 0), tiltEst: +(args['tilt-est'] || 0), tiltComp: !!args['tilt-comp'], tiltTrain: !!args['tilt-train'], yawWalk: +(args['yaw-walk'] || 0), yawCompass: +(args['yaw-compass'] || 0), flowOdo: !!args['flow-odo'], mapSwarm: !!args['map-swarm'], scales: args.scales ? args.scales.split(',').map(Number) : null, mapSharp: +(args['map-sharp'] || 12), calibrate: +(args.calibrate || 0), approachDecay: +(args.decay || 0.5), smooth: +(args.smooth || 0), odoBias: +(args['odo-bias'] || 0), odoNoise: +(args['odo-noise'] || 0), odoScale: +(args['odo-scale'] || 0), wind: +(args.wind || 0), climb: +(args.climb || 0), row: args.row ? (([side, mid]) => ({ side, mid }))(args.row.split(',').map(Number)) : null };
  const jobs = [];
  const w0 = +(args.w0 || 1); // the first maze number (to test one particular maze)
  for (const setup of setups) for (let w = w0; w < w0 + worlds; w++) for (let s = 1; s <= seeds; s++) jobs.push({ ...common, setup, seed: s, worldOpts: { ...worldBase, seed: w } });
  const runOne = (job) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [self, '--one', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let o = ''; p.stdout.on('data', (d) => (o += d));
    p.on('close', (code) => (code === 0 ? resolve({ job, out: JSON.parse(o) }) : reject(new Error('trial failed'))));
  });
  const t0 = Date.now(), res = [], jobsMax = +(args.jobs || Math.max(1, os.cpus().length - 1));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobsMax, jobs.length) }, async () => { while (next < jobs.length) { const j = next++; res.push(await runOne(jobs[j])); } }));
  const pct = (x) => (x * 100).toFixed(0) + '%';
  console.log(`route following (${common.policy}${common.kc ? ', ' + common.kc + ' Kenyon cells' : ''}): ${worldBase.cells}x${worldBase.cells} maze, wobble ${worldBase.wobble}, variety ${worldBase.variety}, height jitter ${common.alt}${common.testVariant ? ', tested on variant ' + common.testVariant : ''}${common.trainAlts ? ', trained at heights ' + common.trainAlts.join('/') + (common.altBanks ? ' (a memory per height)' : '') : ''}${common.testAlt ? ', tested at height ' + common.testAlt : ''}${common.swarm > 1 ? ', swarm of ' + common.swarm + ' (gaze circle ' + common.gazeR + ')' : ''}${common.cast ? ', casting' : ''}${common.approach ? ', learning flights every ' + common.approach + ' cells' : ''}${common.drop ? ', DROPPED ANYWHERE' : ''}${common.track ? ', keeping track' : ''}${common.aversive ? ', wrong-way memory' : ''}${common.map ? ', knows where it is on the map' : ''}${common.weather !== 'clear' || common.trainWeather !== 'clear' ? ', weather: trained ' + common.trainWeather + ', tested ' + common.weather : ''}${common.normalize ? ', contrast filter' : ''}${common.edges ? ', edge boost' : ''}${common.climb ? ', climbs to ' + common.climb + ' when unsure' : ''}${common.row ? ', three circles in a row (' + common.row.side + '+' + common.row.mid + '+' + common.row.side + ')' : ''}; ${worlds} worlds x ${seeds} flies per setup, ${common.flights} training flights, ${common.releases} releases each (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log('setup'.padEnd(10) + 'reached goal'.padStart(14) + 'route flown'.padStart(13) + 'off-route'.padStart(12) + (common.drop ? '   (teacher / blind: reached goal) found route' : '   (teacher / blind: route flown)'));
  for (const setup of setups) {
    const rs = res.filter((x) => x.job.setup === setup).map((x) => x.out), m = (k) => rs.reduce((a, o) => a + o[k], 0) / rs.length;
    const per = rs.map((o) => Math.round(o.reached * 100)).join(' ');
    console.log(setup.padEnd(10) + pct(m('reached')).padStart(14) + pct(m('progress')).padStart(13) + (m('dev').toFixed(2) + ' cells').padStart(12) + `   (${pct(m('teacher'))} / ${pct(m('blind'))})` + (common.drop ? `   found route ${pct(m('found'))}, got within 0.8 cells of the goal ${pct(m('near'))}, stopped somewhere else believing it was there ${pct(m('falseStop'))}` : `   got within 0.8 cells of the goal ${pct(m('near'))}, false stops ${pct(m('falseStop'))}`) + `   flies: ${per}`);
  }
  if (args.png) { // a picture of one fly's test flights
    const { out, world } = trial({ ...common, setup: setups[setups.length - 1], seed: 1, worldOpts: { ...worldBase, seed: w0 } });
    const cols = [[255, 200, 0], [0, 220, 255], [255, 80, 200], [120, 255, 120], [255, 140, 40], [180, 120, 255], [255, 255, 255], [80, 160, 255]];
    fs.writeFileSync(args.png, encodePNG(world.W, world.H, mapImage(world, out.tracks.map((pts, i) => ({ pts, col: cols[i % cols.length] })))));
    console.log('picture: ' + args.png);
  }
}
