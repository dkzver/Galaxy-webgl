import io

path = 'public/js/editor/model-editor.js'
src = io.open(path, encoding='utf-8').read()

start = 'async function fitColliderAsync() {'
end = '\nasync function fitSingleSphere() {'

i = src.find(start)
j = src.find(end)
if i < 0 or j < 0 or j <= i:
    raise SystemExit('fitColliderAsync block not found')

new_fn = r'''async function fitColliderAsync() {
  if (!model || !model.triangles || !model.triangles.length) {
    setStatus('у модели нет треугольников для расчёта', true);
    return;
  }

  const detail = Math.max(8, Math.min(32, Number(fitDetail.value) || 12));
  const tris = model.triangles;
  const triCount = Math.floor(tris.length / 9);
  const MAX_SPHERES = 32;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < tris.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = tris[i + axis];
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const diag = Math.hypot(size[0], size[1], size[2]) || 1;
  const cell = diag / 32;            // ячейка сетки поиска треугольников
  const origin = [min[0] - cell, min[1] - cell, min[2] - cell];

  const voxelOf = (value, axis) => Math.floor((value - origin[axis]) / cell);
  const key = (x, y, z) => `${x},${y},${z}`;

  // --- сетка треугольников: расстояние считаем только по соседним ---
  const buckets = new Map();

  for (let t = 0; t < triCount; t++) {
    const i = t * 9;
    let x0 = Infinity, x1 = -Infinity;

    for (let v = 0; v < 3; v++) {
      const value = tris[i + v * 3];
      if (value < x0) x0 = value;
      if (value > x1) x1 = value;
    }

    const ax = voxelOf(x0, 0), bx = voxelOf(x1, 0);
    let y0 = Infinity, y1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const value = tris[i + v * 3 + 1];
      if (value < y0) y0 = value;
      if (value > y1) y1 = value;
    }
    const ay = voxelOf(y0, 1), by = voxelOf(y1, 1);
    let z0 = Infinity, z1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const value = tris[i + v * 3 + 2];
      if (value < z0) z0 = value;
      if (value > z1) z1 = value;
    }
    const az = voxelOf(z0, 2), bz = voxelOf(z1, 2);

    for (let z = az; z <= bz; z++) {
      for (let y = ay; y <= by; y++) {
        for (let x = ax; x <= bx; x++) {
          const k = key(x, y, z);
          const list = buckets.get(k);
          if (list) list.push(i);
          else buckets.set(k, [i]);
        }
      }
    }
  }

  // Ближайший треугольник, но не дальше limit
  const nearest = (px, py, pz, limit) => {
    const cx = voxelOf(px, 0), cy = voxelOf(py, 1), cz = voxelOf(pz, 2);
    const maxR = Math.max(1, Math.ceil(limit / cell) + 1);
    let best = limit;

    for (let r = 0; r <= maxR; r++) {
      if (best < r * cell * 0.7) break;

      for (let z = cz - r; z <= cz + r; z++) {
        for (let y = cy - r; y <= cy + r; y++) {
          for (let x = cx - r; x <= cx + r; x++) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== r) continue;

            const list = buckets.get(key(x, y, z));
            if (!list) continue;

            for (let n = 0; n < list.length; n++) {
              const d = triangleDistance(px, py, pz, tris, list[n]);
              if (d < best) best = d;
            }
          }
        }
      }
    }

    return best;
  };

  // --- точки на поверхности модели ---
  const wanted = Math.round(Math.min(1600, Math.max(240, detail * 70)));
  const step = Math.max(1, Math.floor(triCount / wanted));
  const samples = [];

  for (let t = 0; t < triCount; t += step) {
    const i = t * 9;
    samples.push([
      (tris[i] + tris[i + 3] + tris[i + 6]) / 3,
      (tris[i + 1] + tris[i + 4] + tris[i + 7]) / 3,
      (tris[i + 2] + tris[i + 5] + tris[i + 8]) / 3
    ]);
  }

  // --- направления поиска «внутрь» ---
  const dirs = [];
  const dirCount = 26;

  for (let k = 0; k < dirCount; k++) {
    const y = 1 - (2 * (k + 0.5)) / dirCount;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (1 + Math.sqrt(5)) * k;
    dirs.push([Math.cos(theta) * r, y, Math.sin(theta) * r]);
  }

  const maxReach = diag * 0.42;
  const steps = 10;

  // Наибольшая сфера, касающаяся поверхности изнутри в окрестности точки
  const tangentSphere = (px, py, pz) => {
    let best = { radius: 0, center: null };

    for (const dir of dirs) {
      for (let s = 1; s <= steps; s++) {
        const t = (s / steps) * maxReach;
        const qx = px + dir[0] * t;
        const qy = py + dir[1] * t;
        const qz = pz + dir[2] * t;

        if (qx < min[0] - cell || qy < min[1] - cell || qz < min[2] - cell) continue;
        if (qx > max[0] + cell || qy > max[1] + cell || qz > max[2] + cell) continue;

        const free = nearest(qx, qy, qz, maxReach);
        if (free > best.radius) best = { radius: free, center: [qx, qy, qz] };
      }
    }

    return best;
  };

  const spheres = [];
  const used = new Uint8Array(samples.length);
  const MARGIN = 0.94;

  const markCovered = (center, radius) => {
    for (let i = 0; i < samples.length; i++) {
      if (used[i]) continue;
      if (Math.hypot(
        samples[i][0] - center[0],
        samples[i][1] - center[1],
        samples[i][2] - center[2]
      ) <= radius) used[i] = 1;
    }
  };

  const farthestFree = (from) => {
    let best = -1;
    let bestScore = -1;

    for (let i = 0; i < samples.length; i++) {
      if (used[i]) continue;

      let score = Infinity;
      for (const sphere of spheres) {
        const d = Math.hypot(
          samples[i][0] - sphere.offset[0],
          samples[i][1] - sphere.offset[1],
          samples[i][2] - sphere.offset[2]
        ) - sphere.radius;
        if (d < score) score = d;
      }

      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }

    return best;
  };

  // Первая сфера — самая крупная вписанная в модель
  const centerPoint = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const seed = tangentSphere(centerPoint[0], centerPoint[1], centerPoint[2]);

  if (seed.center) {
    const radius = seed.radius * MARGIN;
    spheres.push({
      offset: seed.center.map((value) => Math.round(value * 1000) / 1000),
      radius: Math.round(radius * 1000) / 1000
    });
    markCovered(seed.center, radius);
  }

  // Дальше — сферы, накрывающие ещё не покрытые участки поверхности
  let guard = 0;

  while (spheres.length < MAX_SPHERES && guard++ < samples.length) {
    const index = farthestFree(0);
    if (index < 0) break;

    const point = samples[index];
    const fit = tangentSphere(point[0], point[1], point[2]);
    if (!fit.center || fit.radius < diag * 0.004) {
      used[index] = 1;
      continue;
    }

    const radius = fit.radius * MARGIN;
    spheres.push({
      offset: fit.center.map((value) => Math.round(value * 1000) / 1000),
      radius: Math.round(radius * 1000) / 1000
    });
    markCovered(fit.center, radius);
  }

  // Убираем сферы, целиком лежащие внутри более крупных
  const kept = [];

  for (let a = 0; a < spheres.length; a++) {
    let redundant = false;

    for (let b = 0; b < spheres.length; b++) {
      if (a === b) continue;
      const A = spheres[a];
      const B = spheres[b];
      const d = Math.hypot(A.offset[0] - B.offset[0], A.offset[1] - B.offset[1], A.offset[2] - B.offset[2]);
      if (d + A.radius <= B.radius * 0.995) {
        if (B.radius > A.radius || (B.radius === A.radius && b < a)) {
          redundant = true;
          break;
        }
      }
    }

    if (!redundant) kept.push(spheres[a]);
  }

  state.spheres = kept;
  shapeInput.value = 'compound';
  syncVisibility();
  markDirty();

  const saved = await save();
  if (saved) {
    updateColliderState(`сохранён ${new Date().toLocaleTimeString('ru-RU', { hour12: false })}`);
    setStatus(`коллайдер построен по форме: ${state.spheres.length} сфер`);
  }
}
'''

src = src[:i] + new_fn + src[j:]
io.open(path, 'w', encoding='utf-8', newline='\n').write(src)
print('fit rewritten')
