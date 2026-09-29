// A hedge maze in the countryside to fly over, in the spirit of the Queen's garden in Alice in
// Wonderland: a maze of hedges (tall and low, some with roses, some old stone walls and topiary)
// standing on a mowed lawn, inside a landscape of fields (meadow, wheat, ploughed soil, green crop
// rows, an orchard) with hedgerows between them, a gravel path around the garden, roads, houses and
// barns, trees and perhaps a small pond. Everything has a height, lit by a low sun, so hedges, trees
// and buildings cast shadows. The route is the maze's way through, from the entrance on the left to
// the exit on the right; it is never drawn - the fly only ever sees the landscape.
//
// variant > 0: the same maze, fields, roads and houses, but slightly changed details - wildflowers
// elsewhere, hedges bent a little differently and a touch thicker or thinner, trees shifted a bit,
// fine texture changed, the sun a bit lower or higher in another direction, a slight colour tint.
//
// makeWonderland({ seed, cells, wobble, variety, variant }) returns
//   { W, H, cell, rgb: Float32Array(3*W*H) 0..1, height, route: { x, y, s, length }, start, goal, cells, margin }
// cells: maze size (cells x cells); wobble 0..1: how far hedges bend; variety 0..1: how varied the countryside is.
import { mulberry32 } from '../rng.js';

const CELL = 64, MARGIN = 160;

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

// maze wall materials: colour, height, optional flowers (dots), bead-like (topiary balls)
const WALLS = [
  { name: 'hedge', col: [0.15, 0.33, 0.12], h: 1.0, w: 0.30 },
  { name: 'tall hedge', col: [0.11, 0.27, 0.10], h: 1.4, w: 0.22 },
  { name: 'rose hedge', col: [0.17, 0.34, 0.13], h: 0.9, dots: [0.78, 0.1, 0.14], w: 0.15 },
  { name: 'stone wall', col: [0.56, 0.53, 0.47], h: 0.6, w: 0.18 },
  { name: 'topiary', col: [0.2, 0.4, 0.16], h: 1.2, beads: true, w: 0.15 },
];
// field types for the countryside
const FIELDS = [
  { name: 'meadow', base: [0.4, 0.57, 0.24], rows: 0 },
  { name: 'pasture', base: [0.47, 0.62, 0.28], rows: 0 },
  { name: 'wheat', base: [0.78, 0.68, 0.36], rows: [0.7, 0.6, 0.3], period: 5 },
  { name: 'ploughed', base: [0.46, 0.36, 0.25], rows: [0.38, 0.29, 0.2], period: 4 },
  { name: 'crop rows', base: [0.42, 0.36, 0.25], rows: [0.3, 0.52, 0.2], period: 6 },
  { name: 'orchard', base: [0.45, 0.58, 0.26], rows: 0, orchard: true },
];
const ROOFS = [[0.6, 0.3, 0.22], [0.52, 0.26, 0.2], [0.34, 0.36, 0.4], [0.72, 0.68, 0.6]];

