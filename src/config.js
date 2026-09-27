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
    // Lens blur: each receptor averages light over a cone this many receptor-gaps wide (full width
    // at half maximum), like a real ommatidium (flies: about 1). Smooths away false moire patterns,
    // especially from far away -- but measured, it made learning *worse* (faint stripes -5.6, find
    // the spot -10.6 points at 1.0; still worse at 0.5): a trainable brain can use the pinhole's
    // sharp, even aliased, detail. So the default is the pinhole (0); the lens is there for realism.
    acceptance: 0,
    lcLoom: [2, 3],      // LPLC2 / LC4 cells (rows, cols) tiling the retina
    lcStatic: [5, 6],    // LC11 / LC_ON / LUM cells; finer = more image detail, more neurons
    // Foveation: receptors are packed denser near the centre of gaze and sparser toward the
    // edges (a tangent warp), like a real predatory insect's fovea, instead of being spread
    // evenly across the field. Same receptor count either way -- just spent where the screen
    // actually is (it sits centred in the field by default). 0 = uniform spacing (off); up to
    // ~1.4 = strongly foveated. See TrialWorld's az/el construction.
    fovea: 0,
    // Lateral inhibition: each receptor's signal minus its immediate neighbours' average,
    // amplified by this factor -- literally what real photoreceptors do to each other before the
    // signal goes anywhere else, sharpening edges and flattening large uniform patches for free,
    // before any neuron (fixed or trained) does a single calculation. 0 = off.
    lateralInhib: 0,
    // Fixational micro-jitter ("the loop trick"): every frame, the image is nudged by a random
    // sub-receptor amount before sampling, as a fraction of receptor spacing (0.5 = up to half a
    // receptor). A still image is on screen for up to ~60 frames, so instead of looking at the
    // exact same aliased pixels every frame, each frame is a slightly different sub-pixel look;
    // the leaky recurrent core and the fast synapses then average this out over time for free,
    // the same idea as summing a model's logits over several jittered, downsampled looks at a
    // photo. 0 = off (every frame is identical while the image is steady).
    jitterFrac: 0,
    // Active vision: instead of a fixed scan pattern, the brain's own core decides where to look
    // next every frame (see brain.js's gaze output) and the eye actually pans there, rather than
    // the image being resampled from a fixed spot. This is the new default way the eye gets more
    // than one look at a still image -- jitterFrac is the old, fixed alternative, still available.
    activeVision: 1,   // 1 = on, 0 = off (a plain number so it works like every other live setting)
    gazeStepDeg: 2.0,  // degrees the gaze can move in one frame at full motor output (tanh = +-1)
    gazeRangeDeg: 20,  // how far the gaze may wander from the centre of the screen before clamping
    // Stepping closer or back: a third motor output changes the viewing distance, within this range.
    activeZoom: 0,
    // Innate reflex: turn toward and step up to whatever small thing stands out (see brain.js
    // _reflex). The strength of the pull (0 = off). Moves the eye and legs even if the learned
    // Smart eye / Step closer abilities are off.
    reflex: 0,
    zoomStep: 0.06,    // the picture's size can change by up to ~6% per moment
    zoomMin: 0.6, zoomMax: 2.5,
  },
  // Where the screen sits in the visual field, and how big it looks.
  // distance: how far away the screen is (1 = normal, 2 = twice as far, so half the size).
  // distanceJitter: practise at many distances -- each picture is shown between e^-j and e^+j times
  // the set distance (the final exam always uses the set distance).
  screen: { azDeg: 70, elDeg: 50, centerAzDeg: 0, centerElDeg: 0, distance: 1, distanceJitter: 0 },
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
    // Active vision: a small cost on the raw motor command's size (0..1 per axis, before it is
    // turned into degrees), per second, so a fly that already has its answer has no reason to
    // keep scanning -- reward finding the target with the fewest, most efficient eye movements.
    movePerSec: -0.4,
  },
  // Nociceptors: one per foot. A wrong answer (or pressing while the screen is blank) hurts that
  // foot; the pain is an *input* to the brain that fades over tauSec. strength 0 = feels nothing.
  pain: { strength: 1.0, onPremature: 0.5, tauSec: 0.6, feel: 0 },
  // Fast learning inside the fly's lifetime (no evolution, no backprop): each answer changes the
  // synapses from the eye's static LC cells onto the two feet. A wrong answer's pain weakens the foot
  // that fired and strengthens the other; a correct answer's reward does the opposite. eta 0 = off.
  // evolveRule: let evolution tune this rule itself (speed, reward/pain weights, forgetting, and a
  // speed per feature) instead of the hand-set numbers here -- evolution learns how to learn.
  // surprise: 1 = learn in proportion to how unexpected each outcome was (dopamine as reward prediction
  // error), instead of the same amount every time.
  learn: { eta: 0.2, anneal: 400, reward: 1.0, gain: 1.0, wmax: 4, evolveRule: 0, surprise: 0 }, // anneal: the speed halves after this many answers
  // Mushroom body: a big sparse layer of Kenyon cells between the eye and the pain-learning
  // synapses (see brain.js). cells = how many, fanIn = inputs each, sparsity = fraction that fire.
  // retina: 1 = each Kenyon cell samples a few raw light sensors directly, instead of the coarse eye-cell
  // tiles -- more detail reaches memory (a linear reader gets ~65% on faces from raw sensors vs ~57% from tiles).
  mb: { enabled: 0, cells: 400, fanIn: 6, sparsity: 0.05, retina: 1 },
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
    neuromod: 1,         // 1 = dopamine adjusts every neuron's leak live; 0 = leak stays at its evolved baseline
    netSeed: 12345,      // fixes the (random) wiring, not the weights
  },
  // rewire: every rewireEvery generations, the weakest rewireFrac of the core's wires are moved to
  // new random sources ("use it or lose it"), so evolution shapes the wiring, not just the weights.
  es: { pairs: 32, sigma: 0.08, lr: 0.03, weightDecay: 0.005, episodesPerCandidate: 4, rewire: 0, rewireEvery: 10, rewireFrac: 0.05 },
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
