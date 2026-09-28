// Fly Lab · Maze: the simulation, off the page's main thread. It builds the Wonderland, teaches the
// route (familiarity), and flies the fly or swarm, streaming every step back to the page.
import { mergeConfig } from '../src/config.js';
import { setupConfig } from '../src/abilities.js';
import { Brain } from '../src/brain.js';
import { makeWonderland } from '../src/route/terrain.js';
import { RouteFlight } from '../src/route/flight.js';
import { FamiliarSwarm } from '../src/route/familiar.js';

let mazeOpts = null, flyOpts = null, world = null, cfg = null, brain = null, F = null, Fshow = null, swarm = null;
let run = 0; // bumps to cancel whatever loop is running
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let gaussSeed = 12345;
const rnd = () => { gaussSeed = (Math.imul(gaussSeed, 1664525) + 1013904223) >>> 0; return gaussSeed / 4294967296; };
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.SQRT1_2; };
const tangent = (i) => { const { x, y } = world.route, j = Math.min(x.length - 1, i + 4), k = Math.max(0, i - 4); return Math.atan2(y[j] - y[k], x[j] - x[k]); };

function mapMessage(w, keepRoute = false) {
  const N = w.W * w.H, rgba = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) { rgba[4 * i] = 255 * w.rgb[i]; rgba[4 * i + 1] = 255 * w.rgb[N + i]; rgba[4 * i + 2] = 255 * w.rgb[2 * N + i]; rgba[4 * i + 3] = 255; }
  const step = 3, route = [];
  for (let i = 0; i < w.route.x.length; i += step) route.push([w.route.x[i], w.route.y[i]]);
  return { msg: { type: 'map', W: w.W, H: w.H, rgba, route, start: w.start, goal: w.goal, cell: w.cell, length: w.route.length, keepRoute }, transfer: [rgba.buffer] };
}

// one flight step for the teacher: turn toward a point a little further along the route
const teacherTurn = (Fl, q, max) => Math.max(-max, Math.min(max, Fl.teacher(q).err));

const H = {
  build(m) {
    run++;
    mazeOpts = m.maze; flyOpts = m.fly;
    world = makeWonderland({ ...mazeOpts, variant: 0 });
    H._makeFly();
    const { msg, transfer } = mapMessage(world);
    postMessage(msg, transfer);
  },

  // a new fly over the same maze (colour, memory size); the route has to be taught again
  setFly(m) { run++; flyOpts = m.fly; if (world) H._makeFly(); },
  _makeFly() {
    cfg = mergeConfig({ eye: { activeVision: 0 }, mb: { cells: flyOpts.kc, sparsity: flyOpts.kc >= 10000 ? 0.01 : 0.02 } },
      mergeConfig(setupConfig('faces', { memory: true, colour: !!flyOpts.colour })));
    brain = new Brain(cfg); brain.setParams(brain.initParams(1)); brain.reset(false);
    F = new RouteFlight(world, cfg); Fshow = F; swarm = null;
  },

  async train(m) {
    const me = ++run, alts = m.alts.length ? m.alts : [1], speed = world.cell / 8, maxTurn = (10 * Math.PI) / 180;
    Fshow = F;
    swarm = new FamiliarSwarm(brain, F, { swarm: flyOpts.swarm, gazeR: flyOpts.gaze, alts, banks: !!m.banks });
    const passes = [];
    for (const h of alts) passes.push({ h, avg: true });
    for (const h of alts) for (let k = 0; k < m.passes; k++) passes.push({ h, avg: false });
    let done = 0;
    for (const pass of passes) {
      const th0 = tangent(0), off = pass.avg ? 0 : gauss() * 0.08 * world.cell;
      const q = { x: world.start[0] - Math.sin(th0) * off, y: world.start[1] + Math.cos(th0) * off, th: pass.avg ? th0 : wrap(th0 + gauss() * 0.05), alt: pass.h };
      F.hint = F.nearest(q, true).i;
      for (let t = 0; t < 3000; t++) {
        if (me !== run) return;
        if (pass.avg) swarm.addToAverage(q); else swarm.learn(q, pass.h);
        q.th = wrap(q.th + teacherTurn(F, q, maxTurn) + (pass.avg ? 0 : gauss() * 0.03));
        q.x += speed * Math.cos(q.th); q.y += speed * Math.sin(q.th);
        const nr = F.nearest(q);
        if (t % 3 === 0) { postMessage({ type: 'train', pose: { ...q }, stage: pass.avg ? 'Looking around the route' : 'Learning the route', pass: done + 1, passes: passes.length, alt: pass.h, share: swarm.familiarShare(), members: swarm.members.map((mm) => [mm.gx, mm.gy]) }); await tick(); }
        if (nr.s >= world.route.length - 0.3 * world.cell) break;
      }
      done++;
      if (pass.avg && passes[done] && !passes[done].avg) swarm.finishAverage();
    }
    postMessage({ type: 'trained', share: swarm.familiarShare(), members: swarm.members.map((mm) => [mm.gx, mm.gy]) });
  },

  variant(m) {
    run++;
    const w = m.v ? makeWonderland({ ...mazeOpts, variant: m.v }) : world;
    Fshow = m.v ? new RouteFlight(w, cfg) : F;
    if (swarm) swarm.F = Fshow;
    const { msg, transfer } = mapMessage(w, true);
    postMessage(msg, transfer);
  },

  async release(m) {
    if (!swarm) return;
    const me = ++run, speed = world.cell / 8, nav = swarm.navigator({ cast: !!m.cast });
    const q = { x: m.x, y: m.y, th: m.th, alt: m.alt };
    Fshow.hint = Fshow.nearest(q, true).i;
    let s0 = Fshow.nearest(q).s, maxS = s0, steps = 0, offFor = 0;
    H._q = q; H._delay = m.delay ?? 30;
    while (me === run) {
      const r = nav(q);
      q.th = wrap(q.th + r.turn);
      q.x += speed * Math.cos(q.th); q.y += speed * Math.sin(q.th);
      steps++;
      const nr = Fshow.nearest(q, false);
      maxS = Math.max(maxS, nr.s);
      offFor = nr.d > 1.2 * world.cell ? offFor + 1 : 0;
      let status = r.casting ? 'casting' : 'following';
      if (nr.s >= world.route.length - 0.3 * world.cell && nr.d < 0.6 * world.cell) status = 'reached';
      else if (offFor > 60 || q.x < -world.cell || q.y < -world.cell || q.x > world.W + world.cell || q.y > world.H + world.cell) status = 'lost';
      else if (steps > 4000) status = 'tired';
      Fshow.view(q); // the centre view, for the page
      postMessage({ type: 'fly', pose: { ...q }, ratings: Array.from(r.ratings), choice: r.choice, casting: r.casting, status, steps,
        progress: Math.max(0, Math.min(1, (maxS - s0) / Math.max(1, world.route.length - s0))), off: nr.d / world.cell,
        view: { L: Array.from(Fshow.retinas[0]), Q: Array.from(Fshow.chroma[0]) }, kActive: brain.kActive * swarm.size });
      if (status === 'reached' || status === 'lost' || status === 'tired') break;
      await sleep(H._delay);
    }
  },

  setAlt(m) { if (H._q) H._q.alt = m.alt; },
  setDelay(m) { H._delay = m.delay; },
  stop() { run++; },
};

onmessage = (e) => { try { H[e.data.type](e.data); } catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); } };
