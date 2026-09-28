# Fly Lab

Teach a tiny simulated fly brain to tell pictures apart - right in your browser. No install, no
account, no server needed.

**Try it:** https://nomsams.github.io/flyfy/ (this `active-vision` branch: run it locally, below)

A picture appears in front of the fly. Its eye turns it into a few hundred blurry dots, fixed eye
cells modelled on real fly neurons pick out edges, spots and motion, and a small brain of 128
cells decides which foot to press. Right answers earn points; wrong ones hurt. You train it, watch
it learn, and give it a final exam on pictures it has never seen.

## Using it

1. **Pick a challenge** - from "light or dark" (easy) to "man or woman" photos (very hard).
2. **Give it abilities** - switch on things real insects have, like a sharp centre of vision or a
   memory centre. Each one explains itself in a sentence, with more detail and what we measured
   behind "more". A new fly starts with memory centre, colour vision, edge-direction cells and edge
   boost (the measured wins) plus smart eye and mood chemical (what this branch is exploring).
3. **Train it** - **Quick learn** (seconds): the fly learns from rewards and pain as it plays.
   **Evolve** (minutes): a population of brains is bred, keeping the best.
4. **Final exam** - how many of 100 brand-new pictures it gets right. Guessing gets 50.

**Compare** answers "is this ability actually worth it?": it trains several flies with and
without it, in pairs that start from the same luck, and says plainly whether the difference is
bigger than chance. **Inside the brain** shows it live, what evolution chose, and how much the
eye can even see. **Settings** has every number, for tinkerers.

Your fly saves itself in the browser as it trains; **Save fly** downloads it (with its challenge,
abilities and settings) so you can load it anywhere.

## Run it locally

```bash
node server.js        # then open http://localhost:4180
npm test              # all tests (Node 18+)
```

Nothing to install. `server.js` is only needed to serve the files (any static server works); it
also lets you use a bigger local photo folder (Settings -> Faces).

## The abilities

| ability | what it does | needs Evolve? |
|---|---|---|
| **Smart eye** | the brain gets a second output that pans the eye, and feels where it points; moving costs a little | yes |
| **Sharp centre** | same sensors, packed tight at the centre of gaze (a fovea) | no |
| **Edge boost** | each sensor dims its neighbours, so edges pop (lateral inhibition) | no |
| **Mood chemical** | one dopamine-like signal sets how long each brain cell holds a thought, live | yes |
| **Memory centre** | 400 sparse "Kenyon cells" reading the raw light sensors, feeding the learning synapses (the mushroom body) | no |
| **Edge-direction cells** | how strongly edges run in each of 8 directions, per small patch of the eye; each cell adapts its gain to its own typical signal and is read straight by the learning synapses, beside the memory centre | no |
| **Colour vision** | two colour-opponent channels (red-green, blue-yellow) added to what each Kenyon cell reads, on top of brightness; works with the memory centre | no |
| **Look at what stands out** | an innate reflex: turn toward and step up to whatever small spot stands out (no training needed) | no |
| **Step closer or back** | a third eye-motor output walks toward or away from the picture, felt by the brain | yes |
| **Practise at many distances** | each practice picture shown from a random distance (the exam is at the set distance) | no |
| **Learn from surprises** | learns in proportion to how unexpected an outcome was (dopamine as reward prediction error) | no |
| **Self-tuning learning** | evolution tunes the learning rule itself - speeds, reward/pain weights, forgetting | yes |
| **Rewiring** | every 10 generations the weakest 5% of connections are regrown elsewhere | yes |

"Needs Evolve" abilities only get better through evolution; Quick learn trains just the
learning synapses behind the feet. A new fly's eye holds still until evolution teaches it to move.

## What we measured

Every row: 5 flies with and 5 without, paired on the same random seeds, examined on pictures they
never trained on. "Clear" = the average difference is bigger than its 95% confidence margin.
Reproduce any row with `tools/compare.mjs` (see below). Quick = learn by pain, 150 sessions.
Evolve = 30 generations.

