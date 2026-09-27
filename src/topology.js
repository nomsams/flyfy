// "Use it or lose it": evolution shapes the wiring, not just the weights on it.
//
// Every so often, the weakest connections in the core (smallest |weight| in the current best
// brain) are moved to a new, randomly chosen source that neuron is not already listening to, and
// start again from zero weight. Strong wires stay put; wires that evolution never found a use for
// get another chance somewhere else. The number of wires never changes, so the brain stays
// exactly as sparse as it was built -- only *which* wires exist changes.

// brain: the Brain whose wiring (inIdx / recIdx) is changed in place. es: the ES whose theta (and
// Adam moments) hold that brain's weights. Returns how many wires were moved.
export function rewire(brain, es, frac, rng) {
  const { N, kIn, kRec, nIn, inIdx, recIdx } = brain;
  const theta = es.theta;
  const offIn = 0, offRec = N * kIn;
  const slots = [];
  for (let i = 0; i < N; i++) for (let k = 0; k < kIn; k++) slots.push([offIn + i * kIn + k, 0, i, k]);
  for (let i = 0; i < N; i++) for (let k = 0; k < kRec; k++) slots.push([offRec + i * kRec + k, 1, i, k]);
  slots.sort((a, b) => Math.abs(theta[a[0]]) - Math.abs(theta[b[0]]));
  const n = Math.round(frac * slots.length);
  for (let s = 0; s < n; s++) {
    const [p, kind, i, k] = slots[s];
    const idx = kind === 0 ? inIdx : recIdx, width = kind === 0 ? kIn : kRec, range = kind === 0 ? nIn : N;
    const used = new Set();
    for (let j = 0; j < width; j++) used.add(idx[i * width + j]);
    if (used.size >= range) continue;
    let src;
    do { src = Math.floor(rng() * range); } while (used.has(src));
    idx[i * width + k] = src;
    theta[p] = 0;
    es.m[p] = 0; es.v[p] = 0;
  }
  return n;
}
