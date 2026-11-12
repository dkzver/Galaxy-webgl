import io

path = 'public/js/editor/model-editor.js'
raw = io.open(path, encoding='utf-8', newline='').read()
crlf = '\r\n' in raw
src = raw.replace('\r\n', '\n')

def cut(text, start_marker, end_marker, replacement, label):
    i = text.find(start_marker)
    if i < 0:
        raise SystemExit(f'{label}: start not found')
    j = text.find(end_marker, i)
    if j < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:i] + replacement + text[j:]

# ------------------------------------------------------------------ state ---
src = src.replace(
    '''const state = {
  id: null,
  info: null,
  dirty: false,
  saving: false,
  spheres: []
};''',
    '''const state = {
  id: null,
  info: null,
  dirty: false,
  saving: false,
  spheres: [],
  boxes: []
};'''
)

# ------------------------------------------------------------- status line ---
src = cut(
    src,
    'function updateColliderState(note = \'\') {',
    '\nfunction fitCollider',
    '''function updateColliderState(note = '') {
  if (!colliderState) return;

  const shape = shapeInput.value;
  let kind = shape;

  if (shape === 'compound') {
    const parts = [];
    if (state.boxes.length) parts.push(`${state.boxes.length} боксов`);
    if (state.spheres.length) parts.push(`${state.spheres.length} сфер`);
    kind = `compound · ${parts.length ? parts.join(' + ') : 'пусто'}`;
  }

  const text = [`модель ${state.id || '—'}`, kind];
  if (note) text.push(note);

  colliderState.textContent = text.join(' · ');
  colliderState.className = `collider-state ${note.includes('ошибка') ? 'warn' : 'ok'}`;
}

''',
    'updateColliderState'
)

# ------------------------------------------------------------ collider view ---
src = cut(
    src,
    '  for (const sphere of state.spheres) {\n    pushWireSphere(',
    '\nfunction drawLines(vertices, matrix, viewProj) {',
    '''  for (const sphere of state.spheres) {
    pushWireSphere(
      vertices,
      sphere.offset,
      Math.max(0.01, Number(sphere.radius) || 1),
      color
    );
  }

  for (const box of state.boxes) {
    const half = box.halfExtents;
    const corners = [];

    for (let index = 0; index < 8; index++) {
      const sign = [
        index & 1 ? 1 : -1,
        index & 2 ? 1 : -1,
        index & 4 ? 1 : -1
      ];

      corners.push([
        box.offset[0] + sign[0] * half[0],
        box.offset[1] + sign[1] * half[1],
        box.offset[2] + sign[2] * half[2]
      ]);
    }

    pushWireBoxCorners(vertices, corners, color);
  }

  return vertices;
}

''',
    'colliderLines'
)