| ability | challenge | training | without | with | verdict |
|---|---|---|---|---|---|
| Memory centre | faint stripes | Quick | 62.6% | 92.7% | **better by 30.1 pts** |
| Memory centre (+ colour vision) | faces | Quick | 53.0% | 60.4% | **better by 7.4 pts** |
| Memory centre (grey only) | faces | Quick | 53.0% | 53.6% | no clear difference (+0.6 ± 5.8) |
| Edge-direction cells (+ memory centre) | faces | Quick | 53.6% | 61.2% | **better by 7.6 pts** |
| Edge-direction cells (+ memory, colour) | faces | Quick | 60.4% | 61.6% | no clear difference (+1.2 ± 3.7) |
| Edge-direction cells (+ memory centre) | faint stripes | Quick | 92.7% | 100.0% | **better by 7.3 pts** |
| Edge-direction cells (+ memory centre) | find the spot | Quick | 82.3% | 86.1% | no clear difference (+3.8 ± 6.5) |
| Edge-direction cells (+ memory centre) | stripes | Quick | 99.0% | 100.0% | **better by 1.0 pts** |
| Colour vision (+ memory centre) | faces | Quick | 53.6% | 60.4% | **better by 6.8 pts** |
| Colour vision (+ memory centre) | faint stripes | Quick | 92.7% | 93.5% | no clear difference (+0.7 ± 1.3) - no harm on grey pictures |
| Edge boost | faint stripes | Quick | 62.6% | 77.1% | **better by 14.5 pts** |
| Edge boost | faces | Quick | 53.0% | 53.5% | no clear difference (+0.5 ± 1.7) |
| Sharp centre | faces | Quick | 53.0% | 53.6% | no clear difference (+0.6 ± 2.9) |
| Sharp centre | find the spot | Quick | 59.9% | 72.0% | **better by 12.1 pts** |
| Smart eye | stripes | Quick | 82.9% | 82.9% | identical - a new fly's eye holds still until evolved (before that fix: **worse by 12.3 pts**) |
| Smart eye | find the spot | Evolve | 57.5% | 54.2% | no clear difference (-3.3 ± 8.9) |
| Smart eye (+ Sharp centre) | find the spot | Evolve | 59.5% | 65.3% | no clear difference (+5.8 ± 11.0) |
| Smart eye (+ Sharp centre) | find the spot | Evolve, 150 gen., 6 flies | 70.9% | 76.5% | no clear difference (+5.6 ± 12.7) |
| Mood chemical | stripes | Evolve | 75.5% | 76.9% | no clear difference (+1.3 ± 6.0) |
| Mood chemical | stripes | Evolve, 150 gen., 6 flies | 91.7% | 92.9% | no clear difference (+1.2 ± 2.9) |
| Self-tuning learning | faint stripes | Evolve | 55.4% | 54.1% | no clear difference (-1.3 ± 7.1) |
| Self-tuning learning | faint stripes | Evolve, 150 gen., 6 flies | 58.2% | 60.8% | no clear difference (+2.6 ± 8.6) |
| Rewiring | stripes | Evolve | 75.5% | 75.1% | no clear difference (-0.4 ± 1.9) |
| Practise at many distances | faces | Quick | 53.0% | 53.2% | no clear difference (+0.2 ± 3.8) |
| Practise at many distances | stripes | Quick | 82.9% | 84.7% | no clear difference (+1.8 ± 7.9) |
| Look at what stands out (+ memory centre) | find the spot | Quick | 82.3% | 81.5% | no clear difference (-0.8 ± 7.3) |
| Look at what stands out (+ memory, colour) | faces | Quick | 60.4% | 58.4% | no clear difference (-2.1 ± 4.9) |
| Step closer or back | find the spot | Evolve (60 gen.) | 56.1% | 56.9% | no clear difference (+0.8 ± 8.6) |
| Learn from surprises (+ memory centre) | faint stripes | Quick | 92.7% | 95.3% | **better by 2.5 pts** |
| Learn from surprises (+ memory centre) | stripes | Quick | 99.0% | 100.0% | **better by 1.0 pts** |
| Learn from surprises (+ memory, colour) | faces | Quick | 60.4% | 58.5% | no clear difference (-1.9 ± 7.5) |

Face rows use all 3,330 photos (500-photo exam). Earlier versions of this table used a
1,000-photo set with a 150-photo exam, which flattered faces by about a point.

**In short:**
- **Clear wins, free to try:** the memory centre (+30 points on faint stripes), edge boost (+15 on
  faint stripes), the sharp centre (+12) on find the spot, and edge-direction cells (faint stripes
  and stripes to 100%, grey faces +8), and, for faces, colour vision together with the memory centre
  (+7). All of them work with Quick learn.
- **Faces:** two things help, each by about 7-8 points: colour vision, and edge-direction cells
  (53-54% -> 61%). Together they reach 61.6%, barely more than either alone - on these photos they
  carry largely the same information (see "How far can faces go?" below). Every other ability lands
  within about a point of the 53% baseline, the memory centre on its own too.
