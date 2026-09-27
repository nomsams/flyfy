// Node-side helpers shared by the command-line tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StimulusSet, unpackFaces } from '../src/stimuli.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// The bundled faces, from data/faces32.bin (+ colour in faces32c.bin), no JPEG decoding needed.
export function loadFacesNode(cap = Infinity) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'faces32.json'), 'utf8'));
  const bytes = new Uint8Array(fs.readFileSync(path.join(ROOT, 'data', 'faces32.bin')));
  const cpath = path.join(ROOT, 'data', 'faces32c.bin');
  const chroma = meta.chromaSize && fs.existsSync(cpath) ? new Uint8Array(fs.readFileSync(cpath)) : null;
  return unpackFaces(bytes, meta.labels, cap, chroma, meta.chromaSize);
}

// { train, test } for any task.
export function taskSets(task) {
  if (task === 'faces') return loadFacesNode();
  return { train: new StimulusSet(task), test: new StimulusSet(task) };
}
