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
    // Fixational micro-jitter ("the loop trick"): every frame, the image is nudged by a random
    // sub-receptor amount before sampling, as a fraction of receptor spacing (0.5 = up to half a
    // receptor). A still image is on screen for up to ~60 frames, so instead of looking at the
    // exact same aliased pixels every frame, each frame is a slightly different sub-pixel look;
    // the leaky recurrent core and the fast synapses then average this out over time for free,
    // the same idea as summing a model's logits over several jittered, downsampled looks at a
    // photo. 0 = off (every frame is identical while the image is steady).
    jitterFrac: 0,
  },
  // Where the screen sits in the visual field, and how big it looks.
  screen: { azDeg: 70, elDeg: 50, centerAzDeg: 0, centerElDeg: 0 },
  timing: {
    dt: 0.05,            // seconds per control step (20 Hz)
    episodeSec: 12,
    itiSec: 0.3,         // blank screen between trials
    onsetSec: 0.25,      // new image expands into view over this long
    onsetLoom: true,     // the expansion is what LPLC2/LC4 detect
    reactionSec: 0.3,    // a press earlier than this after the image appears counts as premature: look first
    forceAtSec: 0.5,     // no press by now: the foot with the stronger output is pressed for it (forced choice). 0 = free response
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
    repeat: -1.0,        // anti-button-mashing: charged for every answer with the same foot beyond repeatFree in a row
    repeatFree: 2,
  },
  // Nociceptors: one per foot. A wrong answer (or pressing while the screen is blank) hurts that
  // foot; the pain is an *input* to the brain that fades over tauSec. strength 0 = feels nothing.
  pain: { strength: 1.0, onPremature: 0.5, tauSec: 0.6, feel: 0 },
  // Fast learning inside the fly's lifetime (no evolution, no backprop): each answer changes the
  // synapses from the eye's static LC cells onto the two feet. A wrong answer's pain weakens the foot
  // that fired and strengthens the other; a correct answer's reward does the opposite. eta 0 = off.
  learn: { eta: 0.2, anneal: 400, reward: 1.0, gain: 1.0, wmax: 4 }, // anneal: the speed halves after this many answers
  brain: {
    core: 128,           // recurrent neurons
    kIn: 10,             // inputs per core neuron
    kRec: 12,            // recurrent inputs per core neuron
    alpha: 0.5,          // leak: 1 = no memory of previous state
    recGain: 0.9,
    inhibition: 0,       // mutual inhibition between the two foot motor neurons: 1 = winner-take-all, 0 = independent feet
    // The other half of "the loop trick" for the live fly: on its own, eye.jitterFrac just adds
    // noise to a single instantaneous decision. decisionAlpha < 1 smooths the foot logits over
    // time (a running average) before deciding, so jittered frames actually get summed/averaged
    // like the pasted algorithm's logits, instead of each being judged alone. 1 = off (instant).
    decisionAlpha: 1,
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
