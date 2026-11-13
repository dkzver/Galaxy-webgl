/**
 * @fileoverview Снаряды из префабов: полёт, свип-попадания и срок жизни.
 *
 * Ракета не становится физическим телом: при 95 м/с дискретное тело за кадр
 * проходит около 1.5 м и проскакивает тонкие стенки. Вместо этого отрезок
 * «было → стало» проверяется свипом сферы по сферам и боксам тел сцены.
 *
 * Модуль не знает про DOM и WebGL: физика контактов берётся из physics/shapes,
 * пул и рантайм префабов приходят снаружи. Логика проверяется в node --test.
 */

import { quatConjugate, quatFromDirection, quatRotate } from './math.js';
import { getWorldBoxes, getWorldSpheres } from './physics/shapes.js';

// Реэкспорт: quatFromDirection переехал в math.js, но импорт из снарядов остаётся рабочим
export { quatFromDirection };

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Нормировать вектор; нулевой становится -Z — направлением «вперёд». */
export function normalizeDirection(vector) {
  const length = Math.hypot(vector?.[0] || 0, vector?.[1] || 0, vector?.[2] || 0);
  if (length < 1e-9) return [0, 0, -1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Расстояние от точки до отрезка [a, b].
 */
export function distancePointToSegment(point, a, b) {
  const ab = sub(b, a);
  const lengthSq = dot(ab, ab);
  if (lengthSq < 1e-12) return Math.hypot(point[0] - a[0], point[1] - a[1], point[2] - a[2]);

  const t = clamp(dot(sub(point, a), ab) / lengthSq, 0, 1);
  const closest = add(a, scale(ab, t));
  return Math.hypot(point[0] - closest[0], point[1] - closest[1], point[2] - closest[2]);
}

/**
 * Пересечение отрезка (сферы радиуса radius, движущейся по отрезку)
 * со сферой. Возвращает ближайшую точку входа или null.
 * @returns {{t:number, point:number[], normal:number[], kind:string}|null}
 */
export function segmentSphere(prev, next, radius, center, sphereRadius) {
  const reach = radius + sphereRadius;
  const m = sub(prev, center);
  const d = sub(next, prev);
  const a = dot(d, d);
  const c = dot(m, m) - reach * reach;

  if (a < 1e-12) {
    if (c > 0) return null;
    const normal = normalizeDirection(sub(prev, center));
    return { t: 0, point: prev.slice(), normal, kind: 'sphere' };
  }

  const b = dot(m, d);
  const disc = b * b - a * c;
  if (disc < 0) return null;

  const sqrt = Math.sqrt(disc);
  let t = (-b - sqrt) / a;
  if (t < 0) t = (-b + sqrt) / a;
  if (t < 0 || t > 1) return null;

  const point = add(prev, scale(d, t));
  const normal = normalizeDirection(sub(point, center));
  return { t, point, normal, kind: 'sphere' };
}

/**
 * Пересечение движущейся сферы с OBB (бокс + кватернион).
 * Полуразмеры расширяются на радиус сферы — консервативно на углах,
 * для снаряда это допустимо и дешевле точного теста.
 * @returns {{t:number, point:number[], normal:number[], kind:string}|null}
 */
export function segmentBox(prev, next, radius, center, halfExtents, quaternion) {
  const inverse = quatConjugate(quaternion || [0, 0, 0, 1]);
  const localPrev = quatRotate(inverse, sub(prev, center));
  const localNext = quatRotate(inverse, sub(next, center));
  const direction = sub(localNext, localPrev);

  let tMin = 0;
  let tMax = 1;
  let axis = -1;
  let sign = 1;

  for (let i = 0; i < 3; i++) {
    const extent = halfExtents[i] + radius;
    if (Math.abs(direction[i]) < 1e-9) {
      if (Math.abs(localPrev[i]) > extent) return null;
      continue;
    }

    let t1 = (-extent - localPrev[i]) / direction[i];
    let t2 = (extent - localPrev[i]) / direction[i];
    let normalSign = -1;

    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      normalSign = 1;
    }

    if (t1 > tMin) {
      tMin = t1;
      axis = i;
      sign = normalSign;
    }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }

  if (tMin < 0 || tMin > 1) return null;

  const point = add(prev, scale(sub(next, prev), tMin));
  if (axis < 0) {
    // Старт внутри бокса: нормаль — против движения.
    return { t: tMin, point, normal: normalizeDirection(scale(direction, -1)), kind: 'box' };
  }

  const localNormal = [0, 0, 0];
  localNormal[axis] = sign;
  return {
    t: tMin,
    point,
    normal: quatRotate(quaternion || [0, 0, 0, 1], localNormal),
    kind: 'box'
  };
}

/**
 * Ближайшее попадание по телу за отрезок.
 * @param {number[]} prev
 * @param {number[]} next
 * @param {number} radius
 * @param {object} body
 * @returns {{t:number, point:number[], normal:number[], kind:string, body:object}|null}
 */
export function sweepBody(prev, next, radius, body) {
  if (!body?.shape) return null;

  let best = null;

  for (const sphere of getWorldSpheres(body)) {
    const hit = segmentSphere(prev, next, radius, sphere.center, sphere.radius);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, body };
  }

  for (const box of getWorldBoxes(body)) {
    const hit = segmentBox(prev, next, radius, box.center, box.halfExtents, box.quaternion);
    if (hit && (!best || hit.t < best.t)) best = { ...hit, body };
  }

  return best;
}

