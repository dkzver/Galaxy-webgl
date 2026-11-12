/**
 * @fileoverview Геометрия узкой фазы: сфера-бокс, бокс-бокс, сфера-сфера.
 *
 * Все функции работают с локальными частями и телами, возвращают мировые
 * нормали/точки. Модуль не зависит от DOM и WebGL.
 */

import { quatConjugate, quatRotate } from '../math.js';
import { clamp, worldPoint } from './shapes.js';

/**
 * Геометрия контакта сферы с боксом. Бокс задаётся частью тела: смещение
 * и полуразмеры — в локальных осях. Возвращает нормаль «от бокса к сфере»,
 * точку на поверхности бокса и глубину проникновения.
 *
 * @returns {{outward: number[], point: number[], penetration: number}|null}
 */
function boxSphereContact(boxBody, boxPart, sphereBody, sphere) {
  const half = boxPart.halfExtents;
  const inverse = quatConjugate(boxBody.quaternion);
  const center = worldPoint(sphereBody, sphere.offset);
  const local = quatRotate(inverse, [
    center[0] - boxBody.position[0],
    center[1] - boxBody.position[1],
    center[2] - boxBody.position[2]
  ]);

  const relative = [
    local[0] - boxPart.offset[0],
    local[1] - boxPart.offset[1],
    local[2] - boxPart.offset[2]
  ];

  const closest = [
    clamp(relative[0], -half[0], half[0]),
    clamp(relative[1], -half[1], half[1]),
    clamp(relative[2], -half[2], half[2])
  ];

  const dx = relative[0] - closest[0];
  const dy = relative[1] - closest[1];
  const dz = relative[2] - closest[2];
  const distance = Math.hypot(dx, dy, dz);
  let normalLocal;
  let penetration;

  if (distance > 1e-6) {
    if (distance >= sphere.radius) return null;
    normalLocal = [dx / distance, dy / distance, dz / distance];
    penetration = sphere.radius - distance;
  } else {
    // Центр сферы внутри бокса: ближайшая грань задаёт направление выталкивания
    const faces = [
      { axis: 0, sign: 1, depth: half[0] - relative[0] },
      { axis: 0, sign: -1, depth: half[0] + relative[0] },
      { axis: 1, sign: 1, depth: half[1] - relative[1] },
      { axis: 1, sign: -1, depth: half[1] + relative[1] },
      { axis: 2, sign: 1, depth: half[2] - relative[2] },
      { axis: 2, sign: -1, depth: half[2] + relative[2] }
    ];

    let nearest = faces[0];
    for (const face of faces) if (face.depth < nearest.depth) nearest = face;

    normalLocal = [0, 0, 0];
    normalLocal[nearest.axis] = nearest.sign;
    closest[nearest.axis] = nearest.sign * half[nearest.axis];
    penetration = sphere.radius + nearest.depth;
  }

  const offset = quatRotate(boxBody.quaternion, [
    closest[0] + boxPart.offset[0],
    closest[1] + boxPart.offset[1],
    closest[2] + boxPart.offset[2]
  ]);

  return {
    outward: quatRotate(boxBody.quaternion, normalLocal),
    point: [
      boxBody.position[0] + offset[0],
      boxBody.position[1] + offset[1],
      boxBody.position[2] + offset[2]
    ],
    penetration
  };
}

const BOX_AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function verticesOf(center, axes, half) {
  const points = [];
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const s = [sx * half[0], sy * half[1], sz * half[2]];
        points.push([
          center[0] + axes[0][0] * s[0] + axes[1][0] * s[1] + axes[2][0] * s[2],
          center[1] + axes[0][1] * s[0] + axes[1][1] * s[1] + axes[2][1] * s[2],
          center[2] + axes[0][2] * s[0] + axes[1][2] * s[1] + axes[2][2] * s[2]
        ]);
      }
    }
  }
  return points;
}

function insideBox(point, center, axes, half) {
  for (let i = 0; i < 3; i++) {
    const axis = axes[i];
    const local =
      (point[0] - center[0]) * axis[0] +
      (point[1] - center[1]) * axis[1] +
      (point[2] - center[2]) * axis[2];
    if (Math.abs(local) > half[i] + 1e-4) return false;
  }
  return true;
}

/**
 * Пересечение двух OBB (теорема о разделяющей оси). Возвращает нормаль
 * «от A к B», глубину минимального перекрытия и точки контакта —
 * вершины, попавшие внутрь соседа (для устойчивого «лежания» куба).
 *
 * @returns {{normal: number[], overlap: number, points: number[][]}|null}
 */