- **Learn from surprises:** real dopamine signals how much better or worse things went than
  expected. Learning in proportion to that surprise helps the clean tasks (faint stripes +2.5,
  stripes to 100%), but trails on faces in every variant tried. The likely reason: some face
  labels are noisy (group photos), and a surprise-driven rule learns hardest from confident
  "mistakes" - exactly the mislabelled pictures. So it is off by default, and worth switching on
  for clean challenges.
- **Step closer or back:** evolution did not discover it in 60 generations (+0.8, not clear), even
  though simply putting the picture closer is worth +17.5 on find the spot. A new fly's legs start
  still, and the small random changes evolution tries barely move it within one picture, so the
  benefit is too faint to select for.
- **Smart eye:** at first it *hurt* Quick learn by 12 points - an untrained eye wandering at random
  made learning noisier - so a new fly's eye now holds still until evolution teaches it to move,
  which removed the harm entirely. With the sharp centre, evolution came out about 6 points ahead
  both at 60 and at 150 generations, but the flies split widely (63% to 90% at 150 generations): 2 of 6
  found a looking strategy worth 88-90%, while 2 did worse than a still eye. Plausibly a real effect
  that evolution only sometimes finds - not provable with 6 flies.
- **Mood chemical, self-tuning learning, rewiring:** 150 generations (5x longer) left mood (+1.2)
  and self-tuning (+2.6) still ahead but within luck. They are cheap and switched off unless you
  want them.

## How far can faces go?

Man-or-woman is hard for this fly, and it is fair to ask whether the fly is the limit or the photos
are. The tools in `tools/` answer that by cross-validating ideal readers (class averages, the best
straight line) on each stage, always with equal numbers of men and women so guessing scores 50%.

| what the reader sees | best reader | fly-style reader* |
|---|---|---|
| 32x32 grey photo, raw pixels | 58.7% | |
| ...cropped by a skin-colour face finder instead | 54.0% | |
| 32x32 colour photo, raw pixels | 63.0% | |
| 32x32 grey photo, 2,000-8,000 Kenyon cells | 58.6% | |
| 32x32 grey photo, pooled edge directions (8 directions, 4x4 patches) | 65.4% | |
| 32x32 colour photo, pooled edge directions + pooled colour | 66.1% | |
| the fly's eye (14x20 sensors) | 58.2% | 56.4% |
| the fly's eye, 400 Kenyon cells | 60.3% | 57.8% |
| the fly's eye, edge-direction cells (2x2 patches) | 63.3% | 55.8% |
| ...the same, gain-adapted | 63.3% | **62.7%** |

\* class averages on the signals as they are, which is what reward/pain learning computes.

What this says:
- **The photos are the main limit.** They are not lined up: faces sit at different places, sizes and
  angles, often with other people in the frame. Raw pixels therefore carry little that a simple
  reader can use, and more Kenyon cells don't change that. Framing each photo on its skin-coloured
  patch made it *worse*, because the eyes and mouth then land in different places from photo to photo.
- **Colour adds about 4 points on raw pixels**, which is why colour vision plus the memory centre
  was the first clear face win. On top of edge directions it adds little (65.4% to 66.1%): much of
  what colour tells apart, pooled edges tell apart too.
- **Edge directions beat pixels by about 6 points.** Pooled over a small patch, "which way the edges
  run here" survives small shifts that scramble raw pixels. Sharp direction tuning matters: edge
  strength without direction does no better than pixels, and 4 directions give ~62% against 65% for 8
  (on the full photo).
