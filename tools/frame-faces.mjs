// Frames each photo on the face, using skin colour. Reads a 128x128 letterboxed pack of the original
// photos (tools/pack-faces.ps1 -Size 128 style: full.rgb, BGR) and writes a 32x32 "skin" crop pack
// in the same format as the other crops (skin.rgb + counts), so tools/data-headroom.mjs and
// tools/pack-faces.mjs can use it.
//
// Face finding, the classic way: skin colour occupies a compact region of YCbCr colour space
// (Cb 77-127, Cr 133-173). Skin pixels are found, the largest connected skin patch is taken as the
// face (after a light clean-up), and a square around it - a bit larger than the patch, reaching up
// for hair - becomes the crop. Photos with no clear skin patch fall back to the "upper" crop.
//
// Usage: node tools/frame-faces.mjs <pack128-dir> <out-pack-dir>
import fs from 'node:fs';
import path from 'node:path';

const [inDir, outDir] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(inDir, 'meta.json'), 'utf8').replace(/^﻿/, ''));
const S = meta.size, N = meta.count, OUT = 32;
const raw = new Uint8Array(fs.readFileSync(path.join(inDir, 'full.rgb')));

function skinMask(o) {
  const m = new Uint8Array(S * S);
  for (let p = 0; p < S * S; p++) {
    const b = raw[o + 3 * p], g = raw[o + 3 * p + 1], r = raw[o + 3 * p + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
    m[p] = y > 40 && cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173 ? 1 : 0;
  }
  // clean-up: keep a pixel if most of its 3x3 neighbourhood is skin (removes speckle, fills small holes)
  const c = new Uint8Array(S * S);
  for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += m[(y + dy) * S + x + dx];
    c[y * S + x] = n >= 5 ? 1 : 0;
  }
  return c;
}

// bounding box of the largest 4-connected skin patch
function largestPatch(m) {
  const seen = new Uint8Array(S * S), stack = [];
  let best = null;
  for (let p0 = 0; p0 < S * S; p0++) {
    if (!m[p0] || seen[p0]) continue;
    let n = 0, x0 = S, x1 = 0, y0 = S, y1 = 0;
    stack.push(p0); seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop(), x = p % S, y = (p / S) | 0;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - S, p + S]) {
        if (q < 0 || q >= S * S || seen[q] || !m[q] || Math.abs((q % S) - x) > 1) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    if (!best || n > best.n) best = { n, x0, x1, y0, y1 };
  }
  return best;
}

// area-averaged resampling of the square (sx, sy, side) of photo n into OUT x OUT BGR bytes
function crop(o, sx, sy, side, dst, d0) {
  const f = side / OUT;
  for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
    const acc = [0, 0, 0];
    let n = 0;
    for (let yy = Math.floor(sy + y * f); yy < Math.ceil(sy + (y + 1) * f); yy++) {
      for (let xx = Math.floor(sx + x * f); xx < Math.ceil(sx + (x + 1) * f); xx++) {
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) { n++; continue; } // outside = black
        for (let c = 0; c < 3; c++) acc[c] += raw[o + 3 * (yy * S + xx) + c];
        n++;
      }
    }
    for (let c = 0; c < 3; c++) dst[d0 + 3 * (y * OUT + x) + c] = Math.round(acc[c] / Math.max(1, n));
  }
}

// where the photo itself sits inside the letterboxed 128 square (non-black rows/columns)
function photoBox(o) {
  let x0 = S, x1 = -1, y0 = S, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const p = o + 3 * (y * S + x);
    if (raw[p] + raw[p + 1] + raw[p + 2] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? { x0: 0, x1: S - 1, y0: 0, y1: S - 1 } : { x0, x1, y0, y1 };
}

const out = new Uint8Array(N * OUT * OUT * 3);
let framed = 0;
for (let n = 0; n < N; n++) {
  const o = n * S * S * 3, pb = photoBox(o), pw = pb.x1 - pb.x0 + 1, ph = pb.y1 - pb.y0 + 1;
  const patch = largestPatch(skinMask(o));
  let sx, sy, side;
  if (patch && patch.n >= 60 && patch.n < 0.7 * pw * ph) {
    const bw = patch.x1 - patch.x0 + 1, bh = patch.y1 - patch.y0 + 1;
    side = Math.max(24, Math.min(Math.max(pw, ph), 1.3 * Math.max(bw, bh)));
    const cx = (patch.x0 + patch.x1) / 2, cy = (patch.y0 + patch.y1) / 2 - 0.08 * side; // a little up: hair
    sx = cx - side / 2; sy = cy - side / 2;
    framed++;
  } else { // the "upper" crop: the largest square of the photo, shifted up
    side = Math.min(pw, ph); sx = pb.x0 + (pw - side) / 2; sy = pb.y0 + (ph - side) * 0.2;
  }
  crop(o, sx, sy, side, out, n * OUT * OUT * 3);
}
fs.writeFileSync(path.join(outDir, 'skin.rgb'), out);
console.log(`${framed} of ${N} photos framed on a skin patch (${((100 * framed) / N).toFixed(0)}%), the rest use the upper crop`);
