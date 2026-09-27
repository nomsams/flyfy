// Canvas drawing: the scene, what the eye sees, the neurons, and the charts. Colours come from the
// page's CSS variables (readTheme), so everything follows light/dark mode. All cheap: small
// canvases, no per-frame allocation to speak of.

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    bg: v('--panel2'), panel: v('--panel'), line: v('--line'), fg: v('--fg'), mut: v('--mut'),
    accent: v('--accent'), green: v('--green'), red: v('--red'), amber: v('--amber'), pink: v('--pink'),
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
  };
}

const FONT = '12px system-ui, -apple-system, Segoe UI, sans-serif';

export function makeImageCanvas(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const d = ctx.createImageData(size, size), P = size * size, colour = img.length >= 3 * P;
  const px = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < P; i++) {
    const L = img[i];
    if (colour) {
      // back from luminance + opponent signals to red/green/blue (solving the three definitions)
      const rg = img[P + i], by = img[2 * P + i], G = L - 0.356 * rg - 0.114 * by;
      d.data[4 * i] = px(G + rg); d.data[4 * i + 1] = px(G); d.data[4 * i + 2] = px(by + G + rg / 2);
    } else d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = px(L);
    d.data[4 * i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

// Front view: the screen (with its expanding onset), where the eye is looking, the head, two feet.
// answers: the task's two answers, e.g. ['man', 'woman'] -> left foot, right foot.
export function drawScene(ctx, W, H, world, imgCanvas, flash, answers, T) {
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  // Drawn in degrees of the fly's view (k pixels per degree): the picture at the size it really
  // appears (smaller when further away), and the fly's field of view as a dashed box that moves with
  // its gaze -- so you can see at a glance whether the picture fits in view or overflows it.
  const cx = W / 2, sy = 104, k = 2.1;
  const sc = world.cfg.screen, e = world.cfg.eye;
  const s = world.scale();
  ctx.save();
  ctx.beginPath(); ctx.rect(8, 6, W - 16, 196); ctx.clip();
  const gx = cx - world.gazeAz * k, gy = sy + world.gazeEl * k; // where on the picture the eye points
  if (s > 0 && imgCanvas) {
    const iw = (sc.azDeg * s / world.dist) * k, ih = (sc.elDeg * s / world.dist) * k;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(imgCanvas, cx - iw / 2, sy - ih / 2, iw, ih);
  } else {
    ctx.fillStyle = T.mut; ctx.textAlign = 'center';
    ctx.fillText('(screen blank between pictures)', cx, sy + 4);
  }
  ctx.setLineDash([5, 4]); ctx.strokeStyle = T.mut; ctx.lineWidth = 1.2;
  ctx.strokeRect(gx - (e.fovAzDeg * k) / 2, gy - (e.fovElDeg * k) / 2, e.fovAzDeg * k, e.fovElDeg * k);
  ctx.setLineDash([]);
  ctx.fillStyle = T.mut; ctx.textAlign = 'left';
  ctx.fillText("fly's view", gx - (e.fovAzDeg * k) / 2 + 4, gy - (e.fovElDeg * k) / 2 + 13);
  if (s > 0 && imgCanvas) {
    if (e.activeVision) {
      // where the eye has been looking at this picture (fading trail), and where it looks now
      const toX = (az) => cx - az * k, toY = (el) => sy + el * k;
      const cap = world.trail.length / 2, n = Math.min(world.trailN, cap);
      for (let j = 1; j < n; j++) {
        const a = (world.trailN - n + j - 1) % cap, b = (world.trailN - n + j) % cap;
        ctx.strokeStyle = T.green; ctx.globalAlpha = 0.15 + 0.6 * (j / n); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(toX(world.trail[2 * a]), toY(world.trail[2 * a + 1])); ctx.lineTo(toX(world.trail[2 * b]), toY(world.trail[2 * b + 1])); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = T.green; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx - 12, gy); ctx.lineTo(gx - 5, gy); ctx.moveTo(gx + 5, gy); ctx.lineTo(gx + 12, gy);
      ctx.moveTo(gx, gy - 12); ctx.lineTo(gx, gy - 5); ctx.moveTo(gx, gy + 5); ctx.lineTo(gx, gy + 12); ctx.stroke();
    }
  }
  ctx.restore();
  // how far away the picture is (only shown when it isn't the normal distance)
  if (Math.abs(world.dist - 1) > 0.02 || e.activeZoom) {
    ctx.fillStyle = T.fg; ctx.textAlign = 'right'; ctx.font = '600 12.5px system-ui, sans-serif';
    ctx.fillText(`distance ${world.dist.toFixed(2)}x${world.dist < 0.98 ? ' (closer)' : world.dist > 1.02 ? ' (further)' : ''}`, W - 14, 22);
    ctx.font = FONT;
  }

  // head + eye(s)
  const ey = 222;
  ctx.fillStyle = T.line;
  ctx.beginPath(); ctx.ellipse(cx, ey + 6, 36, 21, 0, 0, Math.PI * 2); ctx.fill();
  const eyeAt = (x, on) => { ctx.fillStyle = on ? T.accent : T.mut; ctx.beginPath(); ctx.arc(x, ey, 10, 0, Math.PI * 2); ctx.fill(); };
  eyeAt(cx - 16, world.nEyes === 2);
  eyeAt(cx + 16, true);

  // feet: left = first answer, right = second
  const feet = [[cx - 120, T.accent, answers[0]], [cx + 120, T.pink, answers[1]]];
  ctx.textAlign = 'center';
  feet.forEach(([x, col, name], i) => {
    const down = world.pressed[i];
    const y = 272 + (down ? 6 : 0);
    ctx.beginPath(); ctx.arc(x, y, 19, 0, Math.PI * 2);
    ctx.fillStyle = down ? col : T.panel; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.fillStyle = T.fg; ctx.font = '600 12.5px system-ui, sans-serif';
    ctx.fillText(`${i ? 'right' : 'left'} foot: ${name}`, x, y + 36);
    ctx.font = FONT;
    const pain = world.pain[i];
    if (pain > 0.03) {
      ctx.strokeStyle = T.red; ctx.globalAlpha = Math.min(1, pain); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = T.red; ctx.fillText('ouch', x, y - 31);
    }
  });
  if (flash && flash.until > performance.now()) {
    ctx.strokeStyle = flash.color; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
    ctx.fillStyle = flash.color; ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(flash.text, 14, 24);
  }
}

// The retina(s): blocky on purpose -- this is all the fly gets to see.
export function drawEye(ctx, W, H, world, tmp, T) {
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);
  const n = world.nEyes, R = world.R, C = world.C;
  tmp.width = C; tmp.height = R;
  const tctx = tmp.getContext('2d');
  const d = tctx.createImageData(C, R);
  const cell = Math.min(Math.floor((W - 10 * (n - 1)) / n / C), Math.floor(H / R));
  const x0 = Math.floor((W - n * C * cell - 10 * (n - 1)) / 2);
  ctx.imageSmoothingEnabled = false;
  for (let e = 0; e < n; e++) {
    const L = world.retinas[e];
    for (let i = 0; i < R * C; i++) {
      const v = Math.max(0, Math.min(255, Math.round(L[i] * 255)));
      d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v; d.data[4 * i + 3] = 255;
    }
    tctx.putImageData(d, 0, 0);
    const x = x0 + e * (C * cell + 10);
    ctx.drawImage(tmp, x, 0, C * cell, R * cell);
    ctx.strokeStyle = T.line; ctx.strokeRect(x + 0.5, 0.5, C * cell - 1, R * cell - 1);
  }
}

const amber = (v, T) => (T.dark ? `rgb(${Math.round(255 * v)},${Math.round(170 * v)},${Math.round(40 * v)})`
  : `rgb(${Math.round(255 - 30 * v)},${Math.round(255 - 110 * v)},${Math.round(255 - 215 * v)})`);
const signed = (v, T) => {
  const a = Math.abs(v);
  if (T.dark) return v >= 0 ? `rgb(${Math.round(40 + 200 * a)},${Math.round(40 + 20 * a)},${Math.round(45 + 20 * a)})` : `rgb(${Math.round(40 + 10 * a)},${Math.round(45 + 70 * a)},${Math.round(55 + 200 * a)})`;
  return v >= 0 ? `rgb(255,${Math.round(255 - 170 * a)},${Math.round(255 - 170 * a)})` : `rgb(${Math.round(255 - 180 * a)},${Math.round(255 - 110 * a)},255)`;
};

// LC units by type, then the recurrent core, then feet, the mood chemical and the eye motor.
export function drawNeurons(ctx, W, H, brain, T) {
  ctx.fillStyle = T.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT; ctx.textAlign = 'left';
  const cell = 13;
  let y = 8;
  for (let e = 0; e < brain.nEyes; e++) {
    const lc = brain.lc[e];
    let x = 10;
    for (const t of lc.types) {
      const [nr, nc] = t.grid;
      ctx.fillStyle = T.mut;
      ctx.fillText(t.name + (brain.nEyes === 2 ? (e ? ' R' : ' L') : ''), x, y + 9);
      for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
        ctx.fillStyle = amber(Math.min(1, lc.out[t.start + i * nc + j]), T);
        ctx.fillRect(x + j * (cell + 1), y + 14 + i * (cell + 1), cell, cell);
      }
      x += nc * (cell + 1) + 14;
    }
    y += 14 + Math.max(...lc.types.map((t) => t.grid[0])) * (cell + 1) + 8;
  }
  ctx.fillStyle = T.mut;
  ctx.fillText(`brain cells (${brain.N})`, 10, y + 9);
  const cols = 16, cc = 11;
  for (let i = 0; i < brain.N; i++) {
    ctx.fillStyle = signed(Math.max(-1, Math.min(1, brain.h[i])), T);
    ctx.fillRect(10 + (i % cols) * (cc + 1), y + 14 + Math.floor(i / cols) * (cc + 1), cc, cc);
  }
  const bx = 10 + cols * (cc + 1) + 26;
  const names = ['left foot', 'right foot'];
  names.forEach((name, m) => {
    const v = brain.out[m];
    const x = bx + m * 54;
    ctx.fillStyle = T.panel; ctx.fillRect(x, y + 14, 24, 90);
    ctx.strokeStyle = T.line; ctx.strokeRect(x + 0.5, y + 14.5, 23, 89);
    ctx.fillStyle = m === 0 ? T.accent : T.pink;
    const h = Math.abs(v) * 45;
    ctx.fillRect(x, v >= 0 ? y + 14 + 45 - h : y + 14 + 45, 24, h);
    ctx.fillStyle = T.mut; ctx.fillText(name, x - 8, y + 118);
  });
  const mx = bx + 120;
  ctx.fillStyle = T.mut; ctx.fillText('mood chemical', mx, y + 9);
  ctx.fillStyle = T.panel; ctx.fillRect(mx, y + 14, 100, 14);
  ctx.fillStyle = T.amber; ctx.fillRect(mx, y + 14, 100 * brain.dopamine, 14);
  ctx.strokeStyle = T.line; ctx.strokeRect(mx + 0.5, y + 14.5, 99, 13);
  ctx.fillStyle = T.mut; ctx.fillText('eye motor', mx, y + 48);
  const gcx = mx + 26, gcy = y + 76, gr = 22;
  ctx.strokeStyle = T.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(gcx, gcy, gr, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = T.green; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(gcx, gcy); ctx.lineTo(gcx + brain.gaze[0] * gr, gcy - brain.gaze[1] * gr); ctx.stroke();
  ctx.lineWidth = 1;
  // closer (down) / further (up)
  const zx = gcx + 40, zy = gcy - gr, zh = 2 * gr, z = brain.gaze[2] || 0;
  ctx.fillStyle = T.panel; ctx.fillRect(zx, zy, 12, zh); ctx.strokeStyle = T.line; ctx.strokeRect(zx + 0.5, zy + 0.5, 11, zh - 1);
  ctx.fillStyle = T.green; const zp = Math.abs(z) * gr;
  ctx.fillRect(zx, z >= 0 ? gcy - zp : gcy, 12, zp);
  ctx.fillStyle = T.mut; ctx.fillText('back', zx + 16, zy + 8); ctx.fillText('closer', zx + 16, zy + zh);
}

// How often the fly has been right, 0-100%, with a dashed "guessing" line at 50%.
export function drawAccuracy(ctx, W, H, hist, unit, T) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const pl = 40, pr = 14, pt = 12, pb = 24, w = W - pl - pr, h = H - pt - pb;
  const gy = (v) => pt + h - v * h;
  ctx.strokeStyle = T.line; ctx.fillStyle = T.mut; ctx.textAlign = 'right'; ctx.lineWidth = 1;
  for (const v of [0, 0.5, 1]) {
    ctx.beginPath(); if (v === 0.5) ctx.setLineDash([4, 4]); ctx.moveTo(pl, gy(v)); ctx.lineTo(pl + w, gy(v)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillText(`${v * 100}%`, pl - 6, gy(v) + 4);
  }
  ctx.textAlign = 'left'; ctx.fillText('guessing', pl + 6, gy(0.5) - 5);
  if (hist.length < 2) {
    ctx.textAlign = 'center'; ctx.fillText('the learning curve appears here once training starts', pl + w / 2, gy(0.78));
    return;
  }
  const gx = (i) => pl + (i / (hist.length - 1)) * w;
  // smoothed line (running mean over a few points) for a calmer, readable curve
  const k = Math.max(1, Math.round(hist.length / 40));
  ctx.strokeStyle = T.accent; ctx.lineWidth = 2.5; ctx.beginPath();
  hist.forEach((p, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - k); j <= i; j++) { s += hist[j].acc; c++; }
    const yy = gy(s / c);
    i ? ctx.lineTo(gx(i), yy) : ctx.moveTo(gx(i), yy);
  });
  ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = T.mut; ctx.textAlign = 'center';
  ctx.fillText(`${unit} ${hist[0].gen} → ${hist[hist.length - 1].gen}`, pl + w / 2, H - 6);
}

