// Aligns every photo on a learned "average face" (congealing), and writes a 32x32 "aligned" crop pack
// in the same format as the other crops, for tools/data-headroom.mjs and tools/pack-faces.mjs.
//
// The idea, fly-style: keep a memory of what a face looks like on average, and for each picture turn
// the gaze (shift) and step nearer or back (zoom) until the picture best matches that memory. Then
// rebuild the memory from the aligned pictures and repeat, so it sharpens. No man/woman labels are
// used anywhere, so the same alignment is fair on exam photos too.
//
// Matching uses a small 20x20 view of brightness and edge strength (each normalised), scored by
// correlation with the template. The search: shifts up to +-30% of the base crop in steps of 5%,
// zooms from 0.5x to 1x of the base crop (the "upper" crop: the largest square, shifted up).
//
// Usage: node tools/align-faces.mjs <pack128-dir> <out-pack-dir> [iterations=3] [zooms=1,0.85,0.72,0.6,0.5] [name=aligned]
import fs from 'node:fs';
import path from 'node:path';

const [inDir, outDir] = process.argv.slice(2);
const ITERS = +(process.argv[4] || 3);
const meta = JSON.parse(fs.readFileSync(path.join(inDir, 'meta.json'), 'utf8').replace(/^﻿/, ''));
const S = meta.size, N = meta.count, OUT = 32, V = 20;
const raw = new Uint8Array(fs.readFileSync(path.join(inDir, 'full.rgb')));

// area-averaged resampling of the square (sx, sy, side) of photo n into an OUT x OUT image (per channel)
function crop(o, sx, sy, side, out, chans = 3, grey = false) {
  const f = side / out, res = new Float32Array(out * out * (grey ? 1 : chans));
  for (let y = 0; y < out; y++) for (let x = 0; x < out; x++) {
    const acc = [0, 0, 0];
    let n = 0;
    const y0 = Math.floor(sy + y * f), y1 = Math.max(y0 + 1, Math.ceil(sy + (y + 1) * f));
    const x0 = Math.floor(sx + x * f), x1 = Math.max(x0 + 1, Math.ceil(sx + (x + 1) * f));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      n++;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue; // outside = black
      const p = o + 3 * (yy * S + xx);
      acc[0] += raw[p]; acc[1] += raw[p + 1]; acc[2] += raw[p + 2];
    }
    const i = y * out + x;
    if (grey) res[i] = (0.114 * acc[0] + 0.587 * acc[1] + 0.299 * acc[2]) / n / 255;
    else for (let c = 0; c < 3; c++) res[i * 3 + c] = acc[c] / n;
  }
  return res;
}

// integral image of each photo's brightness (built on demand, kept for the photo being searched), so
// any box average costs four look-ups instead of summing every pixel in it
let intFor = -1;
const INT = new Float64Array((S + 1) * (S + 1));
function integral(o) {
  if (intFor === o) return;
  intFor = o;
  for (let y = 0; y < S; y++) {
    let row = 0;
    for (let x = 0; x < S; x++) {
      const p = o + 3 * (y * S + x);
      row += (0.114 * raw[p] + 0.587 * raw[p + 1] + 0.299 * raw[p + 2]) / 255;
      INT[(y + 1) * (S + 1) + x + 1] = INT[y * (S + 1) + x + 1] + row;
    }
  }
}
function greyCrop(o, sx, sy, side, out) {
  integral(o);
  const f = side / out, res = new Float32Array(out * out), W = S + 1;
  const cl = (v) => (v < 0 ? 0 : v > S ? S : v);
  for (let y = 0; y < out; y++) {
    const y0 = Math.floor(sy + y * f), y1 = Math.max(y0 + 1, Math.ceil(sy + (y + 1) * f)), a0 = cl(y0), a1 = cl(y1);
    for (let x = 0; x < out; x++) {
      const x0 = Math.floor(sx + x * f), x1 = Math.max(x0 + 1, Math.ceil(sx + (x + 1) * f)), b0 = cl(x0), b1 = cl(x1);
      const sum = INT[a1 * W + b1] - INT[a0 * W + b1] - INT[a1 * W + b0] + INT[a0 * W + b0];
      res[y * out + x] = sum / ((x1 - x0) * (y1 - y0)); // outside the photo counts as black
    }
  }
  return res;
}