# --------------------------------------------------------------- generation ---
generation = '''async function fitColliderAsync() {
  if (!model || !model.triangles || !model.triangles.length) {
    setStatus('у модели нет треугольников для расчёта', true);
    return;
  }

  const detail = Math.max(8, Math.min(32, Number(fitDetail.value) || 12));
  const tris = model.triangles;
  const triCount = Math.floor(tris.length / 9);
  const MAX_BOXES = 32;

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
  const maxDim = Math.max(size[0], size[1], size[2]) || 1;
  const cell = maxDim / detail;
  const pad = 1;

  const origin = [min[0] - cell * pad, min[1] - cell * pad, min[2] - cell * pad];
  const dims = size.map((value) => Math.ceil(value / cell) + pad * 2 + 1);
  const nx = dims[0];
  const ny = dims[1];
  const nz = dims[2];
  const total = nx * ny * nz;
  const index = (x, y, z) => x + nx * (y + ny * z);

  // 1. Воксели поверхности: треугольники раскладываем точками не реже cell/2
  const surface = new Uint8Array(total);

  const mark = (x, y, z) => {
    const ix = Math.floor((x - origin[0]) / cell);
    const iy = Math.floor((y - origin[1]) / cell);
    const iz = Math.floor((z - origin[2]) / cell);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return;
    surface[index(ix, iy, iz)] = 1;
  };

  for (let i = 0; i < tris.length; i += 9) {
    const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
    const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
    const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];

    const ab = Math.hypot(bx - ax, by - ay, bz - az);
    const bc = Math.hypot(cx - bx, cy - by, cz - bz);
    const ca = Math.hypot(ax - cx, ay - cy, az - cz);
    const steps = Math.max(1, Math.min(16, Math.ceil(Math.max(ab, bc, ca) / (cell * 0.45))));

    for (let u = 0; u <= steps; u++) {
      for (let v = 0; u + v <= steps; v++) {
        const w = steps - u - v;
        mark(
          (ax * u + bx * v + cx * w) / steps,
          (ay * u + by * v + cy * w) / steps,
          (az * u + bz * v + cz * w) / steps
        );
      }
    }
  }

  // 2. Снаружи: заливка от границ. Всё остальное — объём модели
  const outside = new Uint8Array(total);
  const queue = [];

  const push = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = index(x, y, z);
    if (surface[i] || outside[i]) return;
    outside[i] = 1;
    queue.push(i);
  };

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      push(0, y, z);
      push(nx - 1, y, z);
    }
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) {
      push(x, 0, z);
      push(x, ny - 1, z);
    }
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      push(x, y, 0);
      push(x, y, nz - 1);
    }
  }

  while (queue.length) {
    const i = queue.pop();
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));
    push(x + 1, y, z);
    push(x - 1, y, z);
    push(x, y + 1, z);
    push(x, y - 1, z);
    push(x, y, z + 1);
    push(x, y, z - 1);
  }

  const solid = new Uint8Array(total);
  for (let i = 0; i < total; i++) solid[i] = outside[i] ? 0 : 1;

  // 3. Жадное покрытие объёма брусками: сначала самый длинный по X,
  //    потом по Z, потом по Y — так деталей меньше и они «чище».
  const used = new Uint8Array(total);
  const raw = [];

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const start = index(x, y, z);
        if (!solid[start] || used[start]) continue;

        let w = 1;
        while (x + w < nx) {
          const i = index(x + w, y, z);
          if (!solid[i] || used[i]) break;
          w++;
        }

        let d = 1;
        grow: while (z + d < nz) {
          for (let dx = 0; dx < w; dx++) {
            const i = index(x + dx, y, z + d);
            if (!solid[i] || used[i]) break grow;
          }
          d++;
        }

        let h = 1;
        growY: while (y + h < ny) {
          for (let dz = 0; dz < d; dz++) {
            for (let dx = 0; dx < w; dx++) {
              const i = index(x + dx, y + h, z + dz);
              if (!solid[i] || used[i]) break growY;
            }
          }
          h++;
        }

        for (let dz = 0; dz < d; dz++) {
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              used[index(x + dx, y + dy, z + dz)] = 1;
            }
          }
        }

        raw.push({ min: [x, y, z], max: [x + w, y + h, z + d] });
      }
    }
  }

  // 4. Слияние соседних брусков: одинаковые границы по двум осям и
  //    соприкосновение по третьей — это снова брусок.
  const same = (a, b) => Math.abs(a - b) < 1e-6;

  let merged = true;
  while (merged) {
    merged = false;

    for (let i = 0; i < raw.length && !merged; i++) {
      for (let j = i + 1; j < raw.length && !merged; j++) {
        const A = raw[i];
        const B = raw[j];

        // по X: одинаковые Y/Z и стык по X
        if (same(A.min[1], B.min[1]) && same(A.max[1], B.max[1]) &&
            same(A.min[2], B.min[2]) && same(A.max[2], B.max[2]) &&
            (same(A.max[0], B.min[0]) || same(B.max[0], A.min[0]))) {
          A.min[0] = Math.min(A.min[0], B.min[0]);
          A.max[0] = Math.max(A.max[0], B.max[0]);
          raw.splice(j, 1);
          merged = true;
          break;
        }

        // по Y
        if (same(A.min[0], B.min[0]) && same(A.max[0], B.max[0]) &&
            same(A.min[2], B.min[2]) && same(A.max[2], B.max[2]) &&
            (same(A.max[1], B.min[1]) || same(B.max[1], A.min[1]))) {
          A.min[1] = Math.min(A.min[1], B.min[1]);
          A.max[1] = Math.max(A.max[1], B.max[1]);
          raw.splice(j, 1);
          merged = true;
          break;
        }

        // по Z
        if (same(A.min[0], B.min[0]) && same(A.max[0], B.max[0]) &&
            same(A.min[1], B.min[1]) && same(A.max[1], B.max[1]) &&
            (same(A.max[2], B.min[2]) || same(B.max[2], A.min[2]))) {
          A.min[2] = Math.min(A.min[2], B.min[2]);
          A.max[2] = Math.max(A.max[2], B.max[2]);
          raw.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
  }

  const volume = (box) => (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]);

  // 5. Слишком много брусков — объединяем самые «дешёвые» пары (минимум
  //    добавленного пустого объёма), пока не влезем в лимит движка.
  while (raw.length > MAX_BOXES) {
    let best = null;

    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const A = raw[i];
        const B = raw[j];

        const union = {
          min: [Math.min(A.min[0], B.min[0]), Math.min(A.min[1], B.min[1]), Math.min(A.min[2], B.min[2])],
          max: [Math.max(A.max[0], B.max[0]), Math.max(A.max[1], B.max[1]), Math.max(A.max[2], B.max[2])]
        };

        const waste = volume(union) - volume(A) - volume(B);
        if (!best || waste < best.waste) best = { i, j, union, waste };
      }
    }

    if (!best) break;

    raw[best.i] = best.union;
    raw.splice(best.j, 1);
  }

  // 6. В мировые координаты. Полвокселя снимаем, чтобы коллайдер не
  //    выглядывал за корпус из-за дискретности сетки.
  const shrink = cell * 0.5;

  state.boxes = raw.map((box) => {
    const lo = [
      origin[0] + box.min[0] * cell,
      origin[1] + box.min[1] * cell,
      origin[2] + box.min[2] * cell
    ];
    const hi = [
      origin[0] + box.max[0] * cell,
      origin[1] + box.max[1] * cell,
      origin[2] + box.max[2] * cell
    ];

    const halfExtents = [0, 1, 2].map((axis) => {
      const full = (hi[axis] - lo[axis]) / 2;
      return Math.max(full * 0.35, full - shrink);
    });

    return {
      offset: [0, 1, 2].map((axis) => Math.round(((lo[axis] + hi[axis]) / 2) * 1000) / 1000),
      halfExtents: halfExtents.map((value) => Math.round(value * 1000) / 1000)
    };
  });

  state.spheres = [];
  shapeInput.value = 'compound';
  syncVisibility();
  markDirty();

  const saved = await save();
  if (saved) {
    updateColliderState(`сохранён ${new Date().toLocaleTimeString('ru-RU', { hour12: false })}`);
    setStatus(`коллайдер построен по модели: ${state.boxes.length} боксов`);
  }
}
'''

