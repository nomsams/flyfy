// Canvas drawing: the scene, what the eye sees, the neurons, the learning curve.
// Everything is cheap (small canvases, no per-frame allocation to speak of).

const BLUE = '#58a6ff', PINK = '#f778ba', GREEN = '#3fb950', RED = '#f85149', AMBER = '#d29922';

export function makeImageCanvas(img, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const d = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, Math.round(img[i] * 255)));
    d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v;
    d.data[4 * i + 3] = 255;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

// Front view: the screen (with its expanding onset), the eye(s), two feet.
export function drawScene(ctx, W, H, world, imgCanvas, flash) {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, sy = 92, fw = 210, fh = 140;

  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - fw / 2, sy - fh / 2, fw, fh);
  const s = world.scale();
  if (s > 0 && imgCanvas) {
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(imgCanvas, cx - (fw * s) / 2, sy - (fh * s) / 2, fw * s, fh * s);
  }
  ctx.fillStyle = '#8b949e';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(s > 0 ? `cue: ${world.label === 0 ? 'man' : 'woman'}` : 'screen blank', cx, sy + fh / 2 + 16);

  // gaze
  const ey = 226;
  ctx.strokeStyle = 'rgba(88,166,255,0.18)';
  ctx.lineWidth = 1;
  for (const ex of world.nEyes === 2 ? [cx - 16, cx + 16] : [cx + 16]) {
    ctx.beginPath(); ctx.moveTo(ex, ey - 8); ctx.lineTo(cx - fw / 2, sy + fh / 2);
    ctx.moveTo(ex, ey - 8); ctx.lineTo(cx + fw / 2, sy + fh / 2); ctx.stroke();
  }
  // head + eyes
  ctx.fillStyle = '#21262d';
  ctx.beginPath(); ctx.ellipse(cx, ey + 6, 34, 20, 0, 0, Math.PI * 2); ctx.fill();
  const eyeAt = (x, on) => { ctx.fillStyle = on ? '#58a6ff' : '#30363d'; ctx.beginPath(); ctx.arc(x, ey, 10, 0, Math.PI * 2); ctx.fill(); };
  eyeAt(cx - 16, world.nEyes === 2);
  eyeAt(cx + 16, true);

  // feet: left = man (blue), right = woman (pink)
  const feet = [[cx - 110, BLUE, 'left foot = man'], [cx + 110, PINK, 'right foot = woman']];
  feet.forEach(([x, col, name], i) => {
    const down = world.pressed[i];
    const y = 268 + (down ? 8 : 0);
    ctx.beginPath(); ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fillStyle = down ? col : 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#8b949e'; ctx.fillText(name, x, y + 36);
  });
  if (flash && flash.until > performance.now()) {
    ctx.strokeStyle = flash.color; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }
}

// The retina(s): blocky on purpose -- this is all the fly gets to see.
export function drawEye(ctx, W, H, world, tmp) {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  const n = world.nEyes, R = world.R, C = world.C;
  tmp.width = C; tmp.height = R;
  const tctx = tmp.getContext('2d');
  const d = tctx.createImageData(C, R);
  const cellW = Math.floor((W - 10 * (n - 1)) / n / C), cellH = Math.floor(H / R);
  const cell = Math.min(cellW, cellH);
  ctx.imageSmoothingEnabled = false;
  for (let e = 0; e < n; e++) {
    const L = world.retinas[e];
    for (let i = 0; i < R * C; i++) {
      const v = Math.max(0, Math.min(255, Math.round(L[i] * 255)));
      d.data[4 * i] = d.data[4 * i + 1] = d.data[4 * i + 2] = v; d.data[4 * i + 3] = 255;
    }
    tctx.putImageData(d, 0, 0);
    const x0 = e * (C * cell + 10);
    ctx.drawImage(tmp, x0, 0, C * cell, R * cell);
    ctx.strokeStyle = '#30363d'; ctx.strokeRect(x0 + 0.5, 0.5, C * cell - 1, R * cell - 1);
  }
}

const amber = (v) => `rgb(${Math.round(255 * v)},${Math.round(170 * v)},${Math.round(40 * v)})`;
const signed = (v) => (v >= 0 ? `rgb(${Math.round(60 + 195 * v)},${Math.round(40 * v)},${Math.round(50 * v)})`
  : `rgb(${Math.round(50 * -v)},${Math.round(80 * -v)},${Math.round(60 + 195 * -v)})`);

