// Writes dataset/manifest.json so the app can list images on static hosting (GitHub Pages).
// Usage: node tools/make-manifest.mjs [datasetDir]   (default: ./dataset)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dataset'));
const ls = (d) => fs.readdirSync(path.join(root, d)).filter((f) => /.(jpe?g|png|gif|webp|bmp)$/i.test(f)).sort();
const manifest = { men: ls('men'), women: ls('women') };
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
console.log('manifest.json: men', manifest.men.length, 'women', manifest.women.length);