function boxBoxGeometry(bodyA, partA, bodyB, partB) {
  const axesA = BOX_AXES.map((axis) => quatRotate(bodyA.quaternion, axis));
  const axesB = BOX_AXES.map((axis) => quatRotate(bodyB.quaternion, axis));
  const centerA = worldPoint(bodyA, partA.offset);
  const centerB = worldPoint(bodyB, partB.offset);

  const hA = partA.halfExtents;
  const hB = partB.halfExtents;

  const d = [centerB[0] - centerA[0], centerB[1] - centerA[1], centerB[2] - centerA[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const absR = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = dot(axesA[i], axesB[j]);
      absR[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }

  const t = [dot(d, axesA[0]), dot(d, axesA[1]), dot(d, axesA[2])];

  let best = null;
  const consider = (axis, overlap) => {
    if (overlap <= 0) return false;
    if (!best || overlap < best.overlap) best = { axis, overlap };
    return true;
  };

  for (let i = 0; i < 3; i++) {
    const reach = hB[0] * absR[i][0] + hB[1] * absR[i][1] + hB[2] * absR[i][2];
    if (!consider(axesA[i], hA[i] + reach - Math.abs(t[i]))) return null;
  }

  for (let j = 0; j < 3; j++) {
    const distance = Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]);
    const reach = hA[0] * absR[0][j] + hA[1] * absR[1][j] + hA[2] * absR[2][j];
    if (!consider(axesB[j], reach + hB[j] - distance)) return null;
  }

  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;

    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;

      // Почти параллельные оси дают вырожденное произведение: перекрытие по
      // нему считается с большой погрешностью и ложно «разделяет» боксы.
      if (absR[i][j] > 0.9999) continue;

      const axis = [
        axesA[i][1] * axesB[j][2] - axesA[i][2] * axesB[j][1],
        axesA[i][2] * axesB[j][0] - axesA[i][0] * axesB[j][2],
        axesA[i][0] * axesB[j][1] - axesA[i][1] * axesB[j][0]
      ];

      const length = Math.hypot(axis[0], axis[1], axis[2]);
      if (length < 1e-5) continue;

      const unit = [axis[0] / length, axis[1] / length, axis[2] / length];
      const reachA = hA[i1] * absR[i2][j] + hA[i2] * absR[i1][j];
      const reachB = hB[j1] * absR[i][j2] + hB[j2] * absR[i][j1];

      if (!consider(unit, reachA + reachB - Math.abs(dot(d, unit)))) return null;
    }
  }

  if (!best) return null;

  let normal = best.axis.slice();
  if (dot(normal, d) < 0) normal = [-normal[0], -normal[1], -normal[2]];

  const vertsA = verticesOf(centerA, axesA, hA);
  const vertsB = verticesOf(centerB, axesB, hB);

  const points = [];
  for (const point of vertsA) {
    if (insideBox(point, centerB, axesB, hB)) points.push(point);
  }
  for (const point of vertsB) {
    if (insideBox(point, centerA, axesA, hA)) points.push(point);
  }

  if (!points.length) {
    points.push([
      (centerA[0] + centerB[0]) / 2,
      (centerA[1] + centerB[1]) / 2,
      (centerA[2] + centerB[2]) / 2
    ]);
  }

  return { normal, overlap: best.overlap, points };
}

/**
 * Нормаль и расстояние между двумя сферами тел. null — сферы не касаются.
 * @returns {{direction: number[], distance: number}|null}
 */
function sphereNormal(bodyA, sphereA, bodyB, sphereB) {
  const centerA = worldPoint(bodyA, sphereA.offset);
  const centerB = worldPoint(bodyB, sphereB.offset);

  const dx = centerB[0] - centerA[0];
  const dy = centerB[1] - centerA[1];
  const dz = centerB[2] - centerA[2];
  const radiusSum = sphereA.radius + sphereB.radius;
  const distanceSq = dx * dx + dy * dy + dz * dz;

  if (distanceSq >= radiusSum * radiusSum) return null;

  const distance = Math.sqrt(distanceSq);
  if (distance < 1e-6) return { direction: [0, 1, 0], distance: 0 };

  return { direction: [dx / distance, dy / distance, dz / distance], distance };
}


export { boxSphereContact, boxBoxGeometry, sphereNormal };
