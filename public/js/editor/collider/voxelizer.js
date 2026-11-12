/**
 * @fileoverview Вокселизация треугольного меша для генераторов коллайдеров.
 *
 * Модуль не зависит от DOM и WebGL: на вход приходит плоский список
 * треугольников (по 9 чисел), на выходе — сплошной объём в воксельной сетке.
 * Поверхность растеризуется точным тестом «треугольник–воксель» (SAT,
 * Akenine-Möller), поэтому даже крупные треугольники не дают щелей на
 * границах ячеек.
 */

const EPS = 1e-6;

/**
 * Габариты плоского списка треугольников.
 * @param {ArrayLike<number>} triangles по 9 чисел на треугольник
 * @returns {{min: number[], max: number[], size: number[], center: number[]}|null}
 */
export function meshBounds(triangles) {
  if (!triangles || triangles.length < 9) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < triangles.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = triangles[i + axis];
      if (!Number.isFinite(value)) continue;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }

  if (![0, 1, 2].every((axis) => Number.isFinite(min[axis]) && Number.isFinite(max[axis]))) {
    return null;
  }

  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
  };
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Пересечение треугольника и вокселя (SAT, Akenine-Möller).
 * @param {number[]} a вершина треугольника
 * @param {number[]} b вершина треугольника
 * @param {number[]} c вершина треугольника
 * @param {number[]} center центр вокселя
 * @param {number[]} half половина размера вокселя
 * @returns {boolean}
 */
function triangleBoxOverlap(a, b, c, center, half) {
  const v0 = subtract(a, center);
  const v1 = subtract(b, center);
  const v2 = subtract(c, center);

  for (let axis = 0; axis < 3; axis++) {
    const min = Math.min(v0[axis], v1[axis], v2[axis]);
    const max = Math.max(v0[axis], v1[axis], v2[axis]);
    if (min > half[axis] || max < -half[axis]) return false;
  }

  const e0 = subtract(v1, v0);
  const e1 = subtract(v2, v1);
  const e2 = subtract(v0, v2);

  const normal = cross(e0, e1);
  const distance = dot(normal, v0);
  const radius = half[0] * Math.abs(normal[0])
    + half[1] * Math.abs(normal[1])
    + half[2] * Math.abs(normal[2]);
  if (Math.abs(distance) > radius) return false;

  const axes = [[0, e0], [1, e0], [2, e0], [0, e1], [1, e1], [2, e1], [0, e2], [1, e2], [2, e2]];
  const unit = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  for (const [boxAxis, edge] of axes) {
    const axis = cross(unit[boxAxis], edge);
    const length = Math.hypot(axis[0], axis[1], axis[2]);
    if (length < 1e-9) continue;

    const projected = [dot(v0, axis), dot(v1, axis), dot(v2, axis)];
    const boxRadius = half[0] * Math.abs(axis[0])
      + half[1] * Math.abs(axis[1])
      + half[2] * Math.abs(axis[2]);

    if (Math.min(...projected) > boxRadius || Math.max(...projected) < -boxRadius) return false;
  }

  return true;
}

/**
 * Есть ли поверхность вдоль луча из вокселя (только по осям сетки).
 * @param {Uint8Array} surface маска поверхностных вокселей
 * @param {number[]} dims размеры сетки
 * @param {number} x индекс по X
 * @param {number} y индекс по Y
 * @param {number} z индекс по Z
 * @param {number} axis ось луча: 0, 1 или 2
 * @param {number} direction направление: +1 или -1
 * @param {number} maxSteps максимум шагов
 * @returns {boolean}
 */
function rayHitsSurface(surface, dims, x, y, z, axis, direction, maxSteps) {
  const [nx, ny, nz] = dims;
  const point = [x, y, z];

  for (let step = 1; step <= maxSteps; step++) {
    point[axis] += direction;
    if (point[0] < 0 || point[1] < 0 || point[2] < 0
      || point[0] >= nx || point[1] >= ny || point[2] >= nz) {
      return false;
    }

    if (surface[point[0] + nx * (point[1] + ny * point[2])]) return true;
  }

  return false;
}

/**
 * Локально закрывает микрощели: снаружи-воксель становится внутренним, если
 * минимум 5 из 6 осевых лучей упираются в поверхность не дальше `radius` ячеек.
 * Ограничение длины луча не даёт залить широкие зазоры между деталями.
 *
 * @param {Uint8Array} surface маска поверхностных вокселей
 * @param {Uint8Array} outside маска внешних вокселей (изменяется)
 * @param {number[]} dims размеры сетки
 * @param {number} [radius=3]
 * @returns {number} сколько вокселей закрыто
 */
export function sealGapVoxels(surface, outside, dims, radius = 3) {
  const [nx, ny, nz] = dims;
  const maxSteps = Math.max(1, Math.min(6, Math.round(radius)));
  let sealed = 0;

  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        const i = x + nx * (y + ny * z);
        if (!outside[i]) continue;

        let hits = 0;
        if (rayHitsSurface(surface, dims, x, y, z, 0, 1, maxSteps)) hits++;
        if (rayHitsSurface(surface, dims, x, y, z, 0, -1, maxSteps)) hits++;
        if (rayHitsSurface(surface, dims, x, y, z, 1, 1, maxSteps)) hits++;
        if (rayHitsSurface(surface, dims, x, y, z, 1, -1, maxSteps)) hits++;
        if (rayHitsSurface(surface, dims, x, y, z, 2, 1, maxSteps)) hits++;
        if (rayHitsSurface(surface, dims, x, y, z, 2, -1, maxSteps)) hits++;

        if (hits >= 5) {
          outside[i] = 0;
          sealed++;
        }
      }
    }
  }

  return sealed;
}