- **But the fly has to be able to use it.** Reward/pain learning weighs every input by its raw size.
  Edge cells are weak (their spread is a third of brightness'), so read as they are they help
  nothing (55.8%), and mixed into the Kenyon cells they are swamped by brightness. Divided by their own
  typical spread (gain adaptation, which real sensory neurons do constantly) they reach 62.7% with
  the fly's own learning rule. Hence the ability's design: gain-adapted edge-direction cells read
  directly by the learning synapses, beside the Kenyon cells. Real flies trained that way went from
  53.6% to 61.2% on grey faces - just what the analysis predicted. (Mixing the edge cells into the
  Kenyon cells instead, the first version, made no clear difference on faces.)
- **What is left:** the fly now sits within about 2 points of what a fly-style reader could get from
  its eye (62.7%), and about 5 below the best reader on full-resolution photos (66%). Going much
  further would take better-aligned photos (a real face/eye finder) or a sharper eye.

## Distance and lenses (the billboard question)

Up close a billboard is a grid of dots; from further away the dots melt into a clean picture, but
small details disappear. Could a fly see some things *better* from further away? Two pieces make
that question testable here:

- **Viewing distance** (Train tab, "How far away": close / normal / far / very far). Further away
  the picture is smaller on the eye, with darkness around it; closer, it is bigger and may not fit.
- **Lens blur** (Settings). A real ommatidium averages light over a small cone about as wide as the
  gap to its neighbour - that averaging is what makes the billboard look clean from afar. Without
  it, each sensor reads one exact point (a pinhole), and a picture seen from afar turns into false
  moire patterns instead of a clean, smaller image. Implemented with a per-picture mipmap, so each
  sensor reads the picture at exactly the blur its cone implies, at any distance.

What training flies actually showed (Quick learn, 5 paired flies each):

| change | challenge | before | after | verdict |
|---|---|---|---|---|
| lens instead of pinhole | faint stripes | 62.4% | 56.8% | **worse by 5.6 pts** |
| lens instead of pinhole | find the spot | 59.7% | 49.1% | **worse by 10.6 pts** |
| lens instead of pinhole | stripes | 82.9% | 81.4% | no clear difference (-1.5 ± 2.5) |
| lens instead of pinhole | faces | 54.2% | 53.3% | no clear difference (-0.9 ± 1.6) |
| half-strength lens instead of pinhole | faint stripes / find the spot | 62.4% / 59.7% | 59.6% / 53.6% | **worse by 2.8 / 6.1 pts** |
| closer (0.6x) | find the spot | 59.9% | 77.4% | **better by 17.5 pts** |
| further (1.7x) | faint stripes | 62.6% | 55.4% | **worse by 7.2 pts** |
| further (1.7x) | faces | 54.2% | 53.4% | no clear difference (-0.8 ± 5.0) |
| further (1.7x), with lens instead of pinhole | faces | 53.4% | 56.6% | no clear difference (+3.2 ± 6.0) |
| practise at many distances | faces / stripes | 54.2% / 82.9% | 53.7% / 84.7% | no clear difference |

(Face rows here were measured on the earlier 1,000-photo set.)

So, honestly: for this fly, **closer beats further**. Its eye is already so coarse (a few hundred
sensors) that pictures never carry "too much" detail for it; stepping back only throws detail away,
and even the noise-averaging you would expect on faint, noisy stripes doesn't make up for it. And
the realistic lens *hurts* learning: a brain that is trained can use the pinhole's sharp, even
aliased, detail, which the lens smooths away. The pinhole therefore stays the default; the lens is
there for realism. The one hint of the billboard effect: with the lens, faces seen from further
away came out 3 points ahead - not enough to call.

## For developers

Zero dependencies, plain ES modules, runs in any modern browser and in Node.

| file | what's in it |
|---|---|
| `src/brain.js` | eye cells (LC layer), recurrent core, feet, gaze motor, mood chemical, memory centre, learning rule |
| `src/world.js` | the trial world: screen, eye movement, feet, rewards, pain |
| `src/abilities.js` | the challenges and abilities as named config bundles, plus measured results |
| `src/experiment.js` | one fair trial (train a fresh fly, then examine it) - shared by the app and the CLI |
| `src/stats.js` | paired comparison with a 95% confidence margin, and the plain-language verdict |
| `src/topology.js` | rewiring |
| `src/es.js`, `src/worker.js`, `src/rollout.js` | evolution strategies, Web Workers, one simulation step |
| `src/app.js`, `src/compare.js`, `src/viz.js` | the interface |
| `data/faces32.bin`, `faces32c.bin` | all 3,330 face photos, 32x32 brightness plus 16x16 colour (5 MB), so Node can test on them too |
| `tools/pack-faces.*`, `tools/*-headroom.mjs`, `tools/frame-faces.mjs` | rebuild the face data from the original photos, and measure how far any reader could get on it |

Compare any two setups from the command line (runs in parallel, one process per core):

```bash
node tools/compare.mjs --task faint --method quick --seeds 5 --test memory
node tools/compare.mjs --task spot --method thorough --seeds 5 --test smartEye --with fovea
```

`--task` brightness | gratings | faint | spot | faces, `--method` quick | thorough, `--test` an
ability id (A = without, B = with; everything else off unless listed in `--with`), or raw
`--a` / `--b` JSON config overrides. `--gens`, `--pairs`, `--episodes` change the budget.

The eye cells are an abstraction of real fly LC neurons, not a copy of the connectome.
