# flyfy

A tiny fly brain that learns to classify images, entirely in the browser.
No Python, no Colab, no physics engine, no npm install.

There is no body. A fixed **eye** (or two) looks at a screen; an **LC-family visual
layer** feeds a small recurrent core, which drives two "feet": **left foot = class 0
("man")**, **right foot = class 1 ("woman")**. A trial: blank screen, the image
expands into view (a "loom"), and the fly answers by pressing a foot.

## Run

**Online (GitHub Pages):** https://nomsams.github.io/flyfy/ - a fully static site (no server,
no build step, relative URLs only). Faces load from the bundled `dataset/manifest.json`.

**Locally:**

```bash
node server.js          # then open http://localhost:4180
npm test                # simulation + "learns from pain alone" tests (Node 18+)
```

Nothing starts by itself: press **Learn by pain (fast)** or **Evolve the core (slow)**.

Faces come from `dataset/{men,women}`: a bundled sample of 500 images per class,
centre-cropped and downscaled to 64x64 (the app shrinks them to 32x32 and the fly only
ever sees ~14x20 receptors, so nothing useful is lost). The server prefers a full
dataset if you have one: set `DATASET_DIR` (a folder containing `men/` and `women/`),
or put it in `../man-woman-dataset/data`. Regenerate the static listing after changing
the images with `node tools/make-manifest.mjs`.

## How the fly learns

**Learn by pain (fast).** One fly plays trial after trial. Each answer changes the *fast
synapses* from the eye's static LC cells onto the two feet:

- **reward** (correct answer) strengthens the foot that was right;
- **pain** (wrong answer) weakens the foot that fired and strengthens the other one;
- pain from pressing a foot on a blank screen (or before looking) weakens just that foot.

That is reward-modulated Hebbian learning, the same shape as how real flies learn from
punishment (dopamine-gated plasticity), with no backprop and no population. It runs in
about 20 ms per episode on one thread and needs no workers.

**Evolve the core (slow).** Evolution strategies breed the recurrent core in a pool of Web
Workers. Slower, but it can learn *when* to answer and shapes the core. Both can be
combined: evolution runs with the fast learning switched on inside every episode.

## Rewards, penalties, pain and the eye (all editable, live)

The "Rewards, penalties, pain & the eye" panel lists every number the fly is scored,
timed and sensed by, with a plain-language explanation. Changes apply on the next
generation/episode while training keeps running, and "Where the reward came from" shows
a ledger of what the current fly earned and lost per episode. Includes: correct / wrong /
any-answer bonus / blank-screen press / no answer in time / same-foot-again-and-again /
time cost / steering hint, pain strength and fade, learning speed and reward signal,
reaction time, forced choice, and "the loop trick" below.

Forced choice (default): if the fly has not pressed by 0.5 s after the image appears, the
stronger foot is pressed for it, so it can never win by staying silent. Set it to 0 for
free response.

Accuracy shown is **correct out of all images**, not out of answered ones: earlier a fly
that answered only the images it was sure of looked 100% accurate.

## What is in the brain

| part | what | trained? |
|---|---|---|
| **LPLC2, LC4** | looming / outward-motion detectors (Hassenstein-Reichardt correlators on ON/OFF signals). Fire when the image expands into view; ~20x quieter on a static image | no (fixed) |
| **LC11, LC_ON, LUM** | small dark object, small bright object, coarse luminance. Carry the image content | no (fixed) |
| **core** | 128 sparse leaky tanh neurons (10 inputs + 12 recurrent connections, own leak rate each) | by evolution |
| **fast synapses** | static LC cells -> the two feet | by reward and pain, during life |
| **feet** | 2 outputs; a press above 0.3 is an answer | - |
| **touch / pain inputs** | what each foot feels (pain input optional, off by default) | - |

The LC types are an abstraction of the real cell types, not the connectome.

## Saving resources

