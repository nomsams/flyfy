// Builds the bundled face data (data/faces32.bin + faces32c.bin + faces32.json) from a pack of the
// original photos made by tools/pack-faces.ps1 (32x32, BGR bytes, one or more crops).
//
//   faces32.bin   luminance, 32x32 bytes per photo
//   faces32c.bin  colour: red-green then blue-yellow opponent planes at 16x16 per photo (colour is
//                 stored at half resolution, the way JPEG does it), as round(v * 127 + 128)
//
// Usage: node tools/pack-faces.mjs <pack-dir> [crop=upper]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir, crop = 'upper'] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8').replace(/^﻿/, ''));
const S = meta.size, P = S * S, N = meta.count, CS = S / 2;
const raw = new Uint8Array(fs.readFileSync(path.join(dir, crop + '.rgb')));
const lum = new Uint8Array(N * P), chroma = new Uint8Array(N * 2 * CS * CS);
const q = (v) => Math.max(0, Math.min(255, Math.round(v * 127 + 128)));
for (let n = 0; n < N; n++) {
  const o = n * P * 3;
  const rg = new Float32Array(P), by = new Float32Array(P);
  for (let p = 0; p < P; p++) {
    const b = raw[o + 3 * p] / 255, g = raw[o + 3 * p + 1] / 255, r = raw[o + 3 * p + 2] / 255;
    lum[n * P + p] = Math.round(255 * (0.299 * r + 0.587 * g + 0.114 * b));
    rg[p] = r - g; by[p] = b - (r + g) / 2;
  }
  for (let c = 0; c < 2; c++) {
    const src = c ? by : rg, base = (n * 2 + c) * CS * CS;
    for (let y = 0; y < CS; y++) for (let x = 0; x < CS; x++) {
      const i = 2 * y * S + 2 * x;
      chroma[base + y * CS + x] = q((src[i] + src[i + 1] + src[i + S] + src[i + S + 1]) / 4);
    }
  }
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.writeFileSync(path.join(out, 'faces32.bin'), lum);
fs.writeFileSync(path.join(out, 'faces32c.bin'), chroma);
fs.writeFileSync(path.join(out, 'faces32.json'), JSON.stringify({
  size: S, chromaSize: CS, count: N, labels: meta.labels, classes: ['man', 'woman'],
  source: `man-woman-dataset originals, ${crop} crop (square, shifted up), 32x32 luminance + 16x16 colour opponents`,
}));
console.log(`${N} photos -> data/faces32.bin (${lum.length} B), data/faces32c.bin (${chroma.length} B)`);