// the matching view: brightness and edge strength, each normalised to mean 0, spread 1
function view(o, sx, sy, side) {
  const g = greyCrop(o, sx, sy, side, V), e = new Float32Array(V * V);
  for (let y = 1; y < V - 1; y++) for (let x = 1; x < V - 1; x++) {
    e[y * V + x] = Math.hypot(g[y * V + x + 1] - g[y * V + x - 1], g[(y + 1) * V + x] - g[(y - 1) * V + x]);
  }
  const norm = (a) => { let m = 0, s = 0; for (const v of a) m += v / a.length; for (const v of a) s += (v - m) ** 2 / a.length; s = Math.sqrt(s) + 1e-6; return a.map((v) => (v - m) / s); };
  const out = new Float32Array(2 * V * V);
  out.set(norm(g)); out.set(norm(e), V * V);
  return out;
}

// where the photo sits inside the letterboxed square (non-black rows/columns), and the base crop
function base(o) {
  let x0 = S, x1 = -1, y0 = S, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = o + 3 * (y * S + x);
    if (raw[p] + raw[p + 1] + raw[p + 2] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = S - 1; y1 = S - 1; }
  const pw = x1 - x0 + 1, ph = y1 - y0 + 1, side = Math.min(pw, ph);
  return { cx: x0 + pw / 2, cy: y0 + (ph - side) * 0.2 + side / 2, side };
}

const bases = Array.from({ length: N }, (_, n) => base(n * S * S * 3));
const ZOOMS = (process.argv[5] || "1,0.85,0.72,0.6,0.5").split(",").map(Number), SHIFTS = [-0.3, -0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
const pose = bases.map(() => ({ dx: 0, dy: 0, z: 1 }));
const boxOf = (n, p) => { const b = bases[n], side = b.side * p.z; return [b.cx + p.dx * b.side - side / 2, b.cy + p.dy * b.side - side / 2, side]; };

let tmpl = null;
for (let it = 0; it <= ITERS; it++) {
  // the memory: the average matching view at the current poses
  tmpl = new Float32Array(2 * V * V);
  for (let n = 0; n < N; n++) { const v = view(n * S * S * 3, ...boxOf(n, pose[n])); for (let j = 0; j < v.length; j++) tmpl[j] += v[j] / N; }
  if (it === ITERS) break;
  let moved = 0, score = 0;
  for (let n = 0; n < N; n++) {
    const o = n * S * S * 3;
    let best = -Infinity, bp = pose[n];
    const tryPose = (p) => {
      if (Math.abs(p.dx) > 0.5 * (1 - p.z) + 0.15 || Math.abs(p.dy) > 0.5 * (1 - p.z) + 0.15) return; // stay near the photo
      const v = view(o, ...boxOf(n, p));
      let c = 0;
      for (let j = 0; j < v.length; j++) c += v[j] * tmpl[j];
      if (c > best) { best = c; bp = p; }
    };
    // coarse (every 10%), then the neighbours of the best one (5%)
    for (const z of ZOOMS) for (const dy of SHIFTS) for (const dx of SHIFTS) if (Math.round(dx * 20) % 2 === 0 && Math.round(dy * 20) % 2 === 0) tryPose({ dx, dy, z });
    const c0 = bp;
    for (const z of ZOOMS.filter((z) => Math.abs(z - c0.z) < 0.2)) for (const ddy of [-0.05, 0, 0.05]) for (const ddx of [-0.05, 0, 0.05]) {
      tryPose({ dx: +(c0.dx + ddx).toFixed(2), dy: +(c0.dy + ddy).toFixed(2), z });
    }
    if (bp.dx !== pose[n].dx || bp.dy !== pose[n].dy || bp.z !== pose[n].z) moved++;
    pose[n] = bp; score += best / N;
  }
  console.log(`iteration ${it + 1}: ${moved} photos moved, mean match ${score.toFixed(1)}`);
}
const zoomHist = {};
for (const p of pose) zoomHist[p.z] = (zoomHist[p.z] || 0) + 1;
console.log('zooms chosen:', JSON.stringify(zoomHist));

const out = new Uint8Array(N * OUT * OUT * 3);
for (let n = 0; n < N; n++) {
  const c = crop(n * S * S * 3, ...boxOf(n, pose[n]), OUT);
  for (let j = 0; j < c.length; j++) out[n * OUT * OUT * 3 + j] = Math.round(c[j]);
}
fs.writeFileSync(path.join(outDir, (process.argv[6] || 'aligned') + '.rgb'), out);
fs.writeFileSync(path.join(outDir, 'aligned-poses.json'), JSON.stringify(pose));
// a picture of the learned average face (PGM, grey), for a look
const t = Uint8Array.from(tmpl.subarray(0, V * V), (v) => Math.max(0, Math.min(255, 128 + 40 * v)));
fs.writeFileSync(path.join(outDir, 'aligned-template.pgm'), Buffer.concat([Buffer.from(`P5 ${V} ${V} 255\n`), Buffer.from(t)]));
console.log('wrote aligned.rgb');
