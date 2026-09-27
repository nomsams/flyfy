// Plain-language building blocks shared by the app and tools/compare.mjs: the challenges a fly can
// be given, and the abilities it can be born with. Each is a named bundle of config settings, so
// nobody has to know which number in config.js does what.

import { mergeConfig } from './config.js';

export const TASKS = [
  {
    id: 'brightness', name: 'Light or dark', level: 'Easy', icon: 'sun',
    blurb: 'Is the picture dark or bright?', answers: ['dark', 'bright'], cfg: {},
  },
  {
    id: 'gratings', name: 'Stripes', level: 'Medium', icon: 'stripes',
    blurb: 'Do the stripes run up-and-down or side-to-side?', answers: ['up-down', 'side-side'], cfg: {},
  },
  {
    id: 'faint', name: 'Faint stripes', level: 'Hard', icon: 'faint',
    blurb: 'The same stripes, barely visible under heavy noise.', answers: ['up-down', 'side-side'], cfg: {},
  },
  {
    id: 'spot', name: 'Find the spot', level: 'Hard', icon: 'spot',
    blurb: 'A tiny striped patch hides somewhere different every time. Only the patch counts.',
    answers: ['up-down', 'side-side'],
    // more time before a guess is forced, so there is time to look around
    cfg: { timing: { forceAtSec: 1.2 } },
  },
  {
    id: 'faces', name: 'Man or woman', level: 'Very hard', icon: 'face',
    blurb: 'Real photos, shrunk to what a fly eye could see.', answers: ['man', 'woman'], cfg: {},
  },
];

// needsEvolve: the ability only does something once evolution has shaped it -- "Quick learn" alone
// can't teach it. measured: what testing found, in one honest sentence (filled in from results).
export const ABILITIES = [
  {
    id: 'smartEye', name: 'Smart eye', icon: 'eye',
    short: 'Moves its eye to look where it thinks matters.',
    long: 'The brain gets an extra output that pans the eye a little each moment, and it feels where its eye is pointing. Moving costs a few points, so it only looks around when that pays off.',
    on: { eye: { activeVision: 1 } }, off: { eye: { activeVision: 0 } }, needsEvolve: true,
  },
  {
    id: 'fovea', name: 'Sharp centre', icon: 'target',
    short: 'Sees sharply in the middle, blurrier at the edges.',
    long: 'Same number of light sensors, packed tightly at the centre of gaze and spread out at the edges, like a hunting insect. Great when the thing that matters is in the middle; useless when it is spread over the whole picture.',
    on: { eye: { fovea: 1.1 } }, off: { eye: { fovea: 0 } },
  },
  {
    id: 'edges', name: 'Edge boost', icon: 'edges',
    short: 'Makes outlines stand out before the brain sees anything.',
    long: 'Each light sensor dims its neighbours, so flat areas fade and edges pop - real eyes do this. Helps with outlines and stripes; can wash out smooth shading.',
    on: { eye: { lateralInhib: 1.5 } }, off: { eye: { lateralInhib: 0 } },
  },
  {
    id: 'mood', name: 'Mood chemical', icon: 'drop',
    short: 'A dopamine-like signal decides how long to hold a thought.',
    long: 'One neuron watches the whole brain and releases a "mood" chemical. Each neuron has its own sensitivity to it, so when things look confusing the brain can hold on to its memories longer, and when things are clear it can decide fast.',
    on: { brain: { neuromod: 1 } }, off: { brain: { neuromod: 0 } }, needsEvolve: true,
  },
  {
    id: 'memory', name: 'Memory centre', icon: 'layers',
    short: 'A big sparse layer that helps tell similar things apart.',
    long: 'Adds 400 "Kenyon cells" between the eye and the learning synapses, of which only about 1 in 20 fire at once - the mushroom body, where real flies store what they learn. Rewards and pain train its outputs.',
    on: { mb: { enabled: 1 } }, off: { mb: { enabled: 0 } },
  },
  {
    id: 'selfTune', name: 'Self-tuning learning', icon: 'dial',
    short: 'Evolution decides how the fly learns from rewards and pain.',
    long: 'Instead of fixed settings for how fast to learn and how much pain matters, evolution tunes them - and a separate learning speed for each thing the eye can see. The fly learns how to learn.',
    on: { learn: { evolveRule: 1 } }, off: { learn: { evolveRule: 0 } }, needsEvolve: true,
  },
  {
    id: 'zoom', name: 'Step closer or back', icon: 'zoom',
    short: 'Walks toward the picture for detail, or backs off to see all of it.',
    long: 'A third eye-motor output changes how far away the picture is: closer makes it bigger (more detail, but it may not fit in view), further makes it smaller. Flies really do this - approaching things is exactly what their looming cells detect. Each move costs a few points, and the fly feels how far away it is.',
    on: { eye: { activeZoom: 1 } }, off: { eye: { activeZoom: 0 } }, needsEvolve: true,
  },
  {
    id: 'sizeVary', name: 'Practise at many distances', icon: 'sizes',
    short: 'Sees practice pictures from nearer and further, to learn any size.',
    long: 'During training, each picture is shown from a random distance between about 0.7x and 1.4x the usual one, so the fly learns what things look like at different sizes instead of memorising one. The final exam is always at the usual distance.',
    on: { screen: { distanceJitter: 0.35 } }, off: { screen: { distanceJitter: 0 } },
  },
  {
    id: 'rewire', name: 'Rewiring', icon: 'wires',
    short: 'Unused connections get moved somewhere more useful.',
    long: 'Every 10 generations of evolution, the weakest 5% of the brain’s connections are cut and regrown to new random places. Same number of wires, better placed.',
    on: { es: { rewire: 1 } }, off: { es: { rewire: 0 } }, needsEvolve: true,
  },
];

