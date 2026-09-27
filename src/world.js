// The whole "environment": a screen in front of fixed eye(s), and two feet.
// No body, no locomotion. A trial is: blank screen (ITI) -> a new image
// expands into view -> the fly answers by pressing one foot
// (left foot = label 0, right foot = label 1) -> blank again.

import { mulberry32 } from './rng.js';
import { IMG } from './stimuli.js';
import { Mipmap, PAD } from './optics.js';

export const EVENT = { NONE: 0, CORRECT: 1, WRONG: 2, PREMATURE: 3, MISS: 4 };

function sample(img, u, v) {
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  v = v < 0 ? 0 : v > 1 ? 1 : v;
  const x = u * (IMG - 1), y = v * (IMG - 1);
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < IMG ? x0 + 1 : x0, y1 = y0 + 1 < IMG ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = img[y0 * IMG + x0], b = img[y0 * IMG + x1];
  const c = img[y1 * IMG + x0], d = img[y1 * IMG + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export class TrialWorld {
  constructor(cfg) {
    this.cfg = cfg;
    const e = cfg.eye;
    this.nEyes = e.eyes;
    this.R = e.rows;
    this.C = e.cols;
    this.retinas = [];
    for (let i = 0; i < this.nEyes; i++) this.retinas.push(new Float32Array(this.R * this.C));
    // Angular position (degrees) of every receptor column/row. Uniform spacing by default; with
    // eye.fovea > 0, a tangent warp packs receptors densest at the centre of gaze (t=0) and
    // sparsest at the field's edges (t=+-1), same receptor count either way.
    const k = e.fovea || 0;
    const warp = (t) => (k ? Math.tan(t * k) / Math.tan(k) : t);
    this.az = new Float32Array(this.C);
    this.el = new Float32Array(this.R);
    for (let c = 0; c < this.C; c++) this.az[c] = 0.5 * warp(-1 + (2 * (c + 0.5)) / this.C) * e.fovAzDeg;
    for (let r = 0; r < this.R; r++) this.el[r] = -0.5 * warp(-1 + (2 * (r + 0.5)) / this.R) * e.fovElDeg;
    // Local gap to the neighbouring receptors (degrees): each receptor's lens gathers light over a
    // cone about this wide (see eye.acceptance). Denser near the centre when foveated.
    const gaps = (a) => Float32Array.from(a, (_, i) => Math.abs(i === 0 ? a[1] - a[0] : i === a.length - 1 ? a[i] - a[i - 1] : (a[i + 1] - a[i - 1]) / 2));
    this.gapAz = gaps(this.az); this.gapEl = gaps(this.el);
    this.mip = new Mipmap(); this.mipImg = null; this.mipDirty = true;
    this.dist = cfg.screen.distance || 1; this.dist0 = this.dist; // viewing distance (1 = normal)
    this.touch = new Float32Array(2);
    this.pain = new Float32Array(2);   // nociceptors, one per foot
    this.resp = [0, 0];                // answers given with each foot
    this.parts = {};                   // reward ledger for this episode, by component
    this.pressed = [false, false];
    this.image = null;
    this.label = 0;
    this.rng = null;
    this.stim = null;
    this.serial = 0; // bumps whenever a new image is put on screen
    this.jitterStep = 0;
    this.gazeAz = 0; this.gazeEl = 0; // active vision: where the eye is currently panned to
    this.pos = new Float32Array(3);   // where the eye points (x, y) and how far away it is, as the brain feels it, each in [-1, 1]
    this.trail = new Float32Array(2 * 48); this.trailN = 0; // recent gaze positions, for drawing
  }

  reset(seed, stim) {
    this.rng = mulberry32(seed);
    this.stim = stim;
    this.time = 0;
    this.phase = 'iti';
    this.phaseT = 0;
    this.pressed[0] = this.pressed[1] = false;
    this.touch[0] = this.touch[1] = 0;
    this.pain[0] = this.pain[1] = 0;
    this.resp[0] = this.resp[1] = 0;
    this.lastFoot = -1; this.streak = 0;
    this.parts = { correct: 0, wrong: 0, respond: 0, premature: 0, miss: 0, time: 0, margin: 0, repeat: 0, move: 0 };
    this.trials = 0;
    this.correct = 0;
    this.premature = 0;
    this.misses = 0;
    this.lastEvent = EVENT.NONE;
    this.done = false;
    this.label = 0;
    this.image = null;
    this._render();
  }

  // Loom scale of the screen: 0 = blank, else fraction of full apparent size.
  scale() {
    if (this.phase !== 'stim') return 0;
    const t = this.cfg.timing;
    if (!t.onsetLoom || this.phaseT >= t.onsetSec) return 1;
    const x = this.phaseT / t.onsetSec;
    return 0.2 + 0.8 * x * x * (3 - 2 * x);
  }

  _startTrial() {
    this.phase = 'stim';
    this.phaseT = 0;
    this.label = this.rng() < 0.5 ? 0 : 1;
    this.image = this.stim.sample(this.rng, this.label);
    this.serial++;
    this.jitterStep = 0; // each image gets the jitter scan from the same starting phase
    this.gazeAz = 0; this.gazeEl = 0; // each image starts with the eye looking at the centre
    this.trailN = 0;
    this.mipDirty = true;
    // Viewing distance for this picture: the set distance, or (practising at many distances) a
    // random distance around it, so the fly learns what things look like at different sizes.
    const sc = this.cfg.screen, j = sc.distanceJitter || 0;
    this.dist0 = (sc.distance || 1) * (j ? Math.exp((this.rng() * 2 - 1) * j) : 1);
    this.dist = this.dist0;
    this._feel();
  }

  // Efference copy: where the eye points and how far away it is, each scaled to [-1, 1].
  _feel() {
    const e = this.cfg.eye;
    const eyeMoves = e.activeVision || e.reflex, legsMove = e.activeZoom || e.reflex;
    this.pos[0] = eyeMoves ? this.gazeAz / e.gazeRangeDeg : 0;
    this.pos[1] = eyeMoves ? this.gazeEl / e.gazeRangeDeg : 0;
    this.pos[2] = legsMove ? Math.max(-1, Math.min(1, Math.log(this.dist) / Math.log(e.zoomMax))) : 0;
  }

  _endTrial() {
    this.phase = 'iti';
    this.phaseT = 0;
  }

  // out0/out1: motor outputs of the left/right foot in [-1, 1]. gazeDx/gazeDy: active vision's
  // motor command for this step; zoom: step closer (-) or back (+). All [-1, 1], 0 if unused.
  step(out0, out1, gazeDx = 0, gazeDy = 0, zoom = 0) {
    const t = this.cfg.timing, f = this.cfg.feet, rw = this.cfg.reward, pn = this.cfg.pain, e = this.cfg.eye, P = this.parts;
    const decay = Math.exp(-t.dt / pn.tauSec);
    this.pain[0] *= decay; this.pain[1] *= decay;
    let reward = rw.timePerSec * t.dt;
    P.time += reward;
    this.lastEvent = EVENT.NONE;
    this.time += t.dt;
    this.phaseT += t.dt;

    // Active vision: pan the gaze by the requested amount (clamped so the eye can't fly off the
    // image), then charge a small cost for how far it moved -- so a fly that already knows the
    // answer has no reason to keep scanning.
    if (e.activeVision || e.reflex) { // (the innate reflex can move the eye even without the learned smart eye)
      this.gazeAz = Math.max(-e.gazeRangeDeg, Math.min(e.gazeRangeDeg, this.gazeAz + gazeDx * e.gazeStepDeg));
      this.gazeEl = Math.max(-e.gazeRangeDeg, Math.min(e.gazeRangeDeg, this.gazeEl + gazeDy * e.gazeStepDeg));
      const m = rw.movePerSec * t.dt * (Math.abs(gazeDx) + Math.abs(gazeDy));
      reward += m; P.move += m;
      if (this.phase === 'stim') {
        const cap = this.trail.length / 2, k = this.trailN % cap;
        this.trail[2 * k] = this.gazeAz; this.trail[2 * k + 1] = this.gazeEl; this.trailN++;
      }
    }
    // Stepping closer or back: the picture grows or shrinks by up to zoomStep per moment (in log
    // terms, so closer and back feel symmetric), within [zoomMin, zoomMax]; moving costs like gaze.
    if ((e.activeZoom || e.reflex) && this.phase === 'stim') {
      this.dist = Math.max(e.zoomMin, Math.min(e.zoomMax, this.dist * Math.exp(zoom * e.zoomStep)));
      const m = rw.movePerSec * t.dt * Math.abs(zoom);
      reward += m; P.move += m;
    }
    this._feel();

    // Dense teaching signal: while a cue is up, reward pushing the correct
    // foot above the wrong one. Far lower-variance than the +-10 outcome,
    // which on its own is nearly invisible to ES on anything but trivial tasks.
    if (this.phase === 'stim' && rw.marginPerSec) {
      const oc = this.label === 0 ? out0 : out1, ow = this.label === 0 ? out1 : out0;
      const m = rw.marginPerSec * t.dt * 0.5 * (oc - ow);
      reward += m; P.margin += m;
    }

    // A press IS the answer: the foot whose output crosses the threshold first (the stronger one
    // if both cross in the same step) answers. Releasing just re-arms the foot.
    const outs = [out0, out1];
    const order = out1 > out0 ? [1, 0] : [0, 1];
    for (const foot of order) {
      if (!this.pressed[foot] && outs[foot] > f.pressThr) {
        this.pressed[foot] = true;
        reward += this._answer(foot);
      } else if (this.pressed[foot] && outs[foot] < f.releaseThr) {
        this.pressed[foot] = false;
      }
    }
    // Forced choice: out of time to make up its mind, the stronger foot is pressed for the fly.
    if (this.phase === 'stim' && t.forceAtSec && this.phaseT >= t.forceAtSec) {
      const foot = out1 > out0 ? 1 : 0;
      this.pressed[foot] = true;
      reward += this._answer(foot);
    }
    this.touch[0] = this.pressed[0] ? 1 : 0;
    this.touch[1] = this.pressed[1] ? 1 : 0;

    if (this.phase === 'iti' && this.phaseT >= t.itiSec) {
      this._startTrial();
    } else if (this.phase === 'stim' && this.phaseT >= t.stimTimeoutSec) {
      reward += rw.miss; P.miss += rw.miss;
      this.misses++;
      this.lastEvent = EVENT.MISS;
      this._endTrial();
    }

    if (this.time >= t.episodeSec) this.done = true;
    this._render();
    return reward;
  }

  // A foot has been pressed. Returns the reward it earns. During a cue (and past the reaction
  // time) it is an answer; otherwise it is premature.
  _answer(foot) {
    const t = this.cfg.timing, rw = this.cfg.reward, pn = this.cfg.pain, P = this.parts;
    let reward = 0;
    this.lastPress = foot;
    if (this.phase === 'stim' && this.phaseT >= t.reactionSec) {
      this.trials++;
      this.resp[foot]++;
      const ok = foot === this.label;
      reward += rw.respond; P.respond += rw.respond;
      if (ok) { reward += rw.correct; P.correct += rw.correct; this.correct++; }
      else { reward += rw.wrong; P.wrong += rw.wrong; this.pain[foot] = pn.strength; }
      this.streak = foot === this.lastFoot ? this.streak + 1 : 1;
      this.lastFoot = foot;
      if (this.streak > rw.repeatFree) { reward += rw.repeat; P.repeat += rw.repeat; }
      this.lastEvent = ok ? EVENT.CORRECT : EVENT.WRONG;
      this._endTrial();
    } else {
      reward += rw.premature; P.premature += rw.premature;
      this.pain[foot] = Math.max(this.pain[foot], pn.strength * pn.onPremature);
      this.premature++;
      this.lastEvent = EVENT.PREMATURE;
    }
    return reward;
  }

  // extraAz/extraEl: an explicit sub-receptor offset (degrees), on top of any automatic jitter.
  // Used by the front-end probe to control jittered looks precisely; the live simulation leaves
  // these at 0 and relies on eye.jitterFrac instead.
  _render(extraAz = 0, extraEl = 0) {
    const e = this.cfg.eye, sc = this.cfg.screen;
    const s = this.scale();
    const bg = e.background;
    const R = this.R, C = this.C;
    // Automatic fixational jitter (see eye.jitterFrac in config.js): a deterministic scan around
    // a small circle, one step per frame, rather than a random offset. Random jitter can land on
    // the same side twice in a row and never visit the other side within the few frames a
    // decision actually has to be made in; stepping evenly around a circle guarantees every look
    // covers new ground, in the fewest possible frames, every time.
    const JITTER_POINTS = 6;
    let jAz = 0, jEl = 0;
    if (s > 0 && e.jitterFrac) {
      const ang = (this.jitterStep % JITTER_POINTS) / JITTER_POINTS * 2 * Math.PI;
      const r = 0.5 * e.jitterFrac;
      jAz = Math.cos(ang) * r * (e.fovAzDeg / C);
      jEl = Math.sin(ang) * r * (e.fovElDeg / R);
      this.jitterStep++;
    }
    for (let eye = 0; eye < this.nEyes; eye++) {
      const L = this.retinas[eye];
      if (s <= 0) { L.fill(bg); continue; }
      // With two eyes the screen lands off-axis in opposite directions (a little for
      // 'overlap'; a lot for 'split', where each eye sees mostly its own half).
      const half = e.layout === 'split' ? (e.fovAzDeg - e.splitOverlapDeg) / 2 : e.binocularShiftDeg;
      const shift = this.nEyes === 2 ? (eye === 0 ? 1 : -1) * half : 0;
      const cAz = sc.centerAzDeg + shift + jAz + this.gazeAz + extraAz, cEl = sc.centerElDeg + jEl + this.gazeEl + extraEl;
      // apparent size of the picture (degrees): shrinks with distance, grows during the onset loom
      const aw = (sc.azDeg * s) / this.dist, ah = (sc.elDeg * s) / this.dist;
      const hw = aw / 2, he = ah / 2;
      if (e.acceptance > 0) {
        // Real optics: each receptor averages the picture over its own acceptance cone.
        if (this.image !== this.mipImg || this.mipDirty || this.mip.bg !== bg) { this.mip.build(this.image, bg); this.mipImg = this.image; this.mipDirty = false; }
        const pxPerDeg = Math.sqrt(((IMG - 1) / aw) * ((IMG - 1) / ah));
        const k = (e.acceptance / 2.355) * pxPerDeg; // cone width (FWHM) -> Gaussian sigma, in pixels
        for (let r = 0; r < R; r++) {
          const y0 = PAD + (0.5 - (this.el[r] - cEl) / ah) * (IMG - 1);
          for (let c = 0; c < C; c++) {
            const x0 = PAD + (0.5 + (this.az[c] - cAz) / aw) * (IMG - 1);
            L[r * C + c] = this.mip.sample(x0, y0, k * Math.sqrt(this.gapAz[c] * this.gapEl[r]));
          }
        }
      } else {
        // Pinhole: each receptor reads one exact point (aliases on fine detail).
        for (let r = 0; r < R; r++) {
          const dy = this.el[r] - cEl;
          const inRow = dy >= -he && dy <= he;
          for (let c = 0; c < C; c++) {
            const dx = this.az[c] - cAz;
            L[r * C + c] = inRow && dx >= -hw && dx <= hw
              ? sample(this.image, (dx + hw) / (2 * hw), 1 - (dy + he) / (2 * he))
              : bg;
          }
        }
      }
      // Lateral inhibition (see eye.lateralInhib): each receptor minus its immediate neighbours'
      // average, amplified. A fixed, untrained edge/contrast enhancement at native receptor
      // resolution -- LC11/LC_ON do this too, but only over whole tiles of several receptors;
      // this happens one receptor at a time, before anything else sees the image.
      if (e.lateralInhib) {
        const raw = Float32Array.from(L);
        for (let r = 0; r < R; r++) {
          for (let c = 0; c < C; c++) {
            const i = r * C + c;
            let n = 0, sum = 0;
            if (r > 0) { sum += raw[i - C]; n++; }
            if (r < R - 1) { sum += raw[i + C]; n++; }
            if (c > 0) { sum += raw[i - 1]; n++; }
            if (c < C - 1) { sum += raw[i + 1]; n++; }
            const avg = n ? sum / n : raw[i];
            L[i] = Math.max(0, Math.min(1, raw[i] + e.lateralInhib * (raw[i] - avg)));
          }
        }
      }
    }
  }
}
