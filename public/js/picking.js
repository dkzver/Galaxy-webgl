// Попадание луча в модель: наведение и клик мыши.
//
// Здесь только математика: луч в мировых координатах против локального
// AABB модели (`model.bounds`), переведённого обратной матрицей сущности.
// Ни DOM, ни WebGL — модуль проверяется в Node.

/**
 * Пересечение луча с локальным AABB. Возвращает параметр t или null.
 * @param {number[]} origin
 * @param {number[]} direction не обязательно нормирован
 * @param {number[]} min
 * @param {number[]} max
 * @returns {number|null}
 */
export function rayBox(origin, direction, min, max) {
  let tMin = 0;
  let tMax = Infinity;

  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis];
    const d = direction[axis];

    if (Math.abs(d) < 1e-9) {
      if (o < min[axis] || o > max[axis]) return null;
      continue;
    }

    let t1 = (min[axis] - o) / d;
    let t2 = (max[axis] - o) / d;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}

/** Направление через верхнюю левую 3×3 матрицы (перенос не применяется). */
export function transformDirection(matrix, direction) {
  const [x, y, z] = direction;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z
  ];
}

/**
 * Попадание луча в модель сущности.
 * @param {{origin:number[], direction:number[]}} ray
 * @param {object} entity сущность сцены с model.bounds и matrix
 * @returns {{t:number, point:number[], entity:object}|null}
 */
export function pickModel(ray, entity) {
  const bounds = entity?.model?.bounds;
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) return null;
  if (!entity.matrix || entity.visible === false) return null;

  // Луч переводим в локальные координаты модели: там AABB выровнен по осям
  const inverse = M4Inverse(entity.matrix);
  if (!inverse) return null;
  const localOrigin = transformPoint(inverse, ray.origin);
  const localDirection = transformDirection(inverse, ray.direction);
  const t = rayBox(localOrigin, localDirection, bounds.min, bounds.max);
  if (t == null) return null;

  return {
    t,
    point: [
      ray.origin[0] + ray.direction[0] * t,
      ray.origin[1] + ray.direction[1] * t,
      ray.origin[2] + ray.direction[2] * t
    ],
    entity
  };
}

/**
 * Ближайшее попадание среди сущностей.
 * @param {{origin:number[], direction:number[]}} ray
 * @param {object[]} entities
 * @returns {{t:number, point:number[], entity:object}|null}
 */
export function pickClosest(ray, entities) {
  let best = null;

  for (const entity of entities || []) {
    const hit = pickModel(ray, entity);
    if (hit && (!best || hit.t < best.t)) best = hit;
  }

  return best;
}

// --- минимальные матричные операции, чтобы модуль не тянул рендер ---------

function transformPoint(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]
  ];
}

/** Обратная матрица 4×4 (общий случай; для сцены матрицы обратимы). */
function M4Inverse(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;

  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det
  ];
}