/** Тела, которые снаряд игнорирует: стрелок, его предки и потомки. */
function collectIgnore(owner) {
  const ignore = new Set();
  if (!owner) return ignore;

  // Корпус — часто на корне, а owner — его меш-ребёнок: поднимаемся до корня.
  let top = owner;
  while (top.parent) top = top.parent;

  const walk = (entity) => {
    if (!entity) return;
    if (entity.body) ignore.add(entity.body);
    for (const child of entity.children || []) walk(child);
  };
  walk(top);

  return ignore;
}

/**
 * Система снарядов: занимает экземпляры из пула, ведёт полёт и попадания.
 *
 * @param {object} options
 * @param {object} options.physics мир с bodies
 * @param {object|null} [options.effects] система эффектов (spawn)
 * @param {object[]} [options.entities] сущности сцены
 * @param {object} options.pool пул экземпляров (acquire/release/mount)
 * @param {number} [options.maxDistance] предел полёта, м
 * @param {Function|null} [options.onHit] коллбек попадания: получает тело, точку и снаряд
 */
export function createProjectileSystem({ physics, effects = null, entities = [], pool, maxDistance = 5000, onHit = null }) {
  const active = [];
  const stats = { fired: 0, rejected: 0, hits: 0, expired: 0 };

  function sweep(prev, next, instance) {
    let best = null;
    if (!physics?.bodies) return null;

    for (const body of physics.bodies) {
      if (!body || !body.shape) continue;
      if (instance.ignore?.has(body)) continue;

      const entity = body.userData?.entity || null;
      if (entity && (entity.visible === false || entity.removed)) continue;
      if (entity?.trigger) continue;

      // Широкая фаза: расстояние до отрезка против описывающей сферы.
      const reach = instance.radius + (body.shape.boundingRadius || 0);
      if (distancePointToSegment(body.position, prev, next) > reach) continue;

      const hit = sweepBody(prev, next, instance.radius, body);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }

    return best;
  }

  function release(instance) {
    instance.dead = true;
    instance.active = false;
    const index = active.indexOf(instance);
    if (index >= 0) active.splice(index, 1);
    pool.release(instance);
  }

  function fire(options = {}) {
    const instance = pool.acquire();
    if (!instance) {
      stats.rejected += 1;
      return null;
    }

    const config = instance.projectile || {};
    const direction = normalizeDirection(options.direction);

    instance.position = (options.from || [0, 0, 0]).slice(0, 3);
    instance.direction = direction;
    instance.speed = clamp(numberOr(options.speed, config.speed ?? 95), 1, 5000);
    instance.life = clamp(numberOr(options.life, config.life ?? 6), 0.05, 60);
    instance.radius = clamp(numberOr(options.radius, config.radius ?? 0.4), 0.02, 10);
    instance.impulse = Math.max(0, numberOr(options.impulse, config.impulse ?? 0));
    instance.impact = options.impact || config.impact || null;
    instance.trail = options.trail || config.trail || null;
    instance.age = 0;
    instance.traveled = 0;
    instance.dead = false;
    instance.active = true;
    instance.hit = null;
    instance.ignore = collectIgnore(options.owner || null);

    const root = instance.root;
    if (root) {
      root.position = instance.position.slice();
      root.quaternion = quatFromDirection(direction);
      root.visible = true;
      if (root.raw) root.raw.visible = true;
    }

    active.push(instance);
    pool.mount(instance);
    stats.fired += 1;
    return instance;
  }

  function update(dt) {
    if (!active.length) return;
    const step = clamp(numberOr(dt, 0), 0, 0.1);

    for (let index = active.length - 1; index >= 0; index--) {
      const instance = active[index];
      if (instance.dead) {
        active.splice(index, 1);
        continue;
      }

      instance.age += step;
      if (instance.age >= instance.life) {
        stats.expired += 1;
        release(instance);
        continue;
      }

      // Дробим шаг: смещение на подшаг не больше половины радиуса —
      // так снаряд не перепрыгивает два тонких объекта подряд.
      const distance = instance.speed * step;
      const chunk = Math.max(1e-4, instance.radius * 0.5);
      const substeps = clamp(Math.ceil(distance / chunk), 1, 64);
      const piece = distance / substeps;

      let hit = null;
      for (let sub = 0; sub < substeps; sub++) {
        const prev = instance.position.slice();
        const next = add(prev, scale(instance.direction, piece));
        hit = sweep(prev, next, instance);

        if (hit) {
          instance.position = hit.point;
          instance.traveled += piece * hit.t;
          break;
        }

        instance.position = next;
        instance.traveled += piece;
        if (instance.traveled > maxDistance) break;
      }

      if (hit) {
        instance.hit = { point: hit.point, normal: hit.normal, kind: hit.kind, body: hit.body };
        stats.hits += 1;

        if (effects && instance.impact) {
          effects.spawn(instance.impact, {
            position: hit.point.slice(),
            params: { direction: instance.direction.slice() }
          });
        }

        if (hit.body?.isDynamic && instance.impulse > 0) {
          hit.body.applyImpulse(scale(instance.direction, instance.impulse), hit.point);
        }

        // Событие попадания для скриптов сцены (щит, урон, звук)
        if (typeof onHit === 'function') {
          onHit({
            entity: hit.body?.userData?.entity || null,
            body: hit.body,
            point: hit.point.slice(),
            normal: hit.normal.slice(),
            kind: hit.kind,
            direction: instance.direction.slice(),
            speed: instance.speed,
            projectile: instance.prefab || null
          });
        }

        release(instance);
        continue;
      }

      if (instance.traveled > maxDistance) {
        stats.expired += 1;
        release(instance);
        continue;
      }

      if (instance.root) {
        instance.root.position = instance.position.slice();
        instance.root.quaternion = quatFromDirection(instance.direction);
      }
    }
  }

  function clear() {
    for (let index = active.length - 1; index >= 0; index--) release(active[index]);
  }

  return {
    fire,
    update,
    clear,
    active,
    stats: () => ({
      ...stats,
      active: active.length,
      ...(typeof pool.stats === 'function' ? pool.stats() : {})
    })
  };
}
