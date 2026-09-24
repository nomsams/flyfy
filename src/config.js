// All tunables in one place. Everything here is plain JSON so it can be
// posted to Web Workers and saved inside checkpoints.

export const DEFAULTS = {
  // The eye(s) are fixed -- there is no body. Each eye is a small retina of
  // photoreceptors (~5 degrees apart, roughly a real ommatidium spacing).
  eye: {
    eyes: 1,             // 1 = right eye only, 2 = both (each gets its own LC layer)
    rows: 14,
    cols: 20,
    fovAzDeg: 100,
    fovElDeg: 70,
    layout: 'overlap',   // 2 eyes: 'overlap' = both see the whole screen (small disparity); 'split' = each eye sees its own side
    binocularShiftDeg: 8, // 'overlap': the screen sits this far off-axis in each eye
    splitOverlapDeg: 40,  // 'split': how far the two visual fields overlap in the middle
    background: 0.08,
    lcLoom: [2, 3],      // LPLC2 / LC4 cells (rows, cols) tiling the retina
    lcStatic: [5, 6],    // LC11 / LC_ON / LUM cells; finer = more image detail, more neurons
  },
  // Where the screen sits in the visual field, and how big it looks.
  screen: { azDeg: 70, elDeg: 50, centerAzDeg: 0, centerElDeg: 0 },
  timing: {
    dt: 0.05,            // seconds per control step (20 Hz)
    episodeSec: 12,
    itiSec: 0.3,         // blank screen between trials
    onsetSec: 0.25,      // new image expands into view over this long
    onsetLoom: true,     // the expansion is what LPLC2/LC4 detect
    stimTimeoutSec: 3.0, // no response by then = a miss
  },
  // A foot "presses" when its motor output rises above pressThr and a
  // response is scored when it falls back below releaseThr.
  feet: { pressThr: 0.3, releaseThr: 0.0 },
  // left foot answers label 0 ("man"), right foot answers label 1 ("woman")
  reward: {
    correct: 10,
    wrong: -10,
    respond: 1.0,        // any response to a visible cue -- gives ES something to find
    premature: -2.0,     // response while the screen is blank
    miss: -3.0,          // cue timed out with no response
    timePerSec: -0.1,
    marginPerSec: 3.0,   // dense reward: correct foot output minus wrong foot output, per second of cue
  },
  brain: {
    core: 128,           // recurrent neurons
    kIn: 10,             // inputs per core neuron
    kRec: 12,            // recurrent inputs per core neuron
    alpha: 0.5,          // leak: 1 = no memory of previous state
    recGain: 0.9,
    netSeed: 12345,      // fixes the (random) wiring, not the weights
  },
  es: { pairs: 32, sigma: 0.08, lr: 0.03, weightDecay: 0.005, episodesPerCandidate: 4 },
};

export function mergeConfig(user, base = DEFAULTS) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!user) return out;
  for (const k of Object.keys(user)) {
    const bv = base[k], uv = user[k];
    out[k] = bv && typeof bv === 'object' && !Array.isArray(bv) && uv && typeof uv === 'object'
      ? mergeConfig(uv, bv) : uv;
  }
  return out;
}