export function drawHistogram(ctx, W, H, values, { min, max, bins = 20, color, title }, T) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const pl = 10, pr = 10, pt = 26, pb = 22, w = W - pl - pr, h = H - pt - pb;
  ctx.fillStyle = T.fg; ctx.textAlign = 'left'; ctx.fillText(title, pl, 16);
  if (!values || !values.length) { ctx.fillStyle = T.mut; ctx.fillText('no data yet', pl, pt + h / 2); return; }
  const counts = new Array(bins).fill(0);
  for (const v of values) counts[Math.max(0, Math.min(bins - 1, Math.floor(((v - min) / (max - min)) * bins)))]++;
  const top = Math.max(...counts);
  const bw = w / bins;
  ctx.fillStyle = color || T.accent;
  counts.forEach((c, i) => { const bh = (c / top) * h; ctx.fillRect(pl + i * bw + 1, pt + h - bh, bw - 2, bh); });
  const lbl = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace('-', '−');
  ctx.fillStyle = T.mut; ctx.textAlign = 'left'; ctx.fillText(lbl(min), pl, H - 6);
  ctx.textAlign = 'center'; if (min < 0 && max > 0) ctx.fillText('0', pl + w * (-min / (max - min)), H - 6);
  ctx.textAlign = 'right'; ctx.fillText(lbl(max), pl + w, H - 6);
}