/**
 * Раскладывает треугольники по вокселям и строит сплошной объём.
 *
 * Порядок:
 * 1. точная растеризация треугольников в маску `surface`;
 * 2. заливка снаружи от границ сетки;
 * 3. при `sealGaps` — локальное закрытие микрощелей лучевым консенсусом:
 *    снаружи-воксель становится сплошным, если минимум 5 из 6 осевых лучей
 *    упираются в поверхность не дальше `sealRadius` ячеек. Ограничение длины
 *    луча не даёт залить широкие зазоры между отдельными деталями.
 *
 * @param {ArrayLike<number>} triangles по 9 чисел на треугольник
 * @param {{min: number[], max: number[], size: number[]}} bounds габариты
 * @param {number} cell размер ячейки
 * @param {{sealGaps?: boolean, sealRadius?: number}} [options]
 * @returns {{solid: Uint8Array, surface: Uint8Array, dims: number[], origin: number[], cell: number, solidCount: number, sealedCount: number}}
 */
export function voxelize(triangles, bounds, cell, options = {}) {
  const pad = 1;
  const origin = [bounds.min[0] - cell * pad, bounds.min[1] - cell * pad, bounds.min[2] - cell * pad];
  const dims = bounds.size.map((value) => Math.ceil(value / cell) + pad * 2 + 1);
  const [nx, ny, nz] = dims;
  const total = nx * ny * nz;
  const index = (x, y, z) => x + nx * (y + ny * z);

  const surface = new Uint8Array(total);
  const half = [cell / 2 + cell * 1e-4, cell / 2 + cell * 1e-4, cell / 2 + cell * 1e-4];
  const inv = 1 / cell;

  for (let i = 0; i < triangles.length; i += 9) {
    const a = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const b = [triangles[i + 3], triangles[i + 4], triangles[i + 5]];
    const c = [triangles[i + 6], triangles[i + 7], triangles[i + 8]];

    // -1 по нижней грани: треугольник, лежащий ровно на границе вокселей,
    // должен задеть клетку и слева, иначе в поверхности остаются щели.
    const lo = [
      Math.floor((Math.min(a[0], b[0], c[0]) - origin[0]) * inv) - 1,
      Math.floor((Math.min(a[1], b[1], c[1]) - origin[1]) * inv) - 1,
      Math.floor((Math.min(a[2], b[2], c[2]) - origin[2]) * inv) - 1
    ];
    const hi = [
      Math.floor((Math.max(a[0], b[0], c[0]) - origin[0]) * inv),
      Math.floor((Math.max(a[1], b[1], c[1]) - origin[1]) * inv),
      Math.floor((Math.max(a[2], b[2], c[2]) - origin[2]) * inv)
    ];

    const x0 = Math.max(0, lo[0]);
    const y0 = Math.max(0, lo[1]);
    const z0 = Math.max(0, lo[2]);
    const x1 = Math.min(nx - 1, hi[0]);
    const y1 = Math.min(ny - 1, hi[1]);
    const z1 = Math.min(nz - 1, hi[2]);

    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const cellIndex = index(x, y, z);
          if (surface[cellIndex]) continue;

          const center = [
            origin[0] + (x + 0.5) * cell,
            origin[1] + (y + 0.5) * cell,
            origin[2] + (z + 0.5) * cell
          ];

          if (triangleBoxOverlap(a, b, c, center, half)) surface[cellIndex] = 1;
        }
      }
    }
  }

  // Заливка снаружи: всё, до чего не дотянулась вода, — объём модели.
  const outside = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;

  const push = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const i = index(x, y, z);
    if (surface[i] || outside[i]) return;
    outside[i] = 1;
    stack[top++] = i;
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

  while (top > 0) {
    const i = stack[--top];
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
  let solidCount = 0;
  let sealedCount = 0;

  // Микрощели: если снаружи-воксель зажат поверхностью минимум с 5 сторон
  // в пределах нескольких ячеек, это трещина в меше, а не внешнее пространство.
  const sealGaps = options.sealGaps !== false;
  const sealRadius = Math.max(1, Math.min(6, Math.round(options.sealRadius ?? 3)));

  if (sealGaps && sealRadius > 0) {
    sealedCount = sealGapVoxels(surface, outside, dims, sealRadius);
  }

  for (let i = 0; i < total; i++) {
    if (!outside[i]) {
      solid[i] = 1;
      solidCount++;
    }
  }

  return { solid, outside, surface, dims, origin, cell, solidCount, sealedCount };
}

/**
 * Вспомогательная проверка: лежит ли точка внутри габаритов с допуском.
 * @param {number[]} point
 * @param {number[]} min
 * @param {number[]} max
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function insideBounds(point, min, max, epsilon = 1e-6) {
  return point[0] >= min[0] - epsilon && point[0] <= max[0] + epsilon
    && point[1] >= min[1] - epsilon && point[1] <= max[1] + epsilon
    && point[2] >= min[2] - epsilon && point[2] <= max[2] + epsilon;
}

export { EPS };
