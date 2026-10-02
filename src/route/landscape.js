// Other ground to fly over than the countryside: a lake to cross, or hills.
//
// applyLandscape(world, 'lake' | 'hills', { relief, hold, seed }) changes a world made by makeWonderland (before a RouteFlight is built on it).
//
// lake: a band across the middle of the map (about a third of the width, its edge wavy) is water: the maze, fields and houses there are gone, with a pale
//   sandy shore on the land side. Over water there is almost nothing to remember: the colour drifts a little over the map, and every frame the sensors see
//   fresh ripples and the odd glint of the sun (RouteFlight.view reads world.water). A fly that only knows "this looks familiar" has nothing to go on out there
//   and has to dead-reckon (odometer + compass) until it sees the far shore.
//
// hills: a smooth heightfield (world.relief, up to `relief` maze cells high). The ground is shaded by a low sun from the north-west, tinted toward bare rock and
//   snow with height. The helicopter either holds its height above sea level (hold: true), so the ground rises toward it and the view shrinks over hills (the
//   picture's scale changes from place to place), or follows the terrain with a radar altimeter (hold: false), when only the shading and colours change.
import { mulberry32 } from '../rng.js';

function makeNoise(rng) {
  const P = 128, g = Float32Array.from({ length: P * P }, () => rng());
  const at = (i, j) => g[((j & (P - 1)) * P) + (i & (P - 1))], s = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j); return (at(i, j) + (at(i + 1, j) - at(i, j)) * fx) * (1 - fy) + (at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx) * fy; };
  return (x, y, oct = 3) => { let v = 0, a = 1, t = 0, f = 1; for (let o = 0; o < oct; o++) { v += a * n(x * f + o * 17.3, y * f - o * 9.1); t += a; a *= 0.5; f *= 2; } return v / t; };
}

// ground height (maze cells) at (x, y) pixels
export function reliefAt(rel, x, y) {
  const fx = Math.max(0, Math.min(rel.nx - 1.001, x / rel.step)), fy = Math.max(0, Math.min(rel.ny - 1.001, y / rel.step)), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, h = rel.h, nx = rel.nx;
  return (h[j * nx + i] * (1 - tx) + h[j * nx + i + 1] * tx) * (1 - ty) + (h[(j + 1) * nx + i] * (1 - tx) + h[(j + 1) * nx + i + 1] * tx) * ty;
}

export function applyLandscape(world, kind, { relief = 0.6, hold = true, seed = 1, lake = 0.3 } = {}) {
  if (!kind || kind === 'countryside') return world;
  const { W, H, cell, margin, cells, rgb } = world, N = W * H, noise = makeNoise(mulberry32(seed * 7919 + 101));
  if (kind === 'lake') {
    const water = new Uint8Array(N), x0 = margin + (0.5 - lake / 2) * cells * cell, x1 = margin + (0.5 + lake / 2) * cells * cell, shore = 0.35 * cell;
    for (let y = 0; y < H; y++) {
      const wob = (noise(y / 90, 3) - 0.5) * 1.4 * cell;
      for (let x = 0; x < W; x++) {
        const i = y * W + x, a = x0 + wob, b = x1 + wob * 0.7;
        if (x > a && x < b) {
          water[i] = 1; const v = 0.92 + 0.16 * noise(x / 150, y / 150 + 40, 2);
          rgb[i] = 0.1 * v; rgb[N + i] = 0.24 * v; rgb[2 * N + i] = 0.36 * v;
        } else if ((x <= a && x > a - shore) || (x >= b && x < b + shore)) {
          const t = 0.8 + 0.2 * noise(x / 6, y / 6, 1); rgb[i] = 0.78 * t; rgb[N + i] = 0.72 * t; rgb[2 * N + i] = 0.52 * t; // a sandy shore
        }
      }
    }
    world.water = water;
  } else if (kind === 'hills') {
    const step = 8, nx = Math.ceil(W / step) + 2, ny = Math.ceil(H / step) + 2, h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const v = noise((i * step) / (3 * cell), (j * step) / (3 * cell) + 11, 3); // 0.2 .. 0.8, mostly
      h[j * nx + i] = Math.max(0, Math.min(1, (v - 0.36) * 1.7)) * relief;
    }
    const rel = { step, nx, ny, h, amp: relief };
    const sun = [-0.7, -0.7]; // from the north-west (map x right, y down)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, e = Math.min(1, reliefAt(rel, x, y) / Math.max(1e-6, relief));
      const gx = (reliefAt(rel, x + 6, y) - reliefAt(rel, x - 6, y)) / (12 / cell), gy = (reliefAt(rel, x, y + 6) - reliefAt(rel, x, y - 6)) / (12 / cell); // slope, cells per cell
      const shade = Math.max(0.35, Math.min(1.5, 1 + (-(gx * sun[0] + gy * sun[1])) * 2.4 / Math.max(0.2, relief)));
      const rock = [0.46, 0.42, 0.4], snow = [0.93, 0.95, 0.97], kr = 0.55 * e, ks = Math.max(0, (e - 0.9) / 0.1);
      for (let c = 0; c < 3; c++) { let v = rgb[c * N + i] * (1 - kr) + rock[c] * kr; v = v * (1 - ks) + snow[c] * ks; rgb[c * N + i] = Math.max(0, Math.min(1, v * shade)); }
    }
    world.relief = rel; world.holdAlt = hold;
  } else throw new Error('unknown landscape ' + kind);
  return world;
}
