// Draws a Wonderland maze with its route (and optionally flight tracks) to a PNG, for a look.
// Usage: node tools/route-map.mjs <out.png> [seed] [cells] [wobble] [variety]
import fs from 'node:fs';
import { makeWonderland } from '../src/route/terrain.js';
import { encodePNG } from './png.mjs';

export function mapImage(world, tracks = []) {
  const { W, H, rgb } = world, N = W * H, out = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(255 * rgb[c * N + i]);
  const dot = (x, y, col, r = 1) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && yy >= 0 && xx < W && yy < H) out.set(col, (yy * W + xx) * 3); } };
  const R = world.route;
  for (let i = 0; i < R.x.length; i += 2) dot(R.x[i], R.y[i], [255, 255, 255], 1);
  for (const { pts, col } of tracks) for (const [x, y] of pts) dot(x, y, col, 1);
  dot(world.start[0], world.start[1], [30, 200, 60], 5); dot(world.goal[0], world.goal[1], [220, 30, 30], 5);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('route-map.mjs')) {
  const [out, seed = 1, cells = 6, wobble = 0.6, variety = 0.7] = process.argv.slice(2);
  const w = makeWonderland({ seed: +seed, cells: +cells, wobble: +wobble, variety: +variety });
  fs.writeFileSync(out, encodePNG(w.W, w.H, mapImage(w)));
  console.log(`${w.W}x${w.H}, route ${Math.round(w.route.length)} px (${(w.route.length / w.cell).toFixed(1)} cells)`);
}
