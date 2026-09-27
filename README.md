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
   behind "more". A new fly starts with memory centre and edge boost (the measured wins) plus
   smart eye and mood chemical (what this branch is exploring).
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
| Memory centre | faces | Quick | 54.2% | 59.5% | **better by 5.3 pts** |
| Edge boost | faint stripes | Quick | 62.6% | 77.1% | **better by 14.5 pts** |
| Edge boost | faces | Quick | 54.2% | 55.5% | no clear difference (+1.3 ± 2.5) |
| Sharp centre | faces | Quick | 54.2% | 53.9% | no clear difference (-0.3 ± 3.7) |
| Sharp centre | find the spot | Quick | 59.9% | 72.0% | **better by 12.1 pts** |
| Smart eye | stripes | Quick | 82.9% | 82.9% | identical - a new fly's eye holds still until evolved (before that fix: **worse by 12.3 pts**) |
| Smart eye | find the spot | Evolve | 57.5% | 54.2% | no clear difference (-3.3 ± 8.9) |
| Smart eye (+ Sharp centre) | find the spot | Evolve | 59.5% | 65.3% | no clear difference (+5.8 ± 11.0) |
| Mood chemical | stripes | Evolve | 75.5% | 76.9% | no clear difference (+1.3 ± 6.0) |
| Self-tuning learning | faint stripes | Evolve | 55.4% | 54.1% | no clear difference (-1.3 ± 7.1) |
| Rewiring | stripes | Evolve | 75.5% | 75.1% | no clear difference (-0.4 ± 1.9) |
| Practise at many distances | faces | Quick | 54.2% | 53.7% | no clear difference (-0.5 ± 3.0) |
| Practise at many distances | stripes | Quick | 82.9% | 84.7% | no clear difference (+1.8 ± 7.9) |
| Step closer or back | find the spot | Evolve (60 gen.) | 56.1% | 56.9% | no clear difference (+0.8 ± 8.6) |
| Learn from surprises (+ memory centre) | faint stripes | Quick | 92.7% | 95.3% | **better by 2.5 pts** |
| Learn from surprises (+ memory centre) | stripes | Quick | 99.0% | 100.0% | **better by 1.0 pts** |
| Learn from surprises (+ memory centre) | faces | Quick | 59.5% | 55.1% | no clear difference (-4.4 ± 5.5) |

**In short:**
- **Clear wins, free to try:** the memory centre (+30 points on faint stripes, +5 on faces) and
  edge boost (+15 on faint stripes), and the sharp centre (+12) on find the spot. All three work
  with Quick learn.
- **Faces:** the memory centre is the one thing that clearly helps (54% -> 60%), once its Kenyon
  cells read the raw light sensors directly: reading the coarse eye-cell tiles instead, it made no
  clear difference (55%). More Kenyon cells (1,200) or more inputs per cell (12) didn't help
  further. Every other ability lands within about a point of the 54% baseline.
- **Learn from surprises:** real dopamine signals how much better or worse things went than
  expected. Learning in proportion to that surprise helps the clean tasks (faint stripes +2.5,
  stripes to 100%), but trailed on faces by 3-4 points in every variant tried (faster learning,
  4x longer training). The likely reason: some face labels are noisy (group photos), and a
  surprise-driven rule learns hardest from confident "mistakes" - exactly the mislabelled
  pictures. So it is off by default, and worth switching on for clean challenges.
- **Step closer or back:** evolution did not discover it in 60 generations (+0.8, not clear), even
  though simply putting the picture closer is worth +17.5 on find the spot. A new fly's legs start
  still, and the small random changes evolution tries barely move it within one picture, so the
  benefit is too faint to select for.
- **Smart eye:** at first it *hurt* Quick learn by 12 points - an untrained eye wandering at random
  made learning noisier - so a new fly's eye now holds still until evolution teaches it to move,
  which removed the harm entirely. On find the spot, 60 generations of evolution with smart eye
  *plus* sharp centre came out 6 points ahead (3 of 5 flies clearly better, best 73%), but runs
  vary too much to call it; smart eye alone was no better. So looking around plausibly pays off
  when the fly can also see sharply where it looks - not proven yet. (The first version of find
  the spot, with a smaller, finer patch, left every setup at chance and was made a bit coarser.)
- **Mood chemical, self-tuning learning, rewiring:** no clear difference after 30 generations on
  the tasks tried. They are cheap and switched off unless you want them; they may need longer
  evolution or harder tasks to matter.

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
| `data/faces32.bin` | the 1,000 bundled face photos as raw 32x32 grayscale (1 MB), so Node can test on them too |

Compare any two setups from the command line (runs in parallel, one process per core):

```bash
node tools/compare.mjs --task faint --method quick --seeds 5 --test memory
node tools/compare.mjs --task spot --method thorough --seeds 5 --test smartEye --with fovea
```

`--task` brightness | gratings | faint | spot | faces, `--method` quick | thorough, `--test` an
ability id (A = without, B = with; everything else off unless listed in `--with`), or raw
`--a` / `--b` JSON config overrides. `--gens`, `--pairs`, `--episodes` change the budget.

The eye cells are an abstraction of real fly LC neurons, not a copy of the connectome.
