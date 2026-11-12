/**
 * @fileoverview Формы коллайдеров и мировые запросы к ним.
 *
 * Чистая математика без DOM и WebGL. Формы хранят локальные смещения и
 * размеры; мировые координаты считаются по позиции и кватерниону тела.
 */

import { quatIdentity, quatRotate } from '../math.js';

/**
 * Ограничить число диапазоном.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Число или запасное значение для нечисловых входов.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Привести значение к массиву из трёх чисел.
 * @param {unknown} value
 * @param {number[]} [fallback]
 * @returns {number[]}
 */
function toVec3(value, fallback = [0, 0, 0]) {
  if (!value || typeof value.length !== 'number' || value.length < 3) return fallback.slice();
  return [
    numberOr(value[0], fallback[0]),
    numberOr(value[1], fallback[1]),
    numberOr(value[2], fallback[2])
  ];
}

/**
 * Нормализовать кватернион; вырожденный вход даёт единичный.
 * @param {number[]} quaternion
 * @returns {number[]}
 */
function normalizeQuat(quaternion) {
  const q = toVec3([quaternion?.[0], quaternion?.[1], quaternion?.[2]], [0, 0, 0]);
  const w = numberOr(quaternion?.[3], 1);
  const length = Math.hypot(q[0], q[1], q[2], w);
  if (!(length > 1e-8)) return quatIdentity();
  return [q[0] / length, q[1] / length, q[2] / length, w / length];
}

/* ------------------------------- Коллайдеры ------------------------------ */

/**
 * Сферический коллайдер.
 * @param {number} radius радиус сферы в мировых единицах
 */
export function sphereShape(radius) {
  const r = numberOr(radius, 0);
  if (!(r > 0)) throw new Error('sphereShape: радиус должен быть больше нуля');
  return {
    type: 'sphere',
    spheres: [{ offset: [0, 0, 0], radius: r }],
    boundingRadius: r
  };
}

/**
 * Составной коллайдер: сферы и/или боксы. Смещения задаются в локальных
 * координатах тела и поворачиваются вместе с его кватернионом; у бокса
 * полуразмеры тоже локальные.
 *
 * Часть описывается либо как сфера `{ offset, radius }`, либо как бокс
 * `{ type: 'box', offset, halfExtents }`.
 *
 * @param {Array<{type?: string, offset?: number[], radius?: number, halfExtents?: number[]}>} parts
 */
export function compoundShape(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('compoundShape: нужен непустой массив частей');
  }

  const spheres = [];
  const boxes = [];

  parts.forEach((part, index) => {
    const isBox = part?.type === 'box' || Array.isArray(part?.halfExtents);
    const offset = toVec3(part?.offset);

    if (isBox) {
      const half = toVec3(part.halfExtents);
      if (!(half[0] > 0 && half[1] > 0 && half[2] > 0)) {
        throw new Error(`compoundShape: у бокса ${index} полуразмеры должны быть больше нуля`);
      }
      boxes.push({
        offset,
        halfExtents: half,
        boundingRadius: Math.hypot(half[0], half[1], half[2])
      });
      return;
    }

    const radius = numberOr(part?.radius, 0);
    if (!(radius > 0)) {
      throw new Error(`compoundShape: у сферы ${index} радиус должен быть больше нуля`);
    }
    spheres.push({ offset, radius });
  });

  const boundingRadius = [...spheres, ...boxes].reduce((max, part) => {
    const [x, y, z] = part.offset;
    const reach = part.radius ?? Math.hypot(
      part.halfExtents[0],
      part.halfExtents[1],
      part.halfExtents[2]
    );
    return Math.max(max, Math.hypot(x, y, z) + reach);
  }, 0);

  return { type: 'compound', spheres, boxes, boundingRadius };
}

/**
 * Коллайдер-параллелепипед (OBB). Полуразмеры задаются в локальных осях
 * тела и поворачиваются вместе с его кватернионом, поэтому куб можно
 * вращать — контакт считается по текущей ориентации.
 *
 * @param {number[]} halfExtents полуразмеры [hx, hy, hz], каждый больше нуля
 */
export function boxShape(halfExtents) {
  const half = toVec3(halfExtents);
  if (!(half[0] > 0 && half[1] > 0 && half[2] > 0)) {
    throw new Error('boxShape: полуразмеры должны быть больше нуля');
  }
  return {
    type: 'box',
    halfExtents: half,
    spheres: [],
    boxes: [{
      offset: [0, 0, 0],
      halfExtents: half,
      boundingRadius: Math.hypot(half[0], half[1], half[2])
    }],
    boundingRadius: Math.hypot(half[0], half[1], half[2])
  };
}

/** Локальные сферы тела: у простого бокса их нет. */
function localSpheres(body) {
  const shape = body.shape;
  if (!shape || shape.type === 'box') return [];
  return shape.spheres || [];
}

/** Локальные боксы тела: у простого бокса — он сам. */
function localBoxes(body) {
  const shape = body.shape;
  if (!shape) return [];
  if (shape.type === 'box') return shape.boxes || [{ offset: [0, 0, 0], halfExtents: shape.halfExtents }];
  return shape.boxes || [];
}

/**
 * Радиус описывающей сферы части бокса. Новые части хранят его заранее,
 * старые/внешние описания считаются по полуразмерам.
 * @param {{boundingRadius?: number, halfExtents: number[]}} part
 * @returns {number}
 */
function boxPartRadius(part) {
  if (Number.isFinite(part.boundingRadius) && part.boundingRadius > 0) return part.boundingRadius;
  const half = part.halfExtents || [0, 0, 0];
  return Math.hypot(half[0], half[1], half[2]);
}

/** Мировая точка по локальному смещению тела. */
function worldPoint(body, offset) {
  const rotated = quatRotate(body.quaternion, offset);
  return [
    body.position[0] + rotated[0],
    body.position[1] + rotated[1],
    body.position[2] + rotated[2]
  ];
}

function sphereCenter(body, sphere) {
  const offset = quatRotate(body.quaternion, sphere.offset);
  return [
    body.position[0] + offset[0],
    body.position[1] + offset[1],
    body.position[2] + offset[2]
  ];
}

/**
 * Мировые центры и радиусы сфер тела. Удобно для отладки и запросов.
 * @returns {Array<{center: number[], radius: number}>}
 */
export function getWorldSpheres(body) {
  return body.shape.spheres.map((sphere) => ({
    center: sphereCenter(body, sphere),
    radius: sphere.radius
  }));
}

/**
 * Мировые габариты боксов тела. Удобно для отладки и запросов.
 * @returns {Array<{center: number[], halfExtents: number[], quaternion: number[]}>}
 */
export function getWorldBoxes(body) {
  return localBoxes(body).map((part) => ({
    center: worldPoint(body, part.offset),
    halfExtents: part.halfExtents.slice(),
    quaternion: body.quaternion.slice()
  }));
}

export {
  clamp,
  numberOr,
  toVec3,
  normalizeQuat,
  localSpheres,
  localBoxes,
  boxPartRadius,
  worldPoint,
  sphereCenter
};
