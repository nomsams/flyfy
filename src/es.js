// Evolution strategy (OpenAI-ES style): antithetic sampling, centered-rank
// fitness shaping, Adam on the estimated gradient. No backprop -- which is
// the point: the recurrent core is trained without unrolling it through
// time, and every candidate is an independent job for a Web Worker.

import { mulberry32, gauss } from './rng.js';

export class ES {
  constructor(theta0, opts) {
    this.theta = Float32Array.from(theta0);
    this.n = theta0.length;
    this.o = opts;
    this.rng = mulberry32(opts.seed ?? 1);
    this.m = new Float32Array(this.n);
    this.v = new Float32Array(this.n);
    this.t = 0;
    this.eps = null;
  }

  // Returns 2*pairs candidate parameter vectors ([+e0, -e0, +e1, -e1, ...]).
  ask() {
    const { pairs, sigma } = this.o;
    this.eps = [];
    const cands = [];
    for (let i = 0; i < pairs; i++) {
      const e = new Float32Array(this.n);
      for (let j = 0; j < this.n; j++) e[j] = gauss(this.rng);
      this.eps.push(e);
      const plus = new Float32Array(this.n), minus = new Float32Array(this.n);
      for (let j = 0; j < this.n; j++) {
        plus[j] = this.theta[j] + sigma * e[j];
        minus[j] = this.theta[j] - sigma * e[j];
      }
      cands.push(plus, minus);
    }
    return cands;
  }

  tell(fitness) {
    const { pairs, sigma, lr, weightDecay } = this.o;
    const total = fitness.length;
    // centered ranks in [-0.5, 0.5]
    const order = Array.from({ length: total }, (_, i) => i).sort((a, b) => fitness[a] - fitness[b]);
    const u = new Float32Array(total);
    order.forEach((idx, rank) => { u[idx] = rank / (total - 1) - 0.5; });

    const g = new Float32Array(this.n);
    for (let i = 0; i < pairs; i++) {
      const w = u[2 * i] - u[2 * i + 1];
      const e = this.eps[i];
      for (let j = 0; j < this.n; j++) g[j] += w * e[j];
    }
    const scale = 1 / (2 * pairs * sigma);
    this.t++;
    const b1 = 0.9, b2 = 0.999, tiny = 1e-8;
    for (let j = 0; j < this.n; j++) {
      const gj = g[j] * scale - weightDecay * this.theta[j];
      this.m[j] = b1 * this.m[j] + (1 - b1) * gj;
      this.v[j] = b2 * this.v[j] + (1 - b2) * gj * gj;
      const mh = this.m[j] / (1 - Math.pow(b1, this.t));
      const vh = this.v[j] / (1 - Math.pow(b2, this.t));
      this.theta[j] += lr * mh / (Math.sqrt(vh) + tiny);
    }
  }
}
