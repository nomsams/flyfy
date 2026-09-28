// A "Wonderland" maze to fly over. The ground is a patchwork of landscapes (meadow, a checkered rose
// garden, sand, lilac fields, ponds, flowers); on it stands a maze whose walls are not straight black
// lines but wobbly hedges, rose bushes, mushroom chains and stone walls of changing thickness and
// height, lit by a low sun so they cast shadows. The route is the maze's way through, from the
// entrance on the left to the exit on the right.
//
// variant > 0: the same maze and route, but slightly changed details - flowers elsewhere, walls bent
// a little differently and a touch thicker or thinner, fine ground texture shifted, the sun a bit
// lower or higher in another direction, a slight colour tint. For testing a route learned on variant 0.
//
// makeWonderland({ seed, cells, wobble, variety, variant }) returns
//   { W, H, cell, rgb: Float32Array(3*W*H) 0..1, height, route: { x, y, s } (resampled every 2 px,
//     s = distance along the route), start, goal }
// cells: maze size (cells x cells); wobble 0..1: how far walls bend; variety 0..1: how mixed the ground is.
import { mulberry32 } from '../rng.js';

const CELL = 64, MARGIN = 96;

// smooth value noise, fBm of a few octaves
function makeNoise(rng) {
  const P = 256, g = Float32Array.from({ length: P * P }, () => rng());
  const at = (i, j) => g[((j & (P - 1)) * P) + (i & (P - 1))];
  const s = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
  return (x, y, oct = 3) => { let v = 0, amp = 1, tot = 0, f = 1; for (let o = 0; o < oct; o++) { v += amp * n(x * f + o * 17.3, y * f - o * 9.1); tot += amp; amp *= 0.5; f *= 2; } return v / tot; };
}

// a perfect maze by depth-first search: open[c] bit 0..3 = right, down, left, up
function makeMaze(n, rng) {
  const open = new Uint8Array(n * n), seen = new Uint8Array(n * n), stack = [0];
  const D = [[1, 0, 0, 2], [0, 1, 1, 3], [-1, 0, 2, 0], [0, -1, 3, 1]];
  seen[0] = 1;
  while (stack.length) {
    const c = stack[stack.length - 1], x = c % n, y = (c / n) | 0;
    const nb = D.filter(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < n && ny < n && !seen[ny * n + nx]; });
    if (!nb.length) { stack.pop(); continue; }
    const [dx, dy, b, ob] = nb[Math.floor(rng() * nb.length)], nc = (y + dy) * n + x + dx;
    open[c] |= 1 << b; open[nc] |= 1 << ob; seen[nc] = 1; stack.push(nc);
  }
  return open;
}

function solve(n, open, from, to) {
  const prev = new Int32Array(n * n).fill(-1), q = [from];
  prev[from] = from;
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (q.length) {
    const c = q.shift(); if (c === to) break;
    const x = c % n, y = (c / n) | 0;
    D.forEach(([dx, dy], b) => { if (open[c] & (1 << b)) { const nc = (y + dy) * n + x + dx; if (prev[nc] < 0) { prev[nc] = c; q.push(nc); } } });
  }
  const path = [];
  for (let c = to; ; c = prev[c]) { path.unshift(c); if (c === from) break; }
  return path;
}

const MATERIALS = {
  hedge: { col: [0.16, 0.36, 0.14], h: 1.0, dots: null },
  roses: { col: [0.2, 0.34, 0.16], h: 0.8, dots: [0.85, 0.12, 0.2] },
  mushrooms: { col: [0.78, 0.16, 0.14], h: 1.3, dots: [0.97, 0.95, 0.9], beads: true },
  stone: { col: [0.55, 0.5, 0.45], h: 0.6, dots: null },
  cards: { col: [0.93, 0.9, 0.86], h: 0.7, dots: [0.75, 0.1, 0.12] },
};