export function makeWonderland({ seed = 1, cells = 6, wobble = 0.6, variety = 0.7, variant = 0 } = {}) {
  const rng = mulberry32(seed), noise = makeNoise(rng), noise2 = makeNoise(mulberry32(seed * 7 + 3));
  const vr = mulberry32(seed * 1009 + 7 + variant * 7919), V = variant ? 1 : 0; // the details that change between variants
  const W = cells * CELL + 2 * MARGIN, H = W, N = W * H;
  const rgb = new Float32Array(3 * N), height = new Float32Array(N), mat = new Int8Array(N).fill(-1);
  const put = (i, c) => { rgb[i] = c[0]; rgb[N + i] = c[1]; rgb[2 * N + i] = c[2]; };
  const x0m = MARGIN, x1m = MARGIN + cells * CELL; // the garden (maze) square
  const inGarden = (x, y, pad = 0) => x > x0m - pad && x < x1m + pad && y > x0m - pad && y < x1m + pad;

  // ---- fields: Voronoi patches of land use over the countryside (the garden itself is a lawn)
  const nSites = Math.round(10 + variety * 14), sites = [];
  for (let k = 0; k < nSites; k++) {
    let x, y; do { x = rng() * W; y = rng() * H; } while (inGarden(x, y, CELL * 0.5));
    const kinds = Math.max(2, Math.round(2 + variety * (FIELDS.length - 2)));
    sites.push({ x, y, f: FIELDS[Math.floor(rng() * kinds)], ang: rng() * Math.PI, tone: 0.92 + rng() * 0.16 });
  }
  // ---- roads: a gravel path around the garden, and roads from it to the map's edges
  const ring = CELL * 0.55, pathW = 7, roadW = 9;
  const roads = [];
  const nRoads = 1 + Math.round(variety * 2);
  for (let k = 0; k < nRoads; k++) { // each road: a gentle curve from the path ring to an edge
    const side = Math.floor(rng() * 4), t = 0.2 + rng() * 0.6;
    const ax = side === 0 ? x0m - ring : side === 1 ? x1m + ring : x0m + t * (x1m - x0m), ay = side === 2 ? x0m - ring : side === 3 ? x1m + ring : x0m + t * (x1m - x0m);
    const bx = side === 0 ? 0 : side === 1 ? W : ax + (rng() - 0.5) * CELL * 2, by = side === 2 ? 0 : side === 3 ? H : ay + (rng() - 0.5) * CELL * 2;
    const mx = (ax + bx) / 2 + (rng() - 0.5) * CELL, my = (ay + by) / 2 + (rng() - 0.5) * CELL;
    const pts = [];
    for (let s = 0; s <= 1.0001; s += 0.01) { const u = 1 - s; pts.push([u * u * ax + 2 * u * s * mx + s * s * bx, u * u * ay + 2 * u * s * my + s * s * by]); }
    roads.push(pts);
  }
  // distance to the nearest road, filled in only near the roads (far away it stays "far"): drawn outward
  // from the roads' own points instead of measuring every pixel against every point (150x faster)
  const nearRoad = new Float32Array(N).fill(1e9), REACH = 24;
  for (const pts of roads) for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1], L = Math.hypot(bx - ax, by - ay) || 1;
    for (let t = 0; t <= L; t += 1) {
      const px = ax + ((bx - ax) * t) / L, py = ay + ((by - ay) * t) / L;
      for (let y = Math.max(0, Math.floor(py - REACH)); y <= Math.min(H - 1, Math.ceil(py + REACH)); y++) for (let x = Math.max(0, Math.floor(px - REACH)); x <= Math.min(W - 1, Math.ceil(px + REACH)); x++) {
        const d = Math.hypot(x - px, y - py), i = y * W + x; if (d < nearRoad[i]) nearRoad[i] = d;
      }
    }
  }
  const distToRoads = (x, y) => nearRoad[Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))];
  const ringDist = (x, y) => { // distance to the square path around the garden
    const dx = Math.max(x0m - ring - x, 0, x - (x1m + ring)), dy = Math.max(x0m - ring - y, 0, y - (x1m + ring));
    const outside = Math.hypot(dx, dy);
    if (outside > 0) return outside;
    return Math.min(x - (x0m - ring), (x1m + ring) - x, y - (x0m - ring), (x1m + ring) - y);
  };

  // ---- paint the ground
  const roadDist = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, tex = (noise(x / 5 + V * variant * 13.7, y / 5 - V * variant * 5.3, 2) - 0.5) * 0.1;
    let c;
    if (inGarden(x, y, CELL * 0.35)) { // the Queen's lawn, mowed in stripes
      const stripe = (Math.floor((x - x0m) / 16) & 1) ? 1.06 : 0.95;
      c = [0.33 * stripe, 0.55 * stripe, 0.22 * stripe];
    } else {
      let b1 = Infinity, b2 = Infinity, s1 = null;
      for (const s of sites) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < b1) { b2 = b1; b1 = d; s1 = s; } else if (d < b2) b2 = d; }
      const f = s1.f, edge = Math.sqrt(b2) - Math.sqrt(b1);
      c = f.base.map((v) => v * s1.tone);
      if (f.rows) { const u = x * Math.cos(s1.ang) + y * Math.sin(s1.ang); if (Math.sin((2 * Math.PI * u) / f.period) > 0.2) c = f.rows.map((v) => v * s1.tone); }
      const mix = noise2(x / 60, y / 60, 2); // big soft patches of darker and lighter growth
      c = c.map((v) => v * (0.9 + 0.2 * mix));
      if (edge < 3.5) { c = [0.16, 0.3, 0.12]; height[i] = Math.max(height[i], 5 * (1 - edge / 3.5)); } // hedgerow between fields
    }
    const rd = Math.min(distToRoads(x, y), 1e9), rg = ringDist(x, y);
    roadDist[i] = rd;
    if (rd < roadW / 2) { c = rd < 0.8 && ((Math.floor((x + y) / 7) & 1) === 0) ? [0.82, 0.8, 0.72] : [0.35, 0.35, 0.36]; height[i] = 0; } // asphalt with a dashed line
    else if (rd < roadW / 2 + 1.5) c = [0.5, 0.49, 0.45]; // road edge
    else if (rg < pathW / 2) { c = [0.7, 0.64, 0.52]; height[i] = 0; } // gravel path round the garden
    put(i, c.map((v) => v + tex));
  }
  // a small pond, sometimes
  if (variety > 0.4 && rng() < 0.7) {
    let px, py; do { px = rng() * W; py = rng() * H; } while (inGarden(px, py, CELL));
    const pr = 14 + rng() * 16;
    for (let y = Math.max(0, Math.floor(py - pr - 4)); y < Math.min(H, py + pr + 4); y++) for (let x = Math.max(0, Math.floor(px - pr - 4)); x < Math.min(W, px + pr + 4); x++) {
      const d = Math.hypot(x - px, (y - py) * 1.3) + (noise(x / 9, y / 9, 2) - 0.5) * 8;
      if (d < pr) put(y * W + x, [0.2, 0.33, 0.33].map((v) => v + (noise2(x / 4, y / 4, 1) - 0.5) * 0.04));
      else if (d < pr + 3) put(y * W + x, [0.4, 0.44, 0.3]);
    }
  }
  // wildflowers in the meadows: small, sparse, soft colours
  const flowers = [[0.93, 0.88, 0.55], [0.92, 0.92, 0.9], [0.7, 0.5, 0.75], [0.85, 0.45, 0.35]];
  for (let k = 0; k < (N / 400) * variety; k++) {
    const x = Math.floor(vr() * W), y = Math.floor(vr() * H), i = y * W + x;
    if (inGarden(x, y, CELL * 0.35) || roadDist[i] < roadW) continue;
    put(i, flowers[Math.floor(vr() * flowers.length)]);
  }

  // ---- things with height: buildings, trees (stamped into height and colour)
  const stampDisc = (cx, cy, rad, h, col, hi = 1.12) => {
    for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++) {
      const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (rad * rad); if (d2 > 1) continue;
      const i = y * W + x, hh = h * Math.sqrt(1 - d2);
      if (hh > height[i]) { height[i] = hh; const lump = 1 + (noise(x / 2.5, y / 2.5, 1) - 0.5) * 0.25; put(i, col.map((v) => v * lump * (1 + (hi - 1) * (1 - d2)))); }
    }
  };
  const buildings = [];
  const nB = Math.round(4 + variety * 10);
  for (let k = 0, tries = 0; k < nB && tries < 400; tries++) {
    // near a road or the path, outside the garden, not on the road
    const pts = roads[Math.floor(rng() * roads.length)], [rx, ry] = pts[Math.floor(rng() * pts.length)];
    const ang = Math.atan2(pts[Math.min(pts.length - 1, 5)][1] - pts[0][1], pts[Math.min(pts.length - 1, 5)][0] - pts[0][0]) + (rng() < 0.5 ? 0 : Math.PI / 2);
    const side = (rng() < 0.5 ? -1 : 1) * (roadW + 10 + rng() * 10);
    const cx = rx - Math.sin(ang) * side, cy = ry + Math.cos(ang) * side, L = 16 + rng() * 22, Wd = 11 + rng() * 10;
    if (cx < 10 || cy < 10 || cx > W - 10 || cy > H - 10 || inGarden(cx, cy, CELL * 0.8)) continue;
    if (buildings.some((b) => Math.hypot(b.cx - cx, b.cy - cy) < 30)) continue;
    buildings.push({ cx, cy, L, Wd, ang, roof: ROOFS[Math.floor(rng() * ROOFS.length)], h: 9 + rng() * 9 }); k++;
  }
  for (const b of buildings) {
    const ca = Math.cos(b.ang), sa = Math.sin(b.ang), R = Math.hypot(b.L, b.Wd) / 2 + 1;
    for (let y = Math.max(0, Math.floor(b.cy - R)); y <= Math.min(H - 1, Math.ceil(b.cy + R)); y++) for (let x = Math.max(0, Math.floor(b.cx - R)); x <= Math.min(W - 1, Math.ceil(b.cx + R)); x++) {
      const u = (x - b.cx) * ca + (y - b.cy) * sa, v = -(x - b.cx) * sa + (y - b.cy) * ca;
      if (Math.abs(u) > b.L / 2 || Math.abs(v) > b.Wd / 2) continue;
      const i = y * W + x, ridge = 1 - Math.abs(v) / (b.Wd / 2); // a gable roof: highest along its ridge
      height[i] = b.h * (0.75 + 0.25 * ridge);
      const shadeSide = v < 0 ? 1.12 : 0.82, tile = (Math.floor((u + 100) / 2.5) & 1) ? 1 : 0.94;
      put(i, b.roof.map((c) => c * shadeSide * tile));
    }
  }
  // trees: groves and scattered trees in the countryside, a few along the path
  const treeCols = [[0.14, 0.3, 0.11], [0.2, 0.36, 0.14], [0.12, 0.26, 0.12], [0.26, 0.4, 0.16]];
  const nGroves = Math.round(3 + variety * 5);
  for (let g = 0; g < nGroves; g++) {
    let gx, gy; do { gx = rng() * W; gy = rng() * H; } while (inGarden(gx, gy, CELL * 0.8));
    const n = 4 + Math.floor(rng() * 10);
    for (let k = 0; k < n; k++) {
      const tx = gx + (rng() - 0.5) * 50 + V * (vr() - 0.5) * 3, ty = gy + (rng() - 0.5) * 50 + V * (vr() - 0.5) * 3, i = Math.round(ty) * W + Math.round(tx);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H || roadDist[i] < roadW || inGarden(tx, ty, CELL * 0.6)) continue;
      stampDisc(tx, ty, 6 + rng() * 6, 12 + rng() * 8, treeCols[Math.floor(rng() * treeCols.length)]);
    }
  }
  for (const s of sites) if (s.f.orchard) { // orchards: trees in rows
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
      const tx = s.x + a * 16, ty = s.y + b * 16, i = Math.round(ty) * W + Math.round(tx);
      if (tx < 0 || ty < 0 || tx >= W || ty >= H || roadDist[i] < roadW || inGarden(tx, ty, CELL * 0.6)) continue;
      stampDisc(tx, ty, 4.5, 9, [0.24, 0.42, 0.16]);
    }
  }

  // ---- the maze: every closed side of a cell becomes a hedge (or wall) that bends a little
  const open = makeMaze(cells, rng);
  const entryRow = Math.floor(rng() * cells), exitRow = Math.floor(rng() * cells);
  const walls = [];
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    const c = cy * cells + cx, x0 = MARGIN + cx * CELL, y0 = MARGIN + cy * CELL;
    if (!(open[c] & 1) && !(cx === cells - 1 && cy === exitRow)) walls.push([x0 + CELL, y0, x0 + CELL, y0 + CELL]);
    if (!(open[c] & 2)) walls.push([x0, y0 + CELL, x0 + CELL, y0 + CELL]);
    if (cx === 0 && cy !== entryRow) walls.push([x0, y0, x0, y0 + CELL]);
    if (cy === 0) walls.push([x0, y0, x0 + CELL, y0]);
  }
  const pickWall = () => { let u = rng(); for (let k = 0; k < WALLS.length; k++) { u -= WALLS[k].w; if (u <= 0) return k; } return 0; };
  const stamp = (cx, cy, rad, h, m) => {
    const r2 = rad * rad;
    for (let y = Math.max(0, Math.floor(cy - rad)); y <= Math.min(H - 1, Math.ceil(cy + rad)); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x <= Math.min(W - 1, Math.ceil(cx + rad)); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 > r2) continue;
      const hh = h * Math.sqrt(1 - d2 / r2) * 16;
      const i = y * W + x; if (hh > height[i]) { height[i] = hh; mat[i] = m; }
    }
  };
  for (const [ax, ay, bx, by] of walls) {
    const m = pickWall(), M = WALLS[m], len = Math.hypot(bx - ax, by - ay);
    const nx = -(by - ay) / len, ny = (bx - ax) / len, off = rng() * 100, hScale = M.h * (0.8 + 0.4 * rng());
    const voff = vr() * 100, vthick = 1 + V * (vr() - 0.5) * 0.3;
    for (let t = 0; t <= len; t += M.beads ? 8 : 1.5) {
      const u = t / len, env = Math.sin(Math.PI * u) ** 0.5; // bends die out at the corners, so hedges still meet
      const bend = wobble * CELL * 0.2 * (noise(off + u * 2.2, off) - 0.5) * 2 * env + V * CELL * 0.06 * (noise2(voff + u * 2.5, voff) - 0.5) * 2 * env;
      const x = ax + (bx - ax) * u + nx * bend, y = ay + (by - ay) * u + ny * bend;
      const thick = vthick * CELL * (M.beads ? 0.12 : 0.08 + 0.05 * noise(off + u * 3, off + 5));
      stamp(x, y, thick, hScale * (0.85 + 0.3 * noise(off + u * 4, off - 3)), m);
    }
  }

  // ---- colour the hedges, then light everything from a low sun with cast shadows
  const sa = Math.atan2(-0.6, -0.6) + V * (vr() - 0.5) * 0.6, se = 0.53 + V * (vr() - 0.5) * 0.12;
  const sun = [Math.cos(sa) * Math.sqrt(1 - se * se), Math.sin(sa) * Math.sqrt(1 - se * se), se];
  const tint = [0, 1, 2].map(() => 1 + V * (vr() - 0.5) * 0.06);
  const slope = sun[2] / Math.hypot(sun[0], sun[1]); // how fast a ray toward the sun rises per pixel
  const out = new Float32Array(3 * N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (mat[i] >= 0) {
      const M = WALLS[mat[i]], leaf = 1 + (noise2(x / 2.2, y / 2.2, 1) - 0.5) * 0.35; // leafy texture
      let c = M.col.map((v) => v * leaf);
      if (M.dots && noise2(x / 3.5 + 50, y / 3.5, 1) > 0.74) c = M.dots;
      put(i, c);
    }
    const hx = (height[y * W + Math.min(W - 1, x + 1)] - height[y * W + Math.max(0, x - 1)]) / 2;
    const hy = (height[Math.min(H - 1, y + 1) * W + x] - height[Math.max(0, y - 1) * W + x]) / 2;
    const nl = Math.hypot(hx, hy, 1), lambert = Math.max(0, (-hx * sun[0] - hy * sun[1] + sun[2]) / nl) / sun[2];
    let shade = 0.6 + 0.4 * Math.min(1.3, lambert);
    for (let k = 1; k <= 11; k++) { // shadow: is anything taller between here and the sun? (every 2.8 px, up to 31)
      const sx = Math.round(x + sun[0] * k * 2.8), sy = Math.round(y + sun[1] * k * 2.8);
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) break;
      if (height[sy * W + sx] > height[i] + k * 2.8 * slope) { shade *= 0.64; break; }
    }
    for (let c = 0; c < 3; c++) out[c * N + i] = Math.max(0, Math.min(1, rgb[c * N + i] * shade * tint[c]));
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
  return { W, H, cell: CELL, rgb: out, height, route, start: [rx[0], ry[0]], goal: [rx[rx.length - 1], ry[ry.length - 1]], cells, margin: MARGIN };
}
