/**
 * @fileoverview Зрение бота: конус обзора, упреждение и доворот.
 *
 * Чистые функции без DOM и физики — проверяются в node --test.
 * Скрипт `aim-attack.js` использует их, но модуль годится и для других
 * поведений: патруль, турель, сопровождающий.
 */

import { quatFromAxisAngle, quatFromDirection, quatMul, quatNormalize, quatRotate } from '../../js/math.js';

const FORWARD = [0, 0, -1];

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v);
  return len < 1e-9 ? [0, 0, -1] : [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

/** Куда смотрит нос сущности: локальная ось forward, повёрнутая кватернионом. */
export function forwardOf(quaternion, forward = FORWARD) {
  return quatRotate(quaternion || [0, 0, 0, 1], forward);
}

/** Угол между направлениями, радианы. */
export function angleBetween(a, b) {
  return Math.acos(Math.min(1, Math.max(-1, dot(normalize(a), normalize(b)))));
}

/**
 * Попадает ли цель в конус обзора.
 * @param {{position:number[], forward:number[], target:number[], range:number, halfAngle:number}} options
 * @returns {boolean}
 */
export function inVisionCone({ position, forward, target, range, halfAngle }) {
  const to = sub(target, position);
  const distance = length(to);

  if (distance > range) return false;
  if (distance < 1e-6) return true;

  return angleBetween(forward, to) <= halfAngle;
}

/**
 * Точка прицеливания с упреждением по скорости цели.
 * @param {number[]} position позиция стрелка
 * @param {number[]} target позиция цели
 * @param {number[]} velocity скорость цели, м/с
 * @param {number} projectileSpeed скорость снаряда, м/с
 * @param {number} lead 0…1 — доля полного упреждения
 */
export function predictAimPoint(position, target, velocity, projectileSpeed, lead = 1) {
  const distance = length(sub(target, position));
  const travel = distance / Math.max(1e-3, projectileSpeed);
  const time = travel * Math.min(1, Math.max(0, lead));

  return [
    target[0] + (velocity?.[0] || 0) * time,
    target[1] + (velocity?.[1] || 0) * time,
    target[2] + (velocity?.[2] || 0) * time
  ];
}

/** Кватернион, при котором нос смотрит в direction. */
export function quatLookAt(direction, forward = FORWARD) {
  return quatFromDirection(direction, forward);
}

/**
 * Довернуть текущую ориентацию к direction не быстрее maxAngle (радианы).
 * Если цель уже в пределах шага — возвращает точную ориентацию.
 */
export function turnToward(current, direction, maxAngle, forward = FORWARD) {
  const desired = quatLookAt(direction, forward);
  const currentForward = forwardOf(current, forward);
  const angle = angleBetween(currentForward, direction);

  if (angle <= maxAngle || angle < 1e-6) return desired;

  const rawAxis = cross(currentForward, normalize(direction));
  const axisLength = length(rawAxis);

  if (axisLength < 1e-6) {
    // Ровно 180°: любая перпендикулярная ось даёт плавный доворот.
    const fallback = Math.abs(currentForward[1]) < 0.9
      ? normalize(cross(currentForward, [0, 1, 0]))
      : normalize(cross(currentForward, [1, 0, 0]));
    return quatNormalize(quatMul(quatFromAxisAngle(fallback, maxAngle), current));
  }

  const axis = [rawAxis[0] / axisLength, rawAxis[1] / axisLength, rawAxis[2] / axisLength];

  // Доворот в мировых осях: производная ориентация умножается слева.
  return quatNormalize(quatMul(quatFromAxisAngle(axis, maxAngle), current));
}
