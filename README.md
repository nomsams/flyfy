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

## Rewards, penalties and pain (all editable, live)

The "Rewards, penalties & pain" panel lists every number the fly is scored on, with a
plain-language explanation. Changes apply on the next generation/episode while training
keeps running, and "Where the reward came from" shows a ledger of what the current fly
earned and lost per episode. Includes: correct / wrong / any-answer bonus / blank-screen
press / no answer in time / same-foot-again-and-again / time cost / steering hint, pain
strength and fade, learning speed and reward signal, reaction time and forced choice.

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
| **core** | 128 sparse leaky tanh neurons (10 inputs + 12 recurrent connections each) | by evolution |
| **fast synapses** | static LC cells -> the two feet | by reward and pain, during life |
| **feet** | 2 outputs; a press above 0.3 is an answer | - |
| **touch / pain inputs** | what each foot feels (pain input optional, off by default) | - |

The LC types are an abstraction of the real cell types, not the connectome.

## Saving resources

- The eye layer is fixed; the fast learner is one small weight matrix; no backprop.
- Tiny retina (14x20, ~5 deg per receptor, about a real fly's acuity); optional fine 28x40.
- Sparse wiring; a small custom world instead of a physics engine.
- The screen is only drawn while the tab is visible and the fly is set to play.

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
63-65% (also with two eyes or the fine retina), and the photo labels are noisy. Use
**Probe the eye** to see this ceiling for any setting.

What did not work (kept out of the app, findings from testing): feeding pain into the
recurrent core as a sensory input slowed evolution (available, off by default:
"Pain as brain input"); winner-take-all inhibition between the feet collapsed onto one foot.

## Layout

`src/config.js` all tunables · `world.js` trial world · `brain.js` LC layer, core, fast
synapses · `rollout.js` one step of brain+world+learning · `es.js`/`worker.js` evolution ·
`probe.js` front-end probe · `app.js`/`viz.js` UI.
