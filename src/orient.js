// Orientation cells: how strongly edges run along each of `bins` directions (default 8, every
// 22.5 degrees), summed over small patches of the eye. Fly visual neurons downstream of the
// photoreceptors are tuned to edge orientation, and adding up their rectified output over a patch
// (like a mammalian "complex cell") says *which way the edges run here* without caring exactly where
// inside the patch they sit. That tolerance to small shifts is what unaligned photos need: on the face
// photos, class averages of pooled 8-direction energy reach ~65%, against ~57% from the raw pixels
// and ~58% from edge strength without direction (tools/data-headroom.mjs). Sharp direction tuning is
// what matters: 4 directions reach only ~62%.
//
// img: rows x cols brightness (row-major). pool: patch size in sensors. Returns (or fills) a
// Float32Array of ceil(rows/pool) * ceil(cols/pool) * bins values.
export function orientSize(rows, cols, pool, bins = 8) {
  return Math.ceil(rows / pool) * Math.ceil(cols / pool) * bins;
}

export function orientationEnergy(img, rows, cols, pool, bins = 8, out = new Float32Array(orientSize(rows, cols, pool, bins))) {
  const pc = Math.ceil(cols / pool), k = bins / Math.PI;
  out.fill(0);
  for (let r = 0; r < rows; r++) {
    const up = (r > 0 ? r - 1 : r) * cols, dn = (r < rows - 1 ? r + 1 : r) * cols, row = r * cols;
    const cellRow = Math.floor(r / pool) * pc;
    for (let c = 0; c < cols; c++) {
      const gx = img[row + (c < cols - 1 ? c + 1 : c)] - img[row + (c > 0 ? c - 1 : c)];
      const gy = img[dn + c] - img[up + c];
      const mag = Math.hypot(gx, gy);
      if (!mag) continue;
      let a = Math.atan2(gy, gx); // direction of the brightness change; an edge runs across it
      if (a < 0) a += Math.PI;    // light-to-dark or dark-to-light: same edge direction
      out[(cellRow + Math.floor(c / pool)) * bins + (Math.round(a * k) % bins)] += mag;
    }
  }
  return out;
}
