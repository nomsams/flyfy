// The whole "environment": a screen in front of fixed eye(s), and two feet.
// No body, no locomotion. A trial is: blank screen (ITI) -> a new image
// expands into view -> the fly answers by pressing then releasing one foot
// (left foot = label 0, right foot = label 1) -> blank again.

import { mulberry32 } from './rng.js';
import { IMG } from './stimuli.js';

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
    // Angular position (degrees) of every receptor column/row.
    this.az = new Float32Array(this.C);
    this.el = new Float32Array(this.R);
    for (let c = 0; c < this.C; c++) this.az[c] = (-0.5 + (c + 0.5) / this.C) * e.fovAzDeg;
    for (let r = 0; r < this.R; r++) this.el[r] = (0.5 - (r + 0.5) / this.R) * e.fovElDeg;
    this.touch = new Float32Array(2);
    this.pressed = [false, false];
    this.image = null;
    this.label = 0;
    this.rng = null;
    this.stim = null;
    this.serial = 0; // bumps whenever a new image is put on screen
  }

  reset(seed, stim) {
    this.rng = mulberry32(seed);
    this.stim = stim;
    this.time = 0;
    this.phase = 'iti';
    this.phaseT = 0;
    this.pressed[0] = this.pressed[1] = false;
    this.touch[0] = this.touch[1] = 0;
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
  }

  _endTrial() {
    this.phase = 'iti';
    this.phaseT = 0;
  }

  // out0/out1: motor outputs of the left/right foot in [-1, 1].
  step(out0, out1) {
    const t = this.cfg.timing, f = this.cfg.feet, rw = this.cfg.reward;
    let reward = rw.timePerSec * t.dt;
    this.lastEvent = EVENT.NONE;
    this.time += t.dt;
    this.phaseT += t.dt;

    // Dense teaching signal: while a cue is up, reward pushing the correct
    // foot above the wrong one. Far lower-variance than the +-10 outcome,
    // which on its own is nearly invisible to ES on anything but trivial tasks.
    if (this.phase === 'stim' && rw.marginPerSec) {
      const oc = this.label === 0 ? out0 : out1, ow = this.label === 0 ? out1 : out0;
      reward += rw.marginPerSec * t.dt * 0.5 * (oc - ow);
    }

    const outs = [out0, out1];
    for (let foot = 0; foot < 2; foot++) {
      if (!this.pressed[foot] && outs[foot] > f.pressThr) {
        this.pressed[foot] = true;
      } else if (this.pressed[foot] && outs[foot] < f.releaseThr) {
        this.pressed[foot] = false;
        if (this.phase === 'stim') {
          this.trials++;
          const ok = foot === this.label;
          reward += rw.respond + (ok ? rw.correct : rw.wrong);
          if (ok) this.correct++;
          this.lastEvent = ok ? EVENT.CORRECT : EVENT.WRONG;
          this._endTrial();
        } else {
          reward += rw.premature;
          this.premature++;
          this.lastEvent = EVENT.PREMATURE;
        }
      }
      this.touch[foot] = this.pressed[foot] ? 1 : 0;
    }

    if (this.phase === 'iti' && this.phaseT >= t.itiSec) {
      this._startTrial();
    } else if (this.phase === 'stim' && this.phaseT >= t.stimTimeoutSec) {
      reward += rw.miss;
      this.misses++;
      this.lastEvent = EVENT.MISS;
      this._endTrial();
    }

    if (this.time >= t.episodeSec) this.done = true;
    this._render();
    return reward;
  }

  _render() {
    const e = this.cfg.eye, sc = this.cfg.screen;
    const s = this.scale();
    const bg = e.background;
    const R = this.R, C = this.C;
    for (let eye = 0; eye < this.nEyes; eye++) {
      const L = this.retinas[eye];
      if (s <= 0) { L.fill(bg); continue; }
      // With two eyes the screen lands off-axis in opposite directions (a little for
      // 'overlap'; a lot for 'split', where each eye sees mostly its own half).
      const half = e.layout === 'split' ? (e.fovAzDeg - e.splitOverlapDeg) / 2 : e.binocularShiftDeg;
      const shift = this.nEyes === 2 ? (eye === 0 ? 1 : -1) * half : 0;
      const cAz = sc.centerAzDeg + shift, cEl = sc.centerElDeg;
      const hw = sc.azDeg * 0.5 * s, he = sc.elDeg * 0.5 * s;
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
  }
}
