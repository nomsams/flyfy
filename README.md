# Fly Lab

Teach a tiny simulated fly brain to tell pictures apart - right in your browser. No install, no
account, no server needed.

**Try it:** https://nomsams.github.io/flyfy/ (or run it locally, below) · **Read the guide:** https://nomsams.github.io/flyfy/guide.html, a plain-language, interactive walk through the fly, its eyes and brain, and every experiment

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
| Edge-direction cells (+ memory, colour), 15 flies | faces | Quick | 60.8% | 62.7% | **better by 1.9 pts** (5 flies had shown +1.2 ± 3.7) |
| Edge-direction cells (+ memory, colour, sharp centre), 15 flies | faces | Quick | 60.6% | 63.3% | **better by 2.7 pts** |
| Edge-direction cells (+ memory, colour), 600 sessions, 10 flies | faces | Quick | 60.3% | 63.8% | **better by 3.5 pts** |
| Colour vision (+ memory, edge cells), 15 flies | faces | Quick | 61.7% | 62.7% | **better by 1.0 pts** |
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

## A swarm of flies

Can many flies decide together better than one? `tools/swarm.mjs` trains a swarm with Quick learn and
shows every fly the same 500 held-out face photos, recording each answer and its margin (how far
one foot's drive led the other's). All flies have the app's default abilities (memory centre, colour
vision, edge-direction cells, edge boost), plus the sharp centre where marked. Scores are balanced
(men and women count equally, guessing = 50%): the held-out photos keep the dataset's 57% women,
and re-scoring every run this way moved results by under a point.

| swarm (faces) | one fly | mistakes alike* | 9 flies | 101 flies |
|---|---|---|---|---|
| every fly sees the same view | 60% | 0.61-0.63 | 60-62% | |
| ...each fly with its own random wiring | 60% | 0.61 | 61% | |
| **sharp centre + each fly its own centre of gaze on a 10-15 degree circle** | 59-61% | 0.36-0.42 | **65-66%** | |
| ...the same on rings of 0, 5, 10, 15 degrees | 60-61% | 0.39-0.42 | 65.0% | 65.3-66.4% (3 runs) |
| circle without the sharp centre | 59% | 0.48 | 61% | |

Swarm columns: margins summed, each fly also taking a mirrored look. * correlation of right/wrong
between two flies: 0 = independent mistakes, 1 = identical.

What it shows:
- **A swarm only helps if its flies see differently.** Flies that all look at the same spot make
  the same mistakes, so voting gains about a point. Giving each fly its own centre of gaze on a
  circle around the picture's middle - with the sharp centre, so each one sees a *different part*
  of the face in detail - makes their mistakes differ, and the vote gains 5-6 points.
- **How to vote matters.** Summing each fly's margin beats a plain majority by 1-3 points; scaling
  each margin by that fly's typical margin adds up to half a point more.
- **A learned judge doesn't beat equal votes.** With `--judge`, 20% of the training photos are set
  aside: the flies never train on them, a judge learns from the flies' answers on them, and the exam
  photos stay untouched. Four judges - a fitted threshold, Hebbian trust (each fly weighted by how
  well it leaned the right way), and logistic regression with and without negative weights - landed
  from 4 points below to 1.7 above plain equal votes, with no consistent winner (a 500-photo exam is
  good to about +-2 points). Every learned judge scored higher on its own photos than on the exam: it
  overfits. So the simplest rule - add up the scaled margins - is also the best one found, which
  suits small hardware. (Hint for later: at 101 flies, the judge that could only trust or ignore
  flies used just 10 of them and still scored 67.1%.)
- **Size:** 3 flies 63-64%, 9 flies 65%, 25 flies 65-66%, 101 flies 65.3-66.4%. Past about 9-15 flies the
  vote levels off near 66% - the same as the best straight-line reader on the full-resolution
  photos, so the swarm is extracting about all a simple reader can get from these pictures. With
  101 flies only 2% of photos are ones nearly all get wrong, but 47% split the swarm almost evenly.
- **Several looks per fly** (the "loop trick" as whole looks: the view nudged half a sensor gap
  around a small circle, margins summed) lifts one fly from 61% to 63.4%, but adds nothing on top of
  a circle swarm - the circle already supplies that variety. Jittering *within* one look (with the
  foot signals averaged) did not help (-2.2 and +0.1 points), as before: there is no time to average.
- **Viewpoint tolerance:** a fly shrugs off sideways shifts up to a full sensor gap, but seeing the
  picture 10% nearer or further than in training drops it to chance - every answer tips to one
  foot, because its adapted "average picture" no longer fits. Letting adaptation continue during
  the exam (`learn.keepAdapting`) softened that (44% -> 52% at 1.1x) but cost 2.4 points at the
  trained distance, so it stays off. *Practising at many distances* removes the cliff entirely - a
  fly then scores 55-57% at every distance from 0.9x to 1.1x - but costs about 4 points at the
  trained distance (60% -> 56%), since the same number of practice pictures is spread over many sizes;
  summing 10 looks wins it back (61.5% either way). For a swarm that only ever looks sideways, as
  planned, the fixed-distance training is the better choice; for cameras whose distance can drift,
  the practised flies are the safer one.

### Pushing past 66%

