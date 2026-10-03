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
4. **Or train a swarm** (step 3b) - many flies, each looking at the photo from its own spot, vote on every
   answer. On the face photos one fly scores about 60% and a boosting swarm of 25 about 68% (see "A swarm of
   flies" below). **Set everything to the best setup** picks the face photos, every ability that measured as a win
   and a boosting swarm of 25 with longer practice in one click; the swarm trains in Web Workers, one fly per
   core at a time, and its score climbs as flies join.
5. **Final exam** - how many of 100 brand-new pictures it gets right. Guessing gets 50.

**Compare** answers "is this ability actually worth it?": it trains several flies with and
without it, in pairs that start from the same luck, and says plainly whether the difference is
bigger than chance. **Inside the brain** shows it live, what evolution chose, and how much the
eye can even see. **Settings** has every number, for tinkerers.

**"Too early" points.** A press before the picture has been up for the reaction time used to be a "too early"
error (-2 points and some pain) and could fill the score with negative points. It is now simply not counted
(Settings -> Timing -> Ignore early presses; 1 by default). Measured on the face photos, 6 flies each way:
60.0% with the penalty, 59.8% without (-0.2 +- 2.0, no difference), and the score ledger no longer shows a "Too
early" row.

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
not proven.

**The swarm in the app** (Train tab, step 3b; `src/swarm.js`, `src/swarm-ui.js`; the same code as `tools/boost.mjs`).
Every fly trains in its own Web Worker; the page adds up their scaled margins (each fly's margin over 4 looks,
divided by its own typical size) and, with boosting, the votes weighted by each fly's AdaBoost "say". One run each
(500 exam photos, men and women counted equally, about +-2 points):

| boosting swarm, gaze circle 10 degrees | equal votes | votes weighted by say |
|---|---|---|
| 25 flies, 150 sessions each | 68.1% | 68.1% |
| 25 flies, 300 sessions each (the "best setup") | 67.9% | **69.2%** |
| 25 flies, 600 sessions each | 67.3% | 67.9% |
| 50 flies, 150 sessions each | 67.8% | 68.5% |
| 25 flies, gaze circle 6 degrees (instead of 10) | 66.7% | 65.8% |
| 25 flies, gaze circle 15 degrees | 65.1% | 67.3% |
| 25 flies, also looking from distances 0.9 / 1 / 1.1 | 68.8% | 68.2% |
| 25 flies, distances 0.85 / 1 / 1.15 | 66.7% | 69.0% |

The gaze circle has a sweet spot near 10 degrees (6 and 15 are 1-3 points worse), and letting flies also look from
different distances adds nothing (`tools/boost.mjs --dists 0.9,1,1.1`).

So about 68-69% is where this swarm levels off: more flies (50) and longer practice (600 sessions) add nothing
measurable, and the weighted votes are only ahead from about 15 flies on (at 10 flies they were 6-7 points behind).
The app therefore uses equal votes below 15 flies and weighted votes from 15 flies up. **Set everything to the best
setup** selects 25 flies, boosting and 300 sessions. One fly alone is about 60%.

Also checked: only 6 of the 500 exam photos (1.2%) have a near-copy among the training
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

**Flying high or low.** The view below shrinks and sharpens as the fly drops, so height causes the same
cliff as viewing distance did for faces. Reached the goal / route flown (2 mazes x 2 flies x 12 releases;
a blind straight flight covers 53% of these routes):

| trained | flown at 0.5 (low) | 0.7 | 1 | 1.4 (high) |
|---|---|---|---|---|
| at height 1 only | 2% / 38% | 8% / 34% | 44% / 72% | 19% / 52% |
| at 4 heights, one memory | 17% / 48% | 29% / 60% | 35% / 62% | 35% / 66% |
| at 4 heights, a memory per height (the fly knows its height) | 33% / 62% | 35% / 62% | 42% / 58% | 29% / 65% |
| **...plus a swarm of 3** (gaze centres on a circle, summed unfamiliarity) | **40% / 69%** | | **50% / 67%** | |
| 4 heights, one memory, swarm of 5 | 33% / 60% | | 50% / 75% | |

Practising at several heights removes the cliff; a memory per height helps most when low; a small
swarm adds about 7 points on top. Casting (sweeping side to side when nothing looks familiar, like a
moth that lost a scent) made things worse (e.g. 50% -> 29% for the swarm at height 1): a third of a
cell off the route already looks unfamiliar, so the fly casts exactly when a small correction would
have done. It stays off; a version that casts only after staying lost for a while is still to try.

**A natural world, and dropped anywhere.** The maze now stands in the countryside, like the Queen's
garden in Alice in Wonderland: hedges (tall and low, rose hedges, old stone walls, topiary) on a lawn
mowed in stripes, a gravel path around it, fields (meadow, wheat, ploughed soil, crop rows, orchards)
with hedgerows between them, roads, houses and barns, trees and a pond. (The tables above were
measured on the earlier, colourful "Wonderland" patchwork.) It is much harder: inside a real hedge
maze every corridor looks alike - a fly released near the route with the simple setup reached the
goal 13% of the time, against 44% before.

To be dropped anywhere, the fly first has to find the route. Like ants making learning walks around
their nest, it makes **learning flights** toward the route from spots all over the map and keeps those
views in a second, graded memory (each view halves the novelty of the cells it uses; a yes/no memory
filled up - 94% of cells familiar - and failed). Navigating, it follows that memory until the route
itself looks familiar, then the route memory to the goal (`--approach 1 --drop`):

| dropped anywhere, facing anywhere (2 mazes x 2 flies x 10 drops) | found the route | reached the goal |
|---|---|---|
| route memory only | 45% | 25% |
| + learning flights | 77% | 30% |
| **+ 4 training heights, a memory per height, swarm of 3** | **90%** | **55%** |
| same, flown low (0.5) | 77% | 48% |
| teacher / blind straight flight | | 100% / 10% |

**Keeping track instead of deciding afresh.** An ideal helicopter knows its heading, speed and height
(insects get the same from path integration). So instead of choosing a direction from scratch every
step, the fly keeps a belief of how far along the route it is: moved on by its own motion, blurred a
little, and sharpened by how well the view matches patterns it stored in order while learning the
route (a sequence of views tells look-alike hedge corridors apart where one view can't). It then
prefers directions near the route's direction at its best guess, as firmly as it is sure, with the
familiarity scan still correcting sideways drift. Short gaps (the route out of sight for up to 1.5
cells) keep the belief going on odometry; only a longer loss resets it (`--track`):

| | without tracking | with tracking |
|---|---|---|
| single fly released near the route | 13% goal / 47% flown | **70% / 91%** |
| full setup, dropped anywhere, flown low (0.5) | 48% | **63%** |
| full setup, dropped anywhere, height 1 | 55% | 53% |
| full setup, dropped anywhere, flown high (1.4) | 52% | **65%** |

(Full setup: learning flights, 4 training heights, a memory per height, swarm of 3; 40 drops per row,
about +-8 points.) Resetting the belief at every short gap threw most of the gain away when dropped
anywhere (48-60%).

**Knowing where it is on the map.** During the learning flights the fly also stores, for every spot,
the view turned north-up (the helicopter's compass lets it turn its camera image, so one stored view
per spot fits whatever way it faces), and while learning the route it notes where the route lies
(its own odometry). Dropped anywhere, it keeps a belief over the whole map - moved on by its own
motion, sharpened by matching its north-up view - and once sure flies from its best guess straight to
the route. Its position guess is typically off by 0.15 cells (`--map`). Without turning the views
north-up it failed (off by 6.7 cells): views taken facing other ways rarely match.

Four more ideas, each added to the full setup with tracking (dropped anywhere, facing anywhere; 2 mazes
x 2 flies x 10 drops, about +-8 points):

| added | reached the goal, height 1 | flown low (0.5) |
|---|---|---|
| (full setup with tracking) | 53% | 63% |
| **knowing where it is on the map** | **100%** (every fly) | **80%** |
| a wrong-way memory (views of the wrong turns stored as "avoid") | 63% | |
| three circles in a row across one camera frame (2 + 3 + 2 members) | 68% | |
| climbing when unsure | | 55% (worse) |
| **all of them together** | **95%** | **93%** |
| single fly, learning flights, tracking and map | 90% | |

**Weather and a contrast filter.** The camera's picture can be changed by haze or fog (it fades toward a
pale grey), overcast, dusk (darker and warmer), night (much darker, bluish, noisy) or a noisy camera
(`--weather`). A fly trained in clear weather is lost in haze, fog and dusk: every view looks unfamiliar.
A contrast filter - each view stretched so its brightness always has the same spread (`--normalize`),
the kind of gain control real eyes do - fixes that; the edge boost does not. Single fly, dropped
anywhere, trained in clear weather (2 mazes x 2 flies x 10 drops), reached the goal:

| weather | no filter | contrast filter | edge boost |
|---|---|---|---|
| clear | 85% | **98%** | 87% |
| haze | 5% | **93%** | 5% |
| fog | 3% | **88%** | 3% |
| overcast | 93% | 93% | 83% |
| dusk | 15% | **95%** | 15% |
| night | 10% | 28% | 8% |
| noisy camera | 90% | 95% | 33% |

"Reached the goal" here means getting within 0.8 maze cells of it. The stricter test used before (within
about half a cell of the route's very last point) undercounts when noise makes the fly hover around the
goal: it gave 38% / 63% for the noisy camera, where 90% / 95% got within 0.8 cells. Camera noise alone
is survivable; night, dark and noisy at once, is the weakest case (10% -> 28% with the filter).

**Night, wind and a bad odometer** (2 mazes x 2 flies x 10 drops, "within 0.8 cells of the goal"; mazes 1 and 2,
route flown three times). A real camera takes many frames while the fly flies one step, so `--burst k` averages
k frames per step (noise / sqrt(k)); `--smooth 1` blurs every view over its neighbours. Both change what the
brain gets, so the fly also learns with them.

| night (light x 0.25, noise 0.05), contrast filter | within 0.8 cells |
|---|---|
| filter only | 20% |
| + 4 frames per step | 80% |
| + 16 frames per step | **93%** |
| + smoothing | 77% |
| + smoothing and 4 frames | 85% |
| 16 frames, no filter | 8% (both are needed) |
| moonless (light x 0.1): filter / + 16 frames / + 64 frames | 13% / 48% / 77% |
| foggy night, filter + 16 frames | 40% |

Wind (`--wind 0.4` = a steady push of 40% of the flying speed, unknown to the fly) and odometer errors
(`--odo-bias`, `--odo-noise`, `--odo-scale`: its idea of heading and distance flown) cost little, because the
pictures keep pulling the belief back: ideal 90%, wind 20% 88%, wind 40% 80%, heading off by 6 degrees 83%, by
17 degrees 80%, noisy compass 93%, distance 25% off 90%. Night + filter + 16 frames + wind 30% + odometer 11
degrees off and noisy: 93%.

**Not every maze is easy - and why.** Everything above was measured on mazes 1 and 2. Over six 6 x 6 mazes
(`--worlds 6`) the full fly with three route passes got only **54%** (per maze 81, 94, 88, 0, 25, 25%), and in
bigger mazes it got worse (10 x 10: 38%, 12 x 12: 8%). Trying more memory cells, more or fewer learning flights,
casting, climbing and a swarm changed little. The cause: the yes-or-no route memory fills up (79% of the cells
after three passes of a 22-cell route). "On the route" is judged by the best of nine directions looking at most
12% new, so in a full memory everything is below that level: the fly believes it is on the route everywhere and
never uses its map. (In the in-page fly, new cells on the route / elsewhere: maze 1 16% / 20%, maze 4 4% / 8%,
maze 6 10% / 10%.) Two fixes:

1. **Fly the route once** (`--flights 1`): six mazes 54% -> **99%** (two passes: 75%).
2. **The fly measures its own level** (`--calibrate 0.25`; `FamiliarSwarm.calibrate`): after learning it notes how
   new the best direction looks on the route and far from it, and puts "on the route" a quarter of the way
   between. Three passes: 54% -> 83%.

| maze size (within 0.8 cells) | 3 passes | 1 pass | 1 pass + calibrated | calibrated, fresh run |
|---|---|---|---|---|
| 6 x 6 (6 mazes) | 54% | 99% | 94% | |
| 8 x 8 | 19% | 67% | 92% | |
| 10 x 10 | 47% | 38% | **90%** | 92% |
| 12 x 12 | 6% | 8% | **92%** | 92% |
| 14 x 14 | 13% | 6% | 75% | **94%** |
| 18 x 18 (2 mazes) | - | - | 67% | 75% |
| 24 x 24 (2 mazes) | - | - | - | 46% |

A correction: the first 14 x 14 and 18 x 18 figures (75% and 67%) were taken while the lab's code was being
edited between runs. Fresh runs from one frozen version (`--worlds 3`/`2`, 2 flies, 6 drops, one pass,
calibrated) gave the "fresh" column in the table above; with only two to four mazes per row, differences of
about 15 points are still luck of the maze.

Two more ideas for bigger mazes, measured on the same mazes (`--regions N` cuts the route into stretches of N maze
cells with their own route memory, picked by where the fly believes it is; neighbouring stretches count too):

| idea | 14 x 14 (3 mazes) | 18 x 18 (2 mazes) |
|---|---|---|
| plain fly (fresh run) | 94% | 75% |
| `--regions 4` | 61% | |
| `--regions 8` | 50% | |
| `--regions 6` | | 96% |

Regional memories hurt at 14 x 14 (a wrong belief about the stretch loads the wrong memory, and the fly then
sees the whole route as unfamiliar) and helped at 18 x 18, so the verdict is "maze-dependent, not yet trusted".
Two more tried on top (24 x 24 baseline 46%, 18 x 18 baseline 75%): **corridor-only learning flights**
(`--corridor 6`: practise only within 6 maze cells of the route, so fewer views crowd the memory) gave 38% at 24 x 24
(no gain, slightly worse), and **scouting** (`--scout 10`: when the map belief has been unsure for 10 steps, fly
straight on) gave exactly the baseline at both sizes (46% and 75%), meaning it practically never triggers. At
24 x 24 the failures are mostly whole mazes (flies per maze: 0, 0, 100, 83%; the teacher alone reaches the goal in
only 58% of drops), so the limit is the maze, not these tweaks.
Mixing abilities in a face swarm (`tools/boost.mjs --mix`: flies cycle full / no edge-direction cells / no colour,
25 flies, 300 sessions, circle 10 degrees) gave 69.9% with boosting and 68.7% with equal votes, +0.7 points
over an ordinary swarm: no clear gain.

**Longer voyages: launched from A, a cone of drift.** The realistic job is not "dropped anywhere" but "launched near A, fly to B",
with wind and a drifting odometer pushing the fly into a cone around the route. `--launch 1` releases the fly within 1 maze
cell of the start, `--wind 0.3 --odo-noise 0.05` push it off (the odometer does not see the wind), and the map belief
can use what the fly knows about the launch: `--prior` (it starts inside the launch zone and runs from take-off) and `--cone 0.4`
(it may not be further from where its odometer says than the zone plus 0.4 x the distance flown). Training can use the same idea:
`--corridor 2 --funnel 0.3 --end-zone 3` makes learning flights only in a band 2 cells wide that widens by 0.3 cells per cell
flown, plus 3 cells around the goal. Also built, all optional: `--idf` (rare Kenyon cells count more, as tf-idf in bag-of-words place
recognition), `--anchors 1` (views no far-away place resembles count more), `--seq 8` (sequence matching: the match is averaged over the last
8 looks, shifted by the odometer), `--coarse 6` (only the 6 most likely 64-px blocks are matched), `--particles 1500` (a particle filter instead
of the grid belief). Results, goal reached within 0.8 cells, 2 mazes x 2 flies x 6 launches (24 flights, so about +-10 points):

| training | map belief | 18 x 18 | learning views | 24 x 24 | learning views |
|---|---|---|---|---|---|
| whole map | as before | 50% | 20,121 | 38% | 20,964 |
| whole map | cone | 58% | 20,121 | 29% | 20,964 |
| funnel band | as before | 46% | 7,479 | 42% | 15,367 |
| funnel band | cone | 62% | 7,479 | 21% | 15,367 |
| funnel band | cone + idf | **71%** | 7,479 | | |
| funnel band | cone + anchors | 67% | 7,479 | | |
| funnel band | cone + sequence matching | 58% | 7,479 | | |
| funnel band | cone + coarse-to-fine | 50% | 7,479 | | |
| funnel band | cone + particle filter (1,500) | 25% | 7,479 | | |

What it says, honestly: training only in a funnel costs nothing measurable (46% against 50% at 18 x 18, 42% against 38% at 24 x 24) and
stores 2.7 times fewer views at 18 x 18 (1.4 times at 24 x 24, where the band covers more of the map). The cone helped at 18 x 18 (+8 to +16 points) but not at 24 x 24 (29% and 21%), where
two of the four flies fail in every setting: that maze is the limit, not the localiser. Of the extras, tf-idf weighting was the best (+9 on the cone),
anchors a little, sequence matching and coarse-to-fine nothing, the particle filter worse (with 1,500 particles it loses the position under wind; it would need more particles or a smarter motion model).
Wind that the odometer cannot see is the main enemy (on 6 x 6 mazes wind of 40% of the flying speed took 94% down to 69%, and only the optic-flow odometer gave much back), which is why the optic-flow odometer matters more than any of these. A quick run only; not repeated, not a proof.
Not done: the same techniques with the fly dropped anywhere (the batch was dropped as beside the point), and the 24 x 24 runs of the extras.

**A sky compass (sun by day, stars by night).** The fly's heading comes from a gyro whose error accumulates (a random walk), so on a long
flight it grows with the square root of the time. A sun/polarised-light compass (insects use the sky's polarisation pattern; bees correct for the sun's slow
movement with a clock) gives an absolute heading whose error does not accumulate; at night the same job would be done by the star field's rotation around the pole (a dim-light
upward camera and a small star-pattern lookup). Modelled with the existing flags: `--yaw-walk` for the gyro, `--yaw-compass` for a sky compass (an error each step that never accumulates).
12 x 12 mazes, launched at A, no wind, 36 flights per row:

| heading | goal reached |
|---|---|
| perfect | 97% |
| gyro only, drifting 0.03 rad per step | 58% |
| gyro only, drifting 0.08 rad per step | 33% |
| sky compass, error 0.05 rad every step | 86% |
| sky compass, error 0.15 rad every step | 94% |

Over a long flight an unreferenced gyro costs 40-60 points; any sky compass gives most of it back (the 0.15 row scoring above the 0.05 row is noise). It does nothing about wind, which
pushes the helicopter without turning it. (A polynomial fit of the sun's movement from two readings is not needed: the sun moves about 15 degrees an hour, one degree in a few minutes, so a
straight line, rate x elapsed time, is enough, and two points could not fix a 2nd or 3rd degree curve anyway.)

**The consolidated fly over three kinds of ground** (`src/route/landscape.js`; `--landscape lake|hills`). Lake: a strait about a third of the map wide crosses the route, the maze is gone
there, the shore is sand, and every frame has fresh ripples and the odd sun glint, so there is nothing to remember out over the water. Hills: a heightfield 0.6 maze cells high, shaded by a low sun,
rock and snow tints; the helicopter holds its height above sea level (the view shrinks over hills; `--follow` would follow the terrain). 10 x 10 mazes, launched within 1 cell of A, wind 0.3, noisy
odometer, a gyro compass that drifts (0.03 rad per step) unless a sky compass is used; 24 flights per row, about +-10 points. "Consolidated" = funnel training + drift cone + tf-idf. Optic flow is switched off over water (the waves move).

| | countryside | hills | lake crossing | learning views |
|---|---|---|---|---|
| plain fly (whole-map training, gyro) | 58% | 67% | 38% | 5,331 |
| consolidated, gyro | 67% | 92% | 38% | 2,772 |
| + sky compass | 71% | 96% | 50% | 2,772 |
| + optic-flow odometer | **79%** | **100%** | 42% | 2,772 |

Training views halve. The consolidated fly with a sky compass and optic flow flies the hills perfectly (the shading and the shrinking view do not fool a fly that has a good heading and sees its own ground motion) and gets
about 80% over countryside. The lake is the real limit: all four rows are 38-50%. There is nothing to recognise over the water, so the fly has to dead-reckon across, and a noisy odometer plus wind that optic flow cannot see over waves
pushes it off before it sees the far shore. What a real helicopter would add: an air-speed sensor plus the sun compass for a wind estimate, a GPS-free "wind triangle", or a few floating landmarks. Not tried: stars, a moon, more than one lake or hill setting, hills with terrain-following,
mountains as such (steep slopes, occlusion, lighting that changes with the time of day).

**Wind memory and the wind triangle (the lake fixed).** Over land the optic-flow odometer shows how the ground really moves compared with what the fly commanded (it knows its own
air-speed), and the difference is the wind. `--wind-mem` (with `--flow-odo`) keeps a running estimate of that wind (a slow average, with a little noise), keeps it unchanged over water, where waves
give no usable flow, and steers a little into the wind (the crab angle, `asin` of the wind's sideways share) so the track over the ground follows the route's direction: the way birds and bees cross water. Same setup as the table above
(10 x 10, wind 0.3, noisy odometer, sky compass, consolidated), 24 flights per row:

| | countryside | hills | lake crossing |
|---|---|---|---|
| consolidated + sky compass + optic flow | 79% | 100% | 42% |
| + wind memory and crab angle | **92%** | **100%** | **87%** |
| lake + wind memory + climbing to 2.5 x height | | | 0% |
| lake + wind memory + casting | | | 54% |

The wind triangle is the single biggest gain since the sky compass: the lake goes from 42% to 87%, the countryside from 79% to 92%. Honest limits: the wind in the lab is exactly steady, and the estimate
is learned over land for as long as the fly likes; a real gusty, shifting wind would need the estimate to keep adapting, and a real estimate needs an air-speed sensor. Climbing to see the far shore failed completely (0%): the memories are of one height, so a climbing fly sees pictures it never learned
(it would have to practise at the higher height too, `--train-alts --banks`). Casting at the shore hurt (87% to 54%), as it did before.

**Gusts, a wider lake, climbing with practice.** Wind that wanders around its mean (`--gust 0.15`): the wind memory still helps (63% -> 87%; `--gust 0.3`: 63% -> 79%), a faster estimate (`--wind-alpha 0.2`) makes no clear difference. A lake 55% of the map wide (`--lake-width 0.55`): 67% without, 75% with the wind memory. Climbing over the lake with practice at the higher height (`--train-alts 1,2.5 --banks --climb 2.5`): 79%, against 87% flying low, at twice the training. Every experiment of this long-voyage work, with its setup, what we expected, what we got and why, is chapter 14 of the maze guide (maze-guide.html, "The lab notebook").

**In the wild, and navigating without GPS.** New simulator effects (`--blur`, `--jitter`, `--smudge`, `--speed`, `--weather rain|cloudy|autumn|wild`, `--landscape hills --relief`, `--fields mag|radio|both|terrain`, `--wind-sense`) and what they did to the best fly (10 x 10, launched from A, wind 0.3, 24 flights per row, about +-10 points): steeper hills, blur, vibration, dirt that is always on the lens, cloud shadows and autumn cost nothing to 4 points (92-100%); rain that arrives after training cost 25 (75%); an aeroplane at 3 x speed 67 (33%), and not because of blur: its turning circle is too wide for a maze route. Magnetic and radio fields read into the same memory instead of one row of the camera fixed the lake (75% -> 100%, and 54% -> 88% with no wind knowledge); a wind sense that follows gusts over water gave no clear gain. Research on how pilots, missiles, birds and sailors navigated without GPS, the interactive sky-dome, field-fingerprint, 3D-terrain, wild-camera and wind-triangle widgets, and the full expected / got / why for every experiment are chapters 14 to 16 of the maze guide.

Every interactive widget in the maze guide has a collapsible "How this works" block: what is happening, what each control is for and why it is there, and experiments of the form "if you do X you will see ...; if you do V you might see ...; what it means". Six more widgets were added for fun: familiarity against distance (the sparse code), two compasses in conflict (the head-direction ring), optic flow against height, the sun's clock, reading an island from a swell, and two radio towers.

Six mazes, one pass, fixed level: fog + filter 97%, night + filter + 16 frames 92%, wind 40% 79%, odometer 17
degrees off 97%. The maze app now flies the route once and calibrates by default. The guide has a widget
that flies the same fly in four different mazes.

**Roll, pitch, yaw and the fly's other senses** (six 6 x 6 mazes x 2 flies x 6 drops, one route pass, calibrated level;
reference 94%; about +-7 points). The camera is fixed to the helicopter, so `--tilt 20` (roll and pitch wandering
slowly, standard deviation in degrees) makes each sensor look along a rotated ray and see the ground where it hits
it (`RouteFlight.view`). `--tilt-comp --tilt-est 3` counter-rotates the camera by an attitude estimate that is
off by 3 degrees (a gyro, like the fly's halteres; 6 degrees is an ocelli-like horizon sensor). `--yaw-compass 0.3`
adds a heading error of 0.3 rad at every step that does not accumulate (a sky compass) and `--yaw-walk 0.03` an
error that random-walks (a gyro compass); both turn the map's north-up views by the wrong angle and skew the
odometer. `--flow-odo` gives the odometer optic flow: it sees the true ground motion, wind included.

| what is wrong | no help | with the sense |
|---|---|---|
| roll and pitch 5 / 10 / 20 degrees | 93% / 86% / 90% | 20 degrees, camera counter-rotated to 3 degrees: 90% |
| roll and pitch 35 degrees | 78% | counter-rotated to 3 degrees: **90%** |
| roll and pitch 45 degrees | 56% | |
| ...the route also practised in rough air | 79% (worse) | |
| compass off every step by 0.1 / 0.3 / 0.6 / 1.0 rad | 86% / 87% / 79% / 74% | |
| gyro compass drifting 0.01 / 0.03 / 0.08 / 0.15 rad per step | 94% / 89% / 89% / 75% | |
| wind of 40% of the flying speed | 69% | optic-flow odometer: 78% |
| wind of 70% of the flying speed | 33% | optic-flow odometer: 44% |
| tilt 10 + compass 0.1 + wind 40% | 69% | counter-rotated (3), compass 0.05, optic flow: 78% |
| tilt 35 + compass 0.6 + wind 70% | 14% | counter-rotated (4), compass 0.1, optic flow: 44% |

The fly barely notices tilts up to 20 degrees or compass errors of a few tenths of a radian: steering compares nine
looks through the same tilted camera, and the map belief gathers many looks. Sensors earn their keep only for big
errors. Practising in rough air made it worse. Swarm members can also look at different zoom levels
(`--scales 1,0.7,1.4`) and vote on the map (`--map-swarm`); `--map-sharp` sharpens the map belief.


Read the maze guide: **[maze-guide.html](maze-guide.html)** (https://nomsams.github.io/flyfy/maze-guide.html), a plain-language walk through the maze fly with a small fly you can run in the page. Try it in the browser: **[Fly Lab · Maze](maze/)** (`maze/`, same site). Build a maze, teach the route at
chosen heights (with learning flights), tap anywhere on the map to drop the fly, and change its
height mid-flight.

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