// LC units by type, then the recurrent core (red = +, blue = -), then feet.
export function drawNeurons(ctx, W, H, brain) {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const cell = 13;
  let y = 6;
  for (let e = 0; e < brain.nEyes; e++) {
    const lc = brain.lc[e];
    let x = 8;
    for (const t of lc.types) {
      const [nr, nc] = t.grid;
      ctx.fillStyle = '#8b949e';
      ctx.fillText(t.name + (brain.nEyes === 2 ? (e ? ' R' : ' L') : ''), x, y + 9);
      for (let i = 0; i < nr; i++) {
        for (let j = 0; j < nc; j++) {
          ctx.fillStyle = amber(Math.min(1, lc.out[t.start + i * nc + j]));
          ctx.fillRect(x + j * (cell + 1), y + 14 + i * (cell + 1), cell, cell);
        }
      }
      x += nc * (cell + 1) + 14;
    }
    y += 14 + 6 * (cell + 1) + 4;
  }
  ctx.fillStyle = '#8b949e';
  ctx.fillText(`core (${brain.N})   red = active, blue = suppressed`, 8, y + 9);
  const cols = 16, cc = 11;
  for (let i = 0; i < brain.N; i++) {
    ctx.fillStyle = signed(Math.max(-1, Math.min(1, brain.h[i])));
    ctx.fillRect(8 + (i % cols) * (cc + 1), y + 14 + Math.floor(i / cols) * (cc + 1), cc, cc);
  }
  const bx = 8 + cols * (cc + 1) + 30;
  ['L foot', 'R foot'].forEach((name, m) => {
    const v = brain.out[m];
    const x = bx + m * 64;
    ctx.fillStyle = '#21262d'; ctx.fillRect(x, y + 14, 26, 90);
    ctx.fillStyle = m === 0 ? BLUE : PINK;
    const h = Math.abs(v) * 45;
    ctx.fillRect(x, v >= 0 ? y + 14 + 45 - h : y + 14 + 45, 26, h);
    ctx.fillStyle = '#8b949e'; ctx.fillText(name, x - 4, y + 120);
  });
}

export function drawChart(ctx, W, H, hist) {
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '11px system-ui, sans-serif';
  const pl = 44, pr = 40, pt = 10, pb = 22;
  const w = W - pl - pr, h = H - pt - pb;
  if (hist.length < 2) {
    ctx.fillStyle = '#8b949e'; ctx.textAlign = 'center';
    ctx.fillText('learning curve appears after a couple of generations', W / 2, H / 2);
    return;
  }
  const series = [
    ['popMean', '#6e7681'], ['best', AMBER], ['theta', GREEN],
  ];
  let lo = Infinity, hi = -Infinity;
  for (const p of hist) for (const [k] of series) { if (p[k] < lo) lo = p[k]; if (p[k] > hi) hi = p[k]; }
  if (hi - lo < 1) { hi = lo + 1; }
  const gx = (i) => pl + (i / (hist.length - 1)) * w;
  const gy = (v) => pt + h - ((v - lo) / (hi - lo)) * h;
  ctx.strokeStyle = '#21262d'; ctx.lineWidth = 1;
  ctx.fillStyle = '#8b949e'; ctx.textAlign = 'right';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4, yy = gy(v);
    ctx.beginPath(); ctx.moveTo(pl, yy); ctx.lineTo(pl + w, yy); ctx.stroke();
    ctx.fillText(v.toFixed(0), pl - 6, yy + 4);
  }
  for (const [k, col] of series) {
    ctx.strokeStyle = col; ctx.lineWidth = k === 'theta' ? 2 : 1;
    ctx.beginPath();
    hist.forEach((p, i) => (i ? ctx.lineTo(gx(i), gy(p[k])) : ctx.moveTo(gx(i), gy(p[k]))));
    ctx.stroke();
  }
  // accuracy of the current policy, right axis 0-100%
  ctx.strokeStyle = BLUE; ctx.lineWidth = 2; ctx.beginPath();
  hist.forEach((p, i) => { const yy = pt + h - p.acc * h; i ? ctx.lineTo(gx(i), yy) : ctx.moveTo(gx(i), yy); });
  ctx.stroke();
  ctx.textAlign = 'left'; ctx.fillStyle = BLUE;
  ctx.fillText('100%', pl + w + 4, pt + 8); ctx.fillText('50%', pl + w + 4, pt + h / 2 + 4); ctx.fillText('0%', pl + w + 4, pt + h);
  ctx.strokeStyle = '#30363d'; ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pl, pt + h / 2); ctx.lineTo(pl + w, pt + h / 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.fillStyle = '#8b949e';
  ctx.fillText(`generation ${hist[0].gen} → ${hist[hist.length - 1].gen}`, pl + w / 2, H - 5);
}