| idea | what was done | result |
|---|---|---|
| align the photos | `tools/align-faces.mjs`: shift (and zoom) each photo until it best matches a learned average face, no labels used | worse: 55.6% (zoom, cuts off hair) and 56.5% (shift only) vs 58.7% for the plain upper crop; with edge directions 65.0% vs 66.0% |
| a sharper eye | 20 x 28 and 28 x 40 sensors, a stronger fovea (1.4) | 57.8% (clearly worse), 60.8%, 60.4% vs 60.7% |
| a second, nonlinear layer | Kenyon cells reading the gain-adapted edge cells, a second patch size (`tools/faces-headroom.mjs --orient-kc --second-layer`) | fly-style ceiling 63.3% vs 62.8%: not worth building |
| longer practice | 600 sessions instead of 150 | 60.7% -> 62.9% (+2.2, all 5 flies better, just short of clear) |
| **boosting swarm** | `tools/boost.mjs`: flies join in rounds of 5; the photos the swarm so far gets wrong are shown more often to the next round (AdaBoost weights, capped at 4x) | **25 flies: 66.6% and 68.0%** in two runs vs 65.7% and 65.3% for the same swarm without boosting; best 70.6% at 20 flies with AdaBoost vote weights |

Boosting is the first result above the 66% straight-line ceiling, which fits: a swarm of specialists
is not a single straight-line reader. The boosted newcomers are poor on their own (49-54% on the
exam after round 2) and valuable only together. Two runs, each good to about +-2 points: promising,
not proven. Also checked: only 6 of the 500 exam photos (1.2%) have a near-copy among the training
photos, so duplicate leakage flatters results by at most about half a point.

### On a microcontroller (ESP32-CAM)

One fly is small. Measured in this code: 4,452 evolved parameters, 1,920 learned synapses, 400
Kenyon cells with 9 inputs each, a 14 x 20 eye, 20 steps per simulated second, and roughly 40-50
thousand simple operations per step (about a third of them the Kenyon cells). As 32-bit floats the
whole brain is ~120 KB, most of it regenerable: the wiring comes from one seed, and a Quick-learn
fly's core weights from another. What a fly actually *learns* is ~3,900 numbers (learned synapses,
adapted averages and spreads): ~16 KB as floats, ~8 KB as 16-bit.

A rough budget for an AI-Thinker ESP32-CAM (dual-core 240 MHz, 520 KB internal SRAM of which a
few hundred KB are free next to the camera driver, 4 MB PSRAM, OV2640 camera):
- **Camera:** the lowest frame sizes (96 x 96 or 160 x 120, RGB565 for colour vision) are plenty -
  the eye has 14 x 20 sensors. One frame is 18-38 KB.
- **One fly:** ~60-80 KB of working memory - fits in internal SRAM; ~0.3-0.5 ms per step, about 1% of
  one core at 20 steps per second.
- **A virtual swarm on one board:** measured above, flies can share one wiring without losing
  anything, so each extra fly costs only its learned ~8-16 KB and its own centre of gaze is just a
  different crop of the same frame. About 10-15 flies fit in internal SRAM (16-bit); 101 fit in PSRAM (~1-1.6 MB).
  One decision is ~10 steps per fly: roughly 0.1 s for 9-25 flies and about a second for 101.
- **A physical swarm** (one board per fly, answers exchanged by ESP-NOW broadcast, a few bytes
  each) gets truly different viewpoints for free, but each fly then has to be trained from where it
  stands - and, given the distance cliff above, the rig must keep the distance fixed or the flies
  must practise at many distances.
- **Training** can stay on a PC (this code) with the learned state flashed per fly, or run on the
  board: one learning update is ~2,000 multiply-adds.

Given the measurements, a single ESP32-CAM (or the roomier ESP32-S3 camera boards, with 8 MB PSRAM
and vector instructions) running 9-25 virtual flies gets nearly everything 101 flies do.

## Next challenge: following a route over a Wonderland maze

A first prototype, command line only (`src/route/`, `tools/route.mjs`, `tools/route-map.mjs`). The fly hovers
over a procedurally generated maze - a patchwork of meadow, a checkered rose garden, sand, lilac and
ponds, with wobbly walls of hedges, rose bushes, mushroom chains and stone that cast shadows - and must
follow a route it was shown before, using only the view straight down (the same 14 x 20 eye, which
turns with the fly). The route is never drawn; the fly only ever sees the landscape.

Two ways to learn were tried:
- **Steer:** learn by reward and pain which wing to beat from each view. It did not work (below
  a blind fly flying straight): the right turn depends on the exact place and heading, too many
  combinations to learn from a few thousand views.
- **Familiarity**, the way ants and bees are thought to follow routes: while flying the route a few
  times, every view silences the Kenyon cells it uses on a "novelty" output, as dopamine does in the
  mushroom body. To navigate, the fly looks in 9 directions and flies the way that looks most
  familiar. It needs a big memory centre (20,000 Kenyon cells, 1% firing; 4,000 cells run out).

| released near the route, wrong heading (2 mazes x 2 flies x 15 releases) | reaches the goal | route flown |
|---|---|---|
| familiarity, brightness | 33% (35% on a changed maze) | 58% (67%) |
| **familiarity, brightness + colour** | **52% (50% on a changed maze)** | **69% (73%)** |
| teacher (upper bound) / blind straight flight | | 96% / 51% |

"Changed maze": the same layout and route with flowers moved, walls bent differently and other light
(`makeWonderland({ variant: 1 })`) - it costs nothing. The whole learned route is one bit per Kenyon cell,
2.5 KB, and the cells' wiring comes from one seed.

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

A swarm - many flies, each with its own centre of gaze, voting on the same held-out photos:

```bash
node tools/swarm.mjs --flies 9 --with smartEye,mood,memory,edges,colour,orient,fovea --circle 10
```

`--task` brightness | gratings | faint | spot | faces, `--method` quick | thorough, `--test` an
ability id (A = without, B = with; everything else off unless listed in `--with`), or raw
`--a` / `--b` JSON config overrides. `--gens`, `--pairs`, `--episodes` change the budget.

The eye cells are an abstraction of real fly LC neurons, not a copy of the connectome.
