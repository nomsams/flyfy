// Fly Lab · Maze: the page. Draws the map, the fly and its view; the simulation runs in worker.js.
const $ = (id) => document.getElementById(id);
const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const S = {
  map: null, W: 1, H: 1, cell: 64, route: [], start: [0, 0], goal: [0, 0], length: 1,
  trainTrail: [], flyTrail: [], pose: null, members: [[0, 0]], trained: false, flying: false, training: false,
  tally: { n: 0, ok: 0 }, fly: null, dirty: true,
};

// ---------------------------------------------------------------- controls
document.querySelectorAll('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  seg.dispatchEvent(new Event('change'));
}));
const segVal = (id) => +document.querySelector(`#${id} button.on`).dataset.v;
const mazeOpts = () => ({ seed: Math.max(1, +$('seed').value || 1), cells: segVal('cells'), wobble: +$('wobble').value, variety: +$('variety').value });
const flyOpts = () => ({ colour: $('colour').checked, kc: segVal('kc'), swarm: segVal('swarm'), gaze: +$('gaze').value });
const bindOut = (id, fmt = (v) => v) => { const f = () => { $(id + '-o').textContent = fmt($(id).value); }; $(id).addEventListener('input', f); f(); };
bindOut('wobble'); bindOut('variety'); bindOut('gaze'); bindOut('passes'); bindOut('alt', (v) => (+v).toFixed(2));

function setBusy() {
  $('build').disabled = S.training;
  $('train').disabled = !S.map || S.training || S.flying;
  $('release').disabled = !S.trained || S.training || S.flying;
  $('drop').disabled = !S.trained || S.training || S.flying;
  $('stop').disabled = !S.training && !S.flying;
}

function build() {
  S.map = null; S.trained = false; S.trainTrail = []; S.flyTrail = []; S.pose = null;
  $('overlay').hidden = false; $('overlay-t').textContent = 'Building the maze…';
  document.querySelectorAll('#variant button').forEach((b) => b.classList.toggle('on', b.dataset.v === '0'));
  $('train-t').textContent = 'Building the maze…'; $('train-bar').style.width = '0%';
  setBusy();
  worker.postMessage({ type: 'build', maze: mazeOpts(), fly: flyOpts() });
}
$('build').onclick = build;
$('dice').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 9999); build(); };
['colour'].forEach((id) => $(id).addEventListener('change', flyChanged));
['kc', 'swarm'].forEach((id) => $(id).addEventListener('change', flyChanged));
$('gaze').addEventListener('change', flyChanged);
function flyChanged() {
  if (!S.map) return;
  worker.postMessage({ type: 'setFly', fly: flyOpts() });
  S.trained = false; S.training = false; S.flying = false; S.trainTrail = []; S.flyTrail = []; S.pose = null;
  $('train-t').textContent = 'The fly changed: teach it the route again.'; $('train-bar').style.width = '0%';
  setBusy(); S.dirty = true;
}
$('variant').addEventListener('change', () => { S.flying = false; setBusy(); worker.postMessage({ type: 'variant', v: segVal('variant') }); });

$('train').onclick = () => {
  const alts = [...document.querySelectorAll('#alts input:checked')].map((x) => +x.value);
  if (!alts.length) { $('train-t').textContent = 'Pick at least one height.'; return; }
  S.training = true; S.trained = false; S.trainTrail = []; S.flyTrail = []; S.pose = null; setBusy();
  worker.postMessage({ type: 'train', alts, passes: +$('passes').value, banks: $('banks').checked, approach: $('approach').checked ? 1 : 0, track: $('track').checked, map: $('maptrack').checked, aversive: $('aversive').checked });
};
$('stop').onclick = () => { worker.postMessage({ type: 'stop' }); S.flying = false; if (S.training) { S.training = false; $('train-t').textContent = 'Stopped. Teach the route to start again.'; } setBusy(); };
$('alt').addEventListener('input', () => worker.postMessage({ type: 'setAlt', alt: +$('alt').value }));
$('speed').addEventListener('input', () => worker.postMessage({ type: 'setDelay', delay: 120 - +$('speed').value }));
$('show-route').addEventListener('change', () => { S.dirty = true; });