src = cut(src, 'async function fitColliderAsync() {', '\nasync function fitSingleSphere() {', generation, 'fitColliderAsync')

# ------------------------------------------------------------- apply physics ---
src = cut(
    src,
    "  state.spheres = Array.isArray(collider.spheres) && collider.spheres.length",
    "\n  syncVisibility();",
    '''  state.spheres = Array.isArray(collider.spheres)
    ? collider.spheres.map((sphere) => ({
      offset: Array.isArray(sphere.offset) ? sphere.offset.slice(0, 3) : [0, 0, 0],
      radius: Number(sphere.radius) || 1
    }))
    : [];

  state.boxes = Array.isArray(collider.boxes)
    ? collider.boxes.map((box) => ({
      offset: Array.isArray(box.offset) ? box.offset.slice(0, 3) : [0, 0, 0],
      halfExtents: Array.isArray(box.halfExtents) ? box.halfExtents.slice(0, 3) : [1, 1, 1]
    }))
    : [];
''',
    'applyPhysics state'
)

# ----------------------------------------------------------- collect physics ---
src = cut(
    src,
    "  } else if (shape === 'compound') {\n    collider = {\n      shape: 'compound',",
    "\n  return {\n    kind,",
    '''  } else if (shape === 'compound') {
    collider = {
      shape: 'compound',
      spheres: state.spheres.map((sphere) => ({
        offset: sphere.offset.map((value) => number(value, 0)),
        radius: Math.max(0.01, number(sphere.radius, 1))
      })),
      boxes: state.boxes.map((box) => ({
        offset: box.offset.map((value) => number(value, 0)),
        halfExtents: box.halfExtents.map((value) => Math.max(0.01, number(value, 1)))
      }))
    };
''',
    'collectPhysics'
)

# -------------------------------------------------- save verification fields ---
src = src.replace(
    '''    const sameShape = saved && saved.shape === payload.collider.shape;
    const sameCount = payload.collider.shape !== 'compound'
      || (Array.isArray(saved?.spheres) && saved.spheres.length === payload.collider.spheres.length);

    if (!sameShape || !sameCount) {
      throw new Error('сервер не сохранил коллайдер');
    }''',
    '''    const sameShape = saved && saved.shape === payload.collider.shape;
    const sameCount = payload.collider.shape !== 'compound'
      || ((Array.isArray(saved?.spheres) ? saved.spheres.length : 0) === payload.collider.spheres.length
        && (Array.isArray(saved?.boxes) ? saved.boxes.length : 0) === payload.collider.boxes.length);

    if (!sameShape || !sameCount) {
      throw new Error('сервер не сохранил коллайдер');
    }'''
)

# ------------------------------------------------------- shape switch default ---
src = src.replace(
    '''shapeInput.addEventListener('change', () => {
  if (shapeInput.value === 'compound' && !state.spheres.length) {
    state.spheres.push({ offset: [0, 0, 0], radius: Math.max(0.5, Number(radiusInput.value) || 1) });
  }
  syncVisibility();
  markDirty();
});''',
    '''shapeInput.addEventListener('change', () => {
  if (shapeInput.value === 'compound' && !state.spheres.length && !state.boxes.length) {
    state.boxes.push({
      offset: [0, 0, 0],
      halfExtents: [1, 1, 1]
    });
  }
  syncVisibility();
  markDirty();
});'''
)

if crlf:
    src = src.replace('\n', '\r\n')
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('model editor updated')