// Two setups: each run as a dot, the average as a bar, and the typical spread.
export function drawCompare(ctx, W, H, data, T) {
  ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const pl = 44, pr = 16, pt = 16, pb = 44, w = W - pl - pr, h = H - pt - pb;
  const all = [...data.a, ...data.b].filter((x) => x != null);
  let lo = Math.min(0.4, ...all), hi = Math.max(0.6, ...all);
  lo = Math.max(0, Math.floor(lo * 10) / 10 - 0.05); hi = Math.min(1, Math.ceil(hi * 10) / 10 + 0.02);
  const gy = (v) => pt + h - ((v - lo) / (hi - lo)) * h;
  ctx.strokeStyle = T.line; ctx.fillStyle = T.mut; ctx.textAlign = 'right';
  for (let v = Math.ceil(lo * 10) / 10; v <= hi + 1e-9; v += 0.1) {
    ctx.beginPath(); if (Math.abs(v - 0.5) < 1e-6) ctx.setLineDash([4, 4]); ctx.moveTo(pl, gy(v)); ctx.lineTo(pl + w, gy(v)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillText(`${Math.round(v * 100)}%`, pl - 6, gy(v) + 4);
  }
  const groups = [[data.nameA, data.a, T.mut], [data.nameB, data.b, T.accent]];
  groups.forEach(([name, xs, col], g) => {
    const cx = pl + w * (g === 0 ? 0.3 : 0.7), bw = w * 0.22;
    const done = xs.filter((x) => x != null);
    if (done.length) {
      const m = done.reduce((s, x) => s + x, 0) / done.length;
      ctx.fillStyle = col; ctx.globalAlpha = 0.28;
      ctx.fillRect(cx - bw / 2, gy(m), bw, gy(lo) - gy(m));
      ctx.globalAlpha = 1; ctx.fillRect(cx - bw / 2, gy(m) - 1.5, bw, 3);
      ctx.fillStyle = T.fg; ctx.textAlign = 'center'; ctx.font = '700 14px system-ui, sans-serif';
      ctx.fillText(`${(m * 100).toFixed(1)}%`, cx, gy(m) - 8); ctx.font = FONT;
      done.forEach((x, i) => {
        const jitter = ((i % 5) - 2) * (bw / 7);
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(cx + jitter, gy(x), 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = T.bg; ctx.stroke();
      });
    }
    ctx.fillStyle = T.fg; ctx.textAlign = 'center'; ctx.fillText(name, cx, H - 24);
    ctx.fillStyle = T.mut; ctx.fillText(`${done.length}/${xs.length} runs`, cx, H - 8);
  });
}