// ---------------------------------------------------------------- releasing the fly
function nearestRoute(x, y) {
  let best = Infinity, bi = 0;
  S.route.forEach(([rx, ry], i) => { const d = (rx - x) ** 2 + (ry - y) ** 2; if (d < best) { best = d; bi = i; } });
  return bi;
}
function release(x, y, anyHeading = S.approach) {
  if (!S.trained || S.training) return;
  const i = nearestRoute(x, y), a = S.route[Math.max(0, i - 2)], b = S.route[Math.min(S.route.length - 1, i + 2)];
  const th = anyHeading ? Math.random() * 2 * Math.PI - Math.PI // dropped: facing anywhere
    : Math.atan2(b[1] - a[1], b[0] - a[0]) + (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.5); // near the route: a wrong heading on purpose
  S.flyTrail = []; S.where = null; S.onMap = null; S.flying = true; setBusy();
  $('err').hidden = true;
  worker.postMessage({ type: 'release', x, y, th, alt: +$('alt').value, cast: $('cast').checked, climb: $('climb').checked, delay: 120 - +$('speed').value });
}
$('release').onclick = () => {
  const i = Math.floor(Math.random() * S.route.length * 0.7), [x, y] = S.route[i], j = Math.min(S.route.length - 1, i + 2);
  const th = Math.atan2(S.route[j][1] - y, S.route[j][0] - x), off = (Math.random() * 2 - 1) * 0.35 * S.cell;
  release(x - Math.sin(th) * off, y + Math.cos(th) * off, false);
};
$('drop').onclick = () => { // anywhere on the map, at least 0.6 cells from the route
  let x, y, i;
  do { x = Math.random() * S.W; y = Math.random() * S.H; i = nearestRoute(x, y); } while (Math.hypot(S.route[i][0] - x, S.route[i][1] - y) < 0.6 * S.cell);
  release(x, y, true);
};
$('map').addEventListener('click', (e) => {
  const r = $('map').getBoundingClientRect();
  release(((e.clientX - r.left) / r.width) * S.W, ((e.clientY - r.top) / r.height) * S.H);
});

