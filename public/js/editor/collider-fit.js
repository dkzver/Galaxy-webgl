/**
 * @fileoverview Фасад генераторов коллайдеров.
 *
 * Публичные функции разложены по модулям:
 * - `collider/voxelizer.js` — растеризация и закрытие микрощелей;
 * - `collider/box-merger.js` — жадное покрытие и слияние;
 * - `collider/box-collider.js` — сборка боксов;
 * - `collider/sphere-packer.js` — сферы и гибрид.
 *
 * Здесь остаются только фасадные реэкспорты и утилиты выбора/лучей, чтобы
 * старые импорты из `collider-fit.js` продолжали работать.
 */

import { mergeAligned, mergeNeighbours } from './collider/box-merger.js';

export { bestGreedyCover, coverSolid, mergeAligned, mergeNeighbours } from './collider/box-merger.js';
export { buildBoxCollider, buildBoxColliderDetailed } from './collider/box-collider.js';
export { buildCompoundCollider, buildSphereCollider } from './collider/sphere-packer.js';
export { meshBounds, voxelize } from './collider/voxelizer.js';

const EPS = 1e-6;

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Сливает готовые боксы (offset + halfExtents) до лимита. Сначала убирает
 * выровненные стыки, затем соседей с минимальным пустым объёмом.
 * @param {Array<{offset: number[], halfExtents: number[]}>} boxes
 * @param {number} [maxBoxes=32]
 * @returns {Array<{offset: number[], halfExtents: number[]}>}
 */
export function simplifyBoxes(boxes, maxBoxes = 32) {
  const limit = clampInt(maxBoxes, 1, 32, 32);
  const list = boxes.map((box) => ({
    min: [
      box.offset[0] - box.halfExtents[0],
      box.offset[1] - box.halfExtents[1],
      box.offset[2] - box.halfExtents[2]
    ],
    max: [
      box.offset[0] + box.halfExtents[0],
      box.offset[1] + box.halfExtents[1],
      box.offset[2] + box.halfExtents[2]
    ]
  }));

  let merged = mergeAligned(list);
  if (merged.length > limit) merged = mergeNeighbours(merged, limit, 0.35);
  if (merged.length > limit) merged = mergeNeighbours(merged, limit, 1);

  return merged.map((box) => ({
    offset: [0, 1, 2].map((axis) => Math.round(((box.min[axis] + box.max[axis]) / 2) * 1000) / 1000),
    halfExtents: [0, 1, 2].map((axis) => Math.max(0.01, Math.round(((box.max[axis] - box.min[axis]) / 2) * 1000) / 1000))
  }));
}

/**
 * Пересечение луча и бокса (slab-метод).
 * @param {number[]} origin
 * @param {number[]} direction
 * @param {{offset: number[], halfExtents: number[]}} part
 * @returns {number|null}
 */
function rayBox(origin, direction, part) {
  let near = -Infinity;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis++) {
    const min = part.offset[axis] - part.halfExtents[axis];
    const max = part.offset[axis] + part.halfExtents[axis];
    const o = origin[axis];
    const d = direction[axis];

    if (Math.abs(d) < EPS) {
      if (o < min || o > max) return null;
      continue;
    }

    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > near) near = t1;
    if (t2 < far) far = t2;
    if (near > far) return null;
  }

  if (far < 0) return null;
  return near >= 0 ? near : far;
}

function raySphere(origin, direction, part) {
  const ox = origin[0] - part.offset[0];
  const oy = origin[1] - part.offset[1];
  const oz = origin[2] - part.offset[2];

  const a = direction[0] ** 2 + direction[1] ** 2 + direction[2] ** 2;
  const b = 2 * (ox * direction[0] + oy * direction[1] + oz * direction[2]);
  const c = ox * ox + oy * oy + oz * oz - part.radius * part.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

/**
 * Ближайшая часть коллайдера под лучом.
 * @param {number[]} origin
 * @param {number[]} direction
 * @param {Array<object>} parts
 * @returns {number} индекс части или -1
 */
export function pickPart(origin, direction, parts) {
  let best = -1;
  let bestT = Infinity;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const t = part.kind === 'sphere' ? raySphere(origin, direction, part) : rayBox(origin, direction, part);
    if (t != null && t < bestT) {
      bestT = t;
      best = i;
    }
  }

  return best;
}

/**
 * Ближайшее попадание луча в меш (Мёллер–Трумбор).
 * @param {number[]} origin
 * @param {number[]} direction
 * @param {ArrayLike<number>} triangles
 * @returns {number|null}
 */
export function raycastMesh(origin, direction, triangles) {
  let bestT = Infinity;

  for (let i = 0; i < triangles.length; i += 9) {
    const ax = triangles[i], ay = triangles[i + 1], az = triangles[i + 2];
    const bx = triangles[i + 3], by = triangles[i + 4], bz = triangles[i + 5];
    const cx = triangles[i + 6], cy = triangles[i + 7], cz = triangles[i + 8];

    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    const px = direction[1] * e2z - direction[2] * e2y;
    const py = direction[2] * e2x - direction[0] * e2z;
    const pz = direction[0] * e2y - direction[1] * e2x;

    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < EPS) continue;

    const inv = 1 / det;
    const tx = origin[0] - ax;
    const ty = origin[1] - ay;
    const tz = origin[2] - az;

    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;

    const v = (direction[0] * qx + direction[1] * qy + direction[2] * qz) * inv;
    if (v < 0 || u + v > 1) continue;

    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > EPS && t < bestT) bestT = t;
  }

  return Number.isFinite(bestT) ? bestT : null;
}

/**
 * Пересечение луча с плоскостью.
 * @param {number[]} origin
 * @param {number[]} direction
 * @param {number[]} point
 * @param {number[]} normal
 * @returns {number[]|null}
 */
export function rayPlane(origin, direction, point, normal) {
  const denominator = direction[0] * normal[0] + direction[1] * normal[1] + direction[2] * normal[2];
  if (Math.abs(denominator) < EPS) return null;

  const t = ((point[0] - origin[0]) * normal[0]
    + (point[1] - origin[1]) * normal[1]
    + (point[2] - origin[2]) * normal[2]) / denominator;
  if (t < 0) return null;

  return [
    origin[0] + direction[0] * t,
    origin[1] + direction[1] * t,
    origin[2] + direction[2] * t
  ];
}

/**
 * Восемь углов бокса — для каркаса в предпросмотре и редакторе сцены.
 * @param {{offset: number[], halfExtents: number[]}} part
 * @returns {number[][]}
 */
export function boxCorners(part) {
  const corners = [];

  for (let index = 0; index < 8; index++) {
    const sign = [index & 1 ? 1 : -1, index & 2 ? 1 : -1, index & 4 ? 1 : -1];
    corners.push([
      part.offset[0] + sign[0] * part.halfExtents[0],
      part.offset[1] + sign[1] * part.halfExtents[1],
      part.offset[2] + sign[2] * part.halfExtents[2]
    ]);
  }

  return corners;
}
