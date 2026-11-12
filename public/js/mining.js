// Добыча ресурсов лазером. Модуль без DOM и WebGL: только математика
// луча и состояние процесса, поэтому его можно проверять в Node.

const EPSILON = 1e-6;

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Направление луча из камеры через точку экрана.
 * @param {Float32Array} viewMatrix матрица вида (column-major)
 * @param {number} ndcX -1..1, вправо положительно
 * @param {number} ndcY -1..1, вверх положительно
 * @param {number} aspect ширина / высота кадра
 * @param {number} fovY вертикальный угол обзора, радианы
 */
export function cursorRayDirection(viewMatrix, ndcX, ndcY, aspect, fovY) {
  const tanHalf = Math.tan(fovY / 2);
  const right = [viewMatrix[0], viewMatrix[4], viewMatrix[8]];
  const up = [viewMatrix[1], viewMatrix[5], viewMatrix[9]];
  const back = [viewMatrix[2], viewMatrix[6], viewMatrix[10]];

  const sx = ndcX * tanHalf * aspect;
  const sy = ndcY * tanHalf;

  return normalize([
    right[0] * sx + up[0] * sy - back[0],
    right[1] * sx + up[1] * sy - back[1],
    right[2] * sx + up[2] * sy - back[2]
  ]);
}

/**
 * Пересечение луча с треугольниками (Möller–Trumbore).
 * @param {number[]} origin начало луча
 * @param {number[]} direction направление; длина может быть любой
 * @param {Float32Array} triangles по 9 чисел на треугольник
 * @returns {number|null} параметр t вдоль direction
 */
export function rayTriangles(origin, direction, triangles) {
  if (!triangles || !triangles.length) return null;

  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = direction;
  let best = null;

  for (let i = 0; i < triangles.length; i += 9) {
    const ax = triangles[i], ay = triangles[i + 1], az = triangles[i + 2];
    const bx = triangles[i + 3], by = triangles[i + 4], bz = triangles[i + 5];
    const cx = triangles[i + 6], cy = triangles[i + 7], cz = triangles[i + 8];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // p = d × e2
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;

    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-9) continue;

    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;

    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;

    // q = t × e1
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;

    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) continue;

    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > EPSILON && (best === null || t < best)) best = t;
  }

  return best;
}

/**
 * Точное попадание по мешу астероида: луч переводится в систему камня
 * (перенос, поворот вокруг Y, масштаб), там считается пересечение
 * с треугольниками. t возвращается в мировых единицах.
 */
export function createMeshHitTest(rock, triangles) {
  if (!triangles || !triangles.length) return null;

  return (origin, direction) => {
    const cos = Math.cos(rock.angle);
    const sin = Math.sin(rock.angle);
    const scale = rock.scale || 1;

    const wx = origin[0] - rock.pos[0];
    const wy = origin[1] - rock.pos[1];
    const wz = origin[2] - rock.pos[2];

    const localOrigin = [
      (wx * cos - wz * sin) / scale,
      wy / scale,
      (wx * sin + wz * cos) / scale
    ];

    const localDirection = [
      (direction[0] * cos - direction[2] * sin) / scale,
      direction[1] / scale,
      (direction[0] * sin + direction[2] * cos) / scale
    ];

    return rayTriangles(localOrigin, localDirection, triangles);
  };
}

/**
 * Пересечение луча и сферы.
 * @returns {number|null} ближайшее t > 0 либо null, если промах
 */
export function raySphere(origin, direction, center, radius) {
  const ox = origin[0] - center[0];
  const oy = origin[1] - center[1];
  const oz = origin[2] - center[2];

  const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;

  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  // Сначала ближняя точка: она и есть видимая поверхность камня.
  const near = -b - root;
  if (near > EPSILON) return near;

  const far = -b + root;
  return far > EPSILON ? far : null;
}

/** Ближайшее попадание по списку камней { pos, radius, hitTest? }. */
export function nearestRockHit(origin, direction, rocks) {
  let best = null;

  for (const rock of rocks) {
    if (!rock) continue;

    // У астероидов есть точный тест по мешу; сфера — запасной вариант.
    const distance = typeof rock.hitTest === 'function'
      ? rock.hitTest(origin, direction)
      : (rock.pos && rock.radius > 0 ? raySphere(origin, direction, rock.pos, rock.radius) : null);

    if (distance === null || distance === undefined) continue;
    if (best && distance >= best.distance) continue;

    best = {
      rock,
      distance,
      point: [
        origin[0] + direction[0] * distance,
        origin[1] + direction[1] * distance,
        origin[2] + direction[2] * distance
      ]
    };
  }

  return best;
}