// ---------------------------------------------------------------- messages from the simulation
// if the simulation itself fails to start or crashes, say so instead of waiting forever
worker.onerror = (e) => {
  $('overlay-t').textContent = 'The simulation could not start: ' + (e.message || 'unknown error') + '. Try reloading the page.';
  $('err').hidden = false; $('err').textContent = 'The simulation stopped: ' + (e.message || 'unknown error');
  S.training = false; S.flying = false; setBusy();
};
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'map') {
    const c = document.createElement('canvas'); c.width = m.W; c.height = m.H;
    c.getContext('2d').putImageData(new ImageData(m.rgba, m.W, m.H), 0, 0);
    S.map = c; S.W = m.W; S.H = m.H;
    if (!m.keepRoute) { S.route = m.route; S.start = m.start; S.goal = m.goal; S.cell = m.cell; S.length = m.length; $('train-t').textContent = 'Ready: teach it the route.'; }
    $('overlay').hidden = true; S.dirty = true; setBusy();
  } else if (m.type === 'train') {
    S.trainTrail.push([m.pose.x, m.pose.y, !!m.approach]); S.pose = m.pose; S.members = m.members;
    $('train-bar').style.width = ((100 * (m.pass - 0.5)) / m.passes).toFixed(0) + '%';
    $('train-t').textContent = `${m.stage}, height ${m.alt} (pass ${m.pass} of ${m.passes}) · ${(100 * m.share).toFixed(0)}% of Kenyon cells familiar`;
    S.dirty = true;
  } else if (m.type === 'trained') {
    S.training = false; S.trained = true; S.approach = !!m.approach; S.members = m.members; S.pose = null;
    $('train-bar').style.width = '100%';
    $('train-t').textContent = `Learned. ${(100 * m.share).toFixed(0)}% of its Kenyon cells now mean "I've been on the route".` + (m.approach ? ' It also knows the way to the route from all over the map: drop it anywhere.' : ' Release it near the route.');
    setBusy(); S.dirty = true;
  } else if (m.type === 'fly') {
    S.where = m.where; S.onMap = m.onMap;
    $('st-alt').textContent = m.pose.alt.toFixed(2);
    S.pose = m.pose; S.flyTrail.push([m.pose.x, m.pose.y, m.casting, m.mode === 'approach']); S.fly = m;
    const st = $('st-state'); st.className = 'pill ' + m.status;
    st.textContent = { searching: 'heading for the route', following: 'following the route', casting: 'casting (lost the scent)', reached: 'reached the goal', lost: 'lost', tired: 'gave up' }[m.status];
    $('st-prog').textContent = m.found ? (100 * m.progress).toFixed(0) + '%' : 'not found yet';
    $('st-off').textContent = m.off.toFixed(2) + ' cells';
    $('st-where').textContent = m.where ? `${(100 * m.where.conf).toFixed(0)}% sure, ${(100 * m.where.s / S.length).toFixed(0)}% along the route` : m.mode === 'approach' ? (m.onMap ? `not on the route yet; ${(100 * m.onMap.conf).toFixed(0)}% sure where it is on the map` : 'not on the route yet') : 'not keeping track';
    drawView(m.view); drawFan(m);
    if (['reached', 'lost', 'tired'].includes(m.status)) {
      S.flying = false; S.tally.n++; if (m.status === 'reached') S.tally.ok++;
      $('st-tally').textContent = `${S.tally.ok} of ${S.tally.n}`; setBusy();
    }
    S.dirty = true;
  } else if (m.type === 'error') {
    $('err').hidden = false; $('err').textContent = 'Something went wrong: ' + m.message;
    S.training = false; S.flying = false; setBusy();
  }
};

