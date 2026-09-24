# flyfy

A tiny fly brain that learns to classify images, entirely in the browser.
No Python, no Colab, no physics engine, no npm install.

There is no body. A fixed **eye** (or two) looks at a screen; an **LC-family visual
layer** feeds a small recurrent core, which drives two "feet": **left foot = class 0
("man")**, **right foot = class 1 ("woman")**. A trial is: blank screen, the image
expands into view (a "loom"), and the fly answers by pressing a foot, or times out.

## Run

```bash
node server.js          # then open http://localhost:4180
npm test                # simulation + learning tests (Node 18+)
```

Faces come from `dataset/{men,women}`: a bundled sample of 500 images per class,
centre-cropped and downscaled to 64x64 (the app shrinks them to 32x32 and the fly only
ever sees ~14x20 receptors, so nothing useful is lost). The server prefers a full
dataset if you have one: set `DATASET_DIR` (a folder containing `men/` and `women/`),
or put it in `../man-woman-dataset/data`. The procedural tasks (dark vs bright,
stripes) need no data.

## What is in the brain

| part | what | trained? |
|---|---|---|
| **LPLC2, LC4** | looming / outward-motion detectors (Hassenstein-Reichardt correlators on ON/OFF signals). Fire when the image expands into view; ~20x quieter on a static image | no (fixed) |
| **LC11, LC_ON, LUM** | small dark object, small bright object, coarse luminance. Carry the image content | no (fixed) |
| **core** | 128 sparse leaky tanh neurons (10 inputs + 12 recurrent connections each) | yes |
| **feet** | 2 outputs, press above 0.3, release below 0 | yes |

The LC types are an abstraction of the real cell types, not the connectome.
Defaults: 234 neurons, 3,202 trainable parameters.

## Saving resources

- The eye layer is fixed, so only ~3k parameters are trained; no backprop.
- Tiny retina (14x20, ~5 deg per receptor, about a real fly's acuity); optional fine 28x40.
- Sparse wiring; a small custom world instead of a physics engine.
- Training is evolution strategies (antithetic sampling, rank shaping, Adam) in a
  pool of Web Workers, ~35k steps/s on 3 workers.
- The screen is only drawn while the tab is visible; autosave to IndexedDB.

## Eyes

- 1 eye or 2. With 2, `overlap` = both see the whole screen with a small disparity;
  `split` = each eye sees its own side of the screen (visual fields overlap 40 deg).
- `standard` (14x20) or `fine` (28x40, ~3x slower). A real fly has ~800 receptors per eye.

## Honest results

- dark vs bright: 100% in ~40 generations.
- stripes: ~70-73% after 100 generations (still improving).
- faces: the fixed eye is the limit. A linear probe on the static LC features gets
  ~63% held-out on 32x32 faces (standard eye), ~64-66% with 2 eyes and/or the fine eye.
  Expect training to land around there, not near 100%. Use **Probe the eye** to check.

## Layout

`src/config.js` all tunables · `world.js` trial world · `brain.js` LC layer + core ·
`es.js` optimiser · `worker.js`/`rollout.js` parallel evaluation · `probe.js` front-end
probe · `app.js`/`viz.js` UI.