export function makeWonderland({ seed = 1, cells = 6, wobble = 0.6, variety = 0.7, variant = 0 } = {}) {
  const rng = mulberry32(seed), noise = makeNoise(rng), noise2 = makeNoise(mulberry32(seed * 7 + 3));
  const vr = mulberry32(seed * 1009 + 7 + variant * 7919), V = variant ? 1 : 0; // the details that change between variants
  const W = cells * CELL + 2 * MARGIN, H = W, N = W * H;
  const rgb = new Float32Array(3 * N), height = new Float32Array(N), mat = new Int8Array(N).fill(-1);

  // ---- ground: blend of landscapes by low-frequency noise
  const lands = [
    (x, y) => [0.36, 0.58, 0.25],                                                               // meadow
    (x, y) => { const u = (x + y) * 0.7071, v = (x - y) * 0.7071; return ((Math.floor(u / 22) + Math.floor(v / 22)) & 1) ? [0.96, 0.8, 0.85] : [0.97, 0.95, 0.93]; }, // checkered rose garden
    (x, y) => [0.86, 0.76, 0.52],                                                               // sand
    (x, y) => [0.62, 0.52, 0.8],                                                                // lilac field
    (x, y) => [0.52, 0.66, 0.3],                                                                // young grass
  ];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, a = noise(x / 170, y / 170, 2), b = noise2(x / 130, y / 130, 2);
    // pick two landscapes and blend softly; variety scales how many kinds appear
    const k = Math.min(lands.length - 1, Math.floor(a * (1 + variety * (lands.length - 1)) * 0.999));
    const k2 = Math.min(lands.length - 1, k + 1), t = Math.max(0, Math.min(1, (b - 0.45) * 4 * variety));
    const c1 = lands[k](x, y), c2 = lands[k2](x, y), tex = (noise(x / 6 + V * variant * 13.7, y / 6 - V * variant * 5.3, 2) - 0.5) * 0.14;
    let r = c1[0] + (c2[0] - c1[0]) * t + tex, g = c1[1] + (c2[1] - c1[1]) * t + tex, bl = c1[2] + (c2[2] - c1[2]) * t + tex;
    const pond = noise2(x / 90 + 40, y / 90 - 20, 3);
    if (variety > 0.3 && pond > 0.7) { const d = Math.min(1, (pond - 0.7) * 12); r += (0.22 - r) * d; g += (0.42 - g) * d; bl += (0.72 - bl) * d; }
    rgb[i] = r; rgb[N + i] = g; rgb[2 * N + i] = bl;
  }
  // flowers: bright speckles
  const flowers = [[0.95, 0.85, 0.2], [0.95, 0.35, 0.55], [0.95, 0.95, 0.95], [0.55, 0.3, 0.85]];
  for (let k = 0; k < (W * H) / 180 * variety; k++) {
    const x = Math.floor(vr() * W), y = Math.floor(vr() * H), c = flowers[Math.floor(vr() * flowers.length)];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && Math.abs(dx) + Math.abs(dy) < 2) { const i = yy * W + xx; rgb[i] = c[0]; rgb[N + i] = c[1]; rgb[2 * N + i] = c[2]; } }
  }

  // ---- maze walls: every closed side of a cell becomes a wobbly wall of some material
  const open = makeMaze(cells, rng);
  const entryRow = Math.floor(rng() * cells), exitRow = Math.floor(rng() * cells);
  const names = Object.keys(MATERIALS);
  const walls = [];
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    const c = cy * cells + cx, x0 = MARGIN + cx * CELL, y0 = MARGIN + cy * CELL;
    if (!(open[c] & 1) && !(cx === cells - 1 && cy === exitRow)) walls.push([x0 + CELL, y0, x0 + CELL, y0 + CELL]);
    if (!(open[c] & 2)) walls.push([x0, y0 + CELL, x0 + CELL, y0 + CELL]);
    if (cx === 0 && cy !== entryRow) walls.push([x0, y0, x0, y0 + CELL]);
    if (cy === 0) walls.push([x0, y0, x0 + CELL, y0]);
  }
  const stamp = (cx, cy, rad, h, m) => {
    const r2 = rad * rad;
    for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 > r2) continue;
      const hh = h * Math.sqrt(1 - d2 / r2) * 16; // rounded top, height in "pixels"
      const i = y * W + x; if (hh > height[i]) { height[i] = hh; mat[i] = m; }
    }
  };
  for (const [ax, ay, bx, by] of walls) {
    const m = Math.floor(rng() * names.length), M = MATERIALS[names[m]], len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len, ny = (bx - ax) / len, off = rng() * 100, hScale = M.h * (0.7 + 0.6 * rng());
    const voff = vr() * 100, vthick = 1 + V * (vr() - 0.5) * 0.3; // this variant's own small changes to the wall
    for (let t = 0; t <= len; t += M.beads ? 7 : 1.5) {
      const u = t / len, env = Math.sin(Math.PI * u) ** 0.5; // bends die out at the corners, so walls still meet
      const bend = wobble * CELL * 0.2 * (noise(off + u * 2.2, off) - 0.5) * 2 * env + V * CELL * 0.06 * (noise2(voff + u * 2.5, voff) - 0.5) * 2 * env;
      const x = ax + (bx - ax) * u + nx * bend, y = ay + (by - ay) * u + ny * bend;
      const thick = vthick * CELL * (M.beads ? 0.11 : 0.07 + 0.06 * noise(off + u * 3, off + 5));
      stamp(x, y, thick, hScale * (0.8 + 0.4 * noise(off + u * 4, off - 3)), m);
    }
  }
  // ---- colour the walls, then light everything from a low north-west sun with cast shadows
  const sa = Math.atan2(-0.6, -0.6) + V * (vr() - 0.5) * 0.6, se = 0.53 + V * (vr() - 0.5) * 0.12;
  const sun = [Math.cos(sa) * Math.sqrt(1 - se * se), Math.sin(sa) * Math.sqrt(1 - se * se), se]; // direction to the sun (x, y, up)
  const tint = [0, 1, 2].map(() => 1 + V * (vr() - 0.5) * 0.06);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (mat[i] >= 0) {
      const M = MATERIALS[names[mat[i]]]; let c = M.col;
      if (M.dots && noise2(x / 3.5, y / 3.5, 1) > 0.72) c = M.dots;
      rgb[i] = c[0]; rgb[N + i] = c[1]; rgb[2 * N + i] = c[2];
    }
    const hx = (height[y * W + Math.min(W - 1, x + 1)] - height[y * W + Math.max(0, x - 1)]) / 2;
    const hy = (height[Math.min(H - 1, y + 1) * W + x] - height[Math.max(0, y - 1) * W + x]) / 2;
    const nl = Math.hypot(hx, hy, 1), lambert = Math.max(0, (-hx * sun[0] - hy * sun[1] + sun[2]) / nl) / sun[2];
    let shade = 0.55 + 0.45 * Math.min(1.3, lambert);
    for (let k = 1; k <= 18; k++) { // shadow: is anything taller between here and the sun?
      const sx = Math.round(x + sun[0] * k * 1.4), sy = Math.round(y + sun[1] * k * 1.4);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) break;
      if (height[sy * W + sx] > height[i] + k * 1.4 * (sun[2] / Math.hypot(sun[0], sun[1]))) { shade *= 0.62; break; }
    }
    for (let c = 0; c < 3; c++) rgb[c * N + i] = Math.max(0, Math.min(1, rgb[c * N + i] * shade * tint[c]));
  }

  // ---- the route: through the maze, from outside the entrance to outside the exit, smoothed
  const cellsPath = solve(cells, open, entryRow * cells, exitRow * cells + cells - 1);
  let pts = [[MARGIN - 0.7 * CELL, MARGIN + (entryRow + 0.5) * CELL]];
  for (const c of cellsPath) pts.push([MARGIN + (c % cells + 0.5) * CELL, MARGIN + (((c / cells) | 0) + 0.5) * CELL]);
  pts.push([MARGIN + (cells + 0.7) * CELL, MARGIN + (exitRow + 0.5) * CELL]);
  for (let it = 0; it < 3; it++) { // Chaikin corner cutting: turns become curves
    const q = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    q.push(pts[pts.length - 1]); pts = q;
  }
  const rx = [], ry = [], rs = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t < L; t += 2) { rx.push(a[0] + (b[0] - a[0]) * t / L); ry.push(a[1] + (b[1] - a[1]) * t / L); rs.push(acc + t); }
    acc += L;
  }
  const route = { x: Float32Array.from(rx), y: Float32Array.from(ry), s: Float32Array.from(rs), length: acc };
  return { W, H, cell: CELL, rgb, height, route, start: [rx[0], ry[0]], goal: [rx[rx.length - 1], ry[ry.length - 1]], cells };
}