// ---------------------------------------------------------------- drawing
const mapC = $('map'), mctx = mapC.getContext('2d');
function drawMap() {
  const Wc = mapC.width, k = Wc / S.W;
  mctx.clearRect(0, 0, Wc, Wc);
  if (!S.map) return;
  mctx.imageSmoothingEnabled = true; mctx.drawImage(S.map, 0, 0, Wc, Wc);
  if ($('show-route').checked) {
    mctx.strokeStyle = 'rgba(255,255,255,.85)'; mctx.lineWidth = 2.5; mctx.setLineDash([6, 6]);
    mctx.beginPath(); S.route.forEach(([x, y], i) => (i ? mctx.lineTo(x * k, y * k) : mctx.moveTo(x * k, y * k))); mctx.stroke(); mctx.setLineDash([]);
  }
  const dot = (x, y, r, col) => { mctx.fillStyle = col; mctx.beginPath(); mctx.arc(x * k, y * k, r, 0, 7); mctx.fill(); mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.stroke(); };
  dot(S.start[0], S.start[1], 8, '#39d353'); dot(S.goal[0], S.goal[1], 8, '#f0605a');
  for (const [x, y, ap] of S.trainTrail) { mctx.fillStyle = ap ? 'rgba(160,255,170,.35)' : 'rgba(255,255,255,.4)'; mctx.fillRect(x * k - 1.5, y * k - 1.5, 3, 3); }
  for (let i = 1; i < S.flyTrail.length; i++) {
    const [x0, y0] = S.flyTrail[i - 1], [x1, y1, c, ap] = S.flyTrail[i];
    mctx.strokeStyle = ap ? css('--green') : c ? css('--amber') : css('--accent'); mctx.lineWidth = 4; mctx.lineCap = 'round';
    mctx.beginPath(); mctx.moveTo(x0 * k, y0 * k); mctx.lineTo(x1 * k, y1 * k); mctx.stroke();
  }
  if (S.where && S.flying !== undefined && S.pose) { // where it thinks it is on the route: a ring, solid when sure
    const i = Math.min(S.route.length - 1, Math.round((S.where.s / S.length) * (S.route.length - 1))), [wx, wy] = S.route[i];
    mctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.75 * S.where.conf})`; mctx.lineWidth = 3; mctx.setLineDash(S.where.conf > 0.5 ? [] : [4, 4]);
    mctx.beginPath(); mctx.arc(wx * k, wy * k, 11, 0, 7); mctx.stroke(); mctx.setLineDash([]);
  }
  if (S.onMap && S.pose) { // its guess of where it is on the map (while heading for the route)
    mctx.strokeStyle = `rgba(160,255,160,${0.25 + 0.75 * S.onMap.conf})`; mctx.lineWidth = 3; mctx.setLineDash(S.onMap.conf > 0.5 ? [] : [4, 4]);
    mctx.beginPath(); mctx.arc(S.onMap.x * k, S.onMap.y * k, 14, 0, 7); mctx.stroke(); mctx.setLineDash([]);
  }
  if (S.pose) {
    const p = S.pose, len = S.cell * 1.6 * p.alt, wid = (len * 20) / 14, fx = Math.cos(p.th), fy = Math.sin(p.th), rx = -fy, ry = fx;
    S.members.forEach(([gx, gy], i) => { // each swarm member's patch of ground
      const cx = p.x + (gx * fx + gy * rx) * len, cy = p.y + (gx * fy + gy * ry) * len;
      mctx.save(); mctx.translate(cx * k, cy * k); mctx.rotate(p.th);
      mctx.strokeStyle = i === 0 ? '#ffffff' : 'rgba(255,255,255,.55)'; mctx.lineWidth = i === 0 ? 2 : 1.2; mctx.setLineDash(i === 0 ? [] : [4, 3]);
      mctx.strokeRect((-len / 2) * k, (-wid / 2) * k, len * k, wid * k); mctx.restore();
    });
    mctx.setLineDash([]);
    mctx.save(); mctx.translate(p.x * k, p.y * k); mctx.rotate(p.th); // the fly
    mctx.fillStyle = '#111'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.moveTo(12, 0); mctx.lineTo(-8, -7); mctx.lineTo(-4, 0); mctx.lineTo(-8, 7); mctx.closePath(); mctx.fill(); mctx.stroke(); mctx.restore();
  }
}
function drawView(v) {
  const c = $('view'), ctx = c.getContext('2d'), img = ctx.createImageData(20, 14);
  for (let i = 0; i < 280; i++) {
    const l = v.L[i], rg = v.Q[i], by = v.Q[280 + i], g = l - 0.356 * rg - 0.114 * by, r = g + rg, b = by + g + rg / 2;
    img.data.set([255 * r, 255 * g, 255 * b, 255], i * 4);
  }
  const t = document.createElement('canvas'); t.width = 20; t.height = 14; t.getContext('2d').putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false; ctx.drawImage(t, 0, 0, c.width, c.height);
}
function drawFan(m) {
  const c = $('fan'), ctx = c.getContext('2d'), W = c.width, H = c.height, cx = W / 2, cy = H - 12, R = H - 24;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(1, ...m.ratings);
  m.ratings.forEach((v, i) => {
    const ang = -Math.PI / 2 + ((i - 4) * 15 * Math.PI) / 180, len = 14 + (R - 14) * (v / max);
    ctx.strokeStyle = i === m.choice ? (m.casting ? css('--amber') : css('--accent')) : css('--line'); ctx.lineWidth = i === m.choice ? 9 : 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * 10, cy + Math.sin(ang) * 10); ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); ctx.stroke();
  });
  ctx.fillStyle = css('--mut'); ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('ahead', cx, 12); ctx.textAlign = 'left'; ctx.fillText('left', 4, cy); ctx.textAlign = 'right'; ctx.fillText('right', W - 4, cy);
}
(function frame() { if (S.dirty) { S.dirty = false; drawMap(); } requestAnimationFrame(frame); })();
build();
