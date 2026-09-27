// Is B really better than A, or is it luck? Both setups are trained on the same list of seeds, so
// runs are compared in pairs (seed 1 vs seed 1, ...), which cancels most of the run-to-run luck.
// "Clear" means the 95% confidence interval of the average difference does not include zero.

// Two-sided 95% critical values of Student's t, by degrees of freedom.
const T95 = [NaN, 12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13];

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };

export function compareRuns(a, b) {
  const n = Math.min(a.length, b.length);
  const diffs = Array.from({ length: n }, (_, i) => b[i] - a[i]);
  const d = mean(diffs), se = sd(diffs) / Math.sqrt(n);
  const t = T95[Math.min(n - 1, T95.length - 1)] || 1.96;
  const margin = n >= 2 ? t * se : Infinity;
  return {
    n, meanA: mean(a), meanB: mean(b), sdA: sd(a), sdB: sd(b),
    diff: d, margin, clear: n >= 2 && Math.abs(d) > margin, better: d > 0 ? 'B' : 'A',
  };
}

// One plain-language sentence for the result.
export function verdict(r, nameA = 'A', nameB = 'B') {
  const pts = (x) => `${Math.abs(x * 100).toFixed(1)} points`;
  if (r.n < 2) return 'Run at least 2 repeats to tell skill from luck.';
  if (Math.abs(r.diff) < 0.005 && r.margin < 0.01) return `Both did the same (${(r.meanA * 100).toFixed(0)}%) - this challenge doesn't separate them.`;
  if (r.clear) {
    const [win, lose] = r.better === 'B' ? [nameB, nameA] : [nameA, nameB];
    return `${win} is better than ${lose} by ${pts(r.diff)} on average, and that is more than luck explains (give or take ${pts(r.margin)}).`;
  }
  return `No clear difference: ${nameB} came out ${r.diff >= 0 ? 'ahead' : 'behind'} by ${pts(r.diff)} on average, but runs vary by about ${pts(r.margin)}, so this could just be luck. More repeats would tell.`;
}