- The eye layer is fixed; the fast learner is one small weight matrix; no backprop.
- Tiny retina (14x20, ~5 deg per receptor, about a real fly's acuity); optional fine 28x40.
- Sparse wiring; a small custom world instead of a physics engine.
- The screen is only drawn while the tab is visible and the fly is set to play.

## "The loop trick": jittered-look ensembling

The idea: instead of classifying a photo from one look, shift it slightly, downsample it,
classify, repeat several times, and sum the raw scores before deciding. It works here because
a fixed low-resolution eye throws away sub-pixel detail on every single look, but which detail
survives depends on exactly where the image lands on the receptor grid -- shift it a little and
a different slice of high-frequency detail aliases into the low-res grid. Summed across looks,
that averages out.

Two places it is implemented:

- **Probe the eye** does this literally, the way the idea is usually described: a linear
  classifier is trained once on centred looks, then scored on held-out images two ways --
  a single centred look, and 10 jittered sub-receptor looks with their scores summed. On faint,
  noisy stripes this took a probe from 70% to 84% held-out; see the results table below for
  more. It costs nothing during training, only a few extra (cheap) evaluation passes.
- **Eye jitter (microsaccades)** does the "shift" part live, every simulation frame, the way a
  real fly's fixational eye movements might: while an image is on screen for up to 60 frames,
  each frame samples the retina at a slightly different sub-receptor offset instead of the exact
  same pixels every time, echoing real insects' compensatory head/eye micro-movements.
  **Decide from a running average** is the matching "sum before deciding" half: it averages the
  foot signal over recent frames instead of betting everything on one frame's instantaneous
  read (a genuine exponential decay/leaky integrator, not a flat average). Both are off by
  default (`0` / `1`) and live in the settings panel.

The jitter steps around a small circle rather than picking a random offset each frame: with
only a handful of frames to a decision, a random walk can land on the same side twice and never
sample the other side, where an even circular spacing guarantees full coverage in the fewest
possible looks (confirmed on the probe: 4 evenly-spaced looks already recover most of the gain
that 10 random ones used to).

Honestly reported: turning those two on together did **not** clearly help the live, playing fly
in my tests. The window between the reaction-time delay and the forced-choice deadline is short
(about 0.2 s, a handful of frames), which is not enough for a running average to settle before a
decision is forced either way, and a single jittered frame right at decision time can still be
an unlucky one. The trick reliably pays off where it is evaluating a fixed classifier over many
looks with no deadline (**Probe the eye**), not yet where the decision itself is fast and time
-pressured. It is also worth saying what was *already* true before any of this: the core was
already a trained recurrent network (each neuron's state already carries forward a leaky memory
of previous frames, so it never saw a frame "in a vacuum"), and a press already fires the instant
its threshold is crossed, any frame after the reaction-time delay -- both already do part of what
"summing over time" and "early exit" are asking for.

One more small change in the same spirit: each core neuron's leak rate (how much of every step
is "new" vs "carried over") used to be one fixed number shared by all 128 neurons. It is now
evolved per neuron, so evolution can give some neurons a short memory and others a long one if
that turns out to help. Measured on stripes it landed at about the same place as the shared
constant (~91-93% either way) -- a wash on this task, not a clear win -- but it costs 128 extra
parameters (about 4% more) and next to nothing to run, so it stays: harmless, and available for
whatever task might actually need it.

## Eyes

- 1 eye or 2. With 2, `overlap` = both see the whole screen with a small disparity;
  `split` = each eye sees its own side of the screen (visual fields overlap 40 deg).
- `standard` (14x20) or `fine` (28x40, ~3x slower). A real fly has ~800 receptors per eye.

## Honest results (a fly that learns only from reward and pain, no evolution)

| task | result |
|---|---|
| dark vs bright | ~100% within the first 10 episodes |
| horizontal vs vertical stripes | ~80-88% within ~30 episodes |
| faint noisy stripes (hard) | ~65-75% |
| man vs woman photos | ~55-62% on held-out photos (varies run to run; a few hundred to a thousand episodes) |

Faces are limited by the fixed eye: a linear probe on its static LC features tops out around
63-65% on a single look (also with two eyes or the fine retina), and the photo labels are
noisy. Use **Probe the eye** to see this ceiling for any setting, and how far "the loop trick"
(above) closes the gap: +14 points on faint stripes (70% -> 84%), +4-6 on stripes already near
the ceiling.

What did not work (kept out of the app, findings from testing): feeding pain into the
recurrent core as a sensory input slowed evolution (available, off by default:
"Pain as brain input"); winner-take-all inhibition between the feet collapsed onto one foot.

## Layout

`src/config.js` all tunables · `world.js` trial world · `brain.js` LC layer, core, fast
synapses · `rollout.js` one step of brain+world+learning · `es.js`/`worker.js` evolution ·
`probe.js` front-end probe · `app.js`/`viz.js` UI.