// What a new fly starts with. Memory centre + edge boost: measured clear wins, never worse where tested
// (stripes with Quick learn: 82.9% -> 99.5%; light or dark stays at 100%). Smart eye + mood chemical:
// what this branch is exploring; free until evolved (a new fly's eye holds still).
export const DEFAULT_ABILITIES = { smartEye: true, mood: true, memory: true, edges: true };

// Config overrides for a task + a set of abilities ({ id: true/false }).
export function setupConfig(taskId, abilities) {
  const task = TASKS.find((t) => t.id === taskId) || TASKS[0];
  let cfg = mergeConfig(task.cfg, {});
  for (const a of ABILITIES) cfg = mergeConfig(abilities[a.id] ? a.on : a.off, cfg);
  return cfg;
}

// Which abilities are switched on in a config (the inverse of setupConfig, for saved flies).
export function abilitiesOf(cfg) {
  const out = {};
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  for (const a of ABILITIES) {
    const [grp] = Object.keys(a.on);
    const [key] = Object.keys(a.on[grp]);
    out[a.id] = !!get(cfg, `${grp}.${key}`);
  }
  return out;
}

// Results of running exactly these comparisons (tools/compare.mjs, 5 paired repeats each) while
// building the app. a/b = average exam score without/with the ability; diff = b - a; margin = 95%
// confidence margin of the paired difference; clear = the difference is bigger than that margin.
export const MEASURED = [
  {
    ability: "memory",
    task: "faint",
    method: "quick",
    a: 0.6263,
    b: 0.9156,
    diff: 0.2893,
    margin: 0.0648,
    clear: true,
    summary: "On faint stripes with Quick learn: 62.6% without vs 91.6% with - better by 28.9 points (clear)."
  },
  {
    ability: "memory",
    task: "faces",
    method: "quick",
    a: 0.542,
    b: 0.5532,
    diff: 0.0112,
    margin: 0.061,
    clear: false,
    summary: "On faces with Quick learn: 54.2% without vs 55.3% with - no clear difference (+1.1 ± 6.1 points)."
  },
  {
    ability: "edges",
    task: "faint",
    method: "quick",
    a: 0.6263,
    b: 0.7709,
    diff: 0.1446,
    margin: 0.1143,
    clear: true,
    summary: "On faint stripes with Quick learn: 62.6% without vs 77.1% with - better by 14.5 points (clear)."
  },
  {
    ability: "edges",
    task: "faces",
    method: "quick",
    a: 0.542,
    b: 0.555,
    diff: 0.013,
    margin: 0.0246,
    clear: false,
    summary: "On faces with Quick learn: 54.2% without vs 55.5% with - no clear difference (+1.3 ± 2.5 points)."
  },
  {
    ability: "fovea",
    task: "faces",
    method: "quick",
    a: 0.542,
    b: 0.5395,
    diff: -0.0025,
    margin: 0.0368,
    clear: false,
    summary: "On faces with Quick learn: 54.2% without vs 54.0% with - no clear difference (-0.2 ± 3.7 points)."
  },
  {
    ability: "fovea",
    task: "spot",
    method: "quick",
    a: 0.599,
    b: 0.7203,
    diff: 0.1213,
    margin: 0.0196,
    clear: true,
    summary: "On find the spot with Quick learn: 59.9% without vs 72.0% with - better by 12.1 points (clear)."
  },
  {
    ability: "smartEye",
    task: "gratings",
    method: "quick",
    a: 0.8291,
    b: 0.8291,
    diff: 0,
    margin: 0,
    clear: false,
    summary: "On stripes with Quick learn: 82.9% both ways - identical, because a new fly's eye now holds still until evolution teaches it to move (before that fix, the untrained, wandering eye cost 12.3 points)."
  },
  {
    ability: "smartEye",
    task: "spot",
    method: "thorough",
    a: 0.5752,
    b: 0.5418,
    diff: -0.0334,
    margin: 0.0887,
    clear: false,
    summary: "On find the spot with Evolve (60 generations): 57.5% without vs 54.2% with - no clear difference (-3.3 ± 8.9 points)."
  },
  {
    ability: "smartEye",
    task: "spot",
    method: "thorough",
    with: "Sharp centre",
    a: 0.5954,
    b: 0.6534,
    diff: 0.058,
    margin: 0.1104,
    clear: false,
    summary: "On find the spot with Evolve (60 generations) (and Sharp centre on): 59.5% without vs 65.3% with - no clear difference (+5.8 ± 11.0 points)."
  },
  {
    ability: "mood",
    task: "gratings",
    method: "thorough",
    a: 0.7553,
    b: 0.7686,
    diff: 0.0134,
    margin: 0.0602,
    clear: false,
    summary: "On stripes with Evolve (30 generations): 75.5% without vs 76.9% with - no clear difference (+1.3 ± 6.0 points)."
  },
  {
    ability: "selfTune",
    task: "faint",
    method: "thorough",
    a: 0.5538,
    b: 0.5412,
    diff: -0.0126,
    margin: 0.0715,
    clear: false,
    summary: "On faint stripes with Evolve (30 generations): 55.4% without vs 54.1% with - no clear difference (-1.3 ± 7.1 points)."
  },
  {
    ability: "rewire",
    task: "gratings",
    method: "thorough",
    a: 0.7553,
    b: 0.7511,
    diff: -0.0041,
    margin: 0.0188,
    clear: false,
    summary: "On stripes with Evolve (30 generations): 75.5% without vs 75.1% with - no clear difference (-0.4 ± 1.9 points)."
  }
];
