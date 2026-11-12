/**
 * @fileoverview Префабы: чистые операции над данными.
 *
 * Модуль не знает про DOM, WebGL и физику — его можно запускать в node --test.
 * Здесь три вещи:
 *   1. нормализация блока `projectile` (баллистика снаряда из префаба);
 *   2. глубокий клон префаба с новыми id — поддерево можно вставить в сцену
 *      несколько раз;
 *   3. применение трансформа спавна к корню клона.
 *
 * Импорт только из math.js: scene.js сам импортирует normalizeProjectile,
 * поэтому обратная зависимость дала бы цикл модулей.
 */

import { quatFromAxisAngle, quatMul, quatNormalize } from './math.js';

const DEG = Math.PI / 180;

const RANGES = {
  speed: { min: 10, max: 1000, fallback: 95 },
  life: { min: 0.5, max: 30, fallback: 6 },
  radius: { min: 0.05, max: 5, fallback: 0.4 },
  turnRate: { min: 0, max: 20, fallback: 0 },
  damage: { min: 0, max: 1e6, fallback: 0 },
  impulse: { min: 0, max: 1e6, fallback: 0 }
};

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampTo(value, range) {
  const number = numberOr(value, range.fallback);
  return Math.min(range.max, Math.max(range.min, number));
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Нормализовать блок `projectile` префаба.
 * Возвращает null, если блока нет: обычный префаб снарядом не считается.
 * @param {object|null|undefined} raw
 * @returns {{speed:number, life:number, radius:number, turnRate:number, damage:number, impulse:number, impact:string|null, trail:string|null}|null}
 */
export function normalizeProjectile(raw) {
  if (!raw || typeof raw !== 'object') return null;

  return {
    speed: clampTo(raw.speed, RANGES.speed),
    life: clampTo(raw.life, RANGES.life),
    radius: clampTo(raw.radius, RANGES.radius),
    turnRate: clampTo(raw.turnRate, RANGES.turnRate),
    damage: clampTo(raw.damage, RANGES.damage),
    impulse: clampTo(raw.impulse, RANGES.impulse),
    impact: textOrNull(raw.impact),
    trail: textOrNull(raw.trail)
  };
}

/** Есть ли у сырой сущности блок снаряда. */
export function isProjectile(raw) {
  return Boolean(raw && typeof raw === 'object' && raw.projectile && typeof raw.projectile === 'object');
}

/** Углы Эйлера в градусах → кватернион (порядок X, Y, Z — как в scene.js). */
function eulerToQuat(rotation = [0, 0, 0]) {
  const x = (Number(rotation[0]) || 0) * DEG;
  const y = (Number(rotation[1]) || 0) * DEG;
  const z = (Number(rotation[2]) || 0) * DEG;

  return quatNormalize(
    quatMul(
      quatMul(quatFromAxisAngle([0, 1, 0], y), quatFromAxisAngle([1, 0, 0], x)),
      quatFromAxisAngle([0, 0, 1], z)
    )
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toVec3(value, fallback) {
  if (Array.isArray(value)) {
    return [0, 1, 2].map((axis) => numberOr(value[axis], fallback[axis]));
  }
  return fallback.slice();
}

function normalizeScale(value) {
  if (Array.isArray(value)) {
    return [0, 1, 2].map((axis) => Math.abs(numberOr(value[axis], 1)) || 1);
  }
  const uniform = Math.abs(numberOr(value, 1)) || 1;
  return [uniform, uniform, uniform];
}

/**
 * Привести узел к формату scene-runtime: массивы трансформа, флаг видимости
 * и массив детей. Префабы пишутся руками, поэтому `scale: 1` — норма.
 */
function normalizeNode(entity) {
  entity.position = toVec3(entity.position, [0, 0, 0]);
  entity.rotation = toVec3(entity.rotation, [0, 0, 0]);
  entity.scale = normalizeScale(entity.scale);
  entity.visible = entity.visible !== false;
  if (!Array.isArray(entity.children)) entity.children = [];
}

let spawnCounter = 0;

function nextIdFactory(prefix) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

/**
 * Глубокий клон префаба под вставку в сцену.
 *
 * @param {object} doc документ префаба (`{ id, entities: [...] }`)
 * @param {object} [options]
 * @param {number[]} [options.position] мировая точка корня
 * @param {number[]} [options.rotation] углы Эйлера корня в градусах
 * @param {number|number[]} [options.scale] масштаб корня
 * @param {boolean} [options.visible] видимость корня (для пула — false)
 * @param {string} [options.idPrefix] префикс id; по умолчанию `<id>-<n>`
 * @returns {{entities: object[], root: object, projectile: object|null, id: string}}
 */
export function preparePrefab(doc, options = {}) {
  if (!doc || !Array.isArray(doc.entities) || !doc.entities.length) {
    throw new Error('префаб: нет ни одной сущности');
  }

  const entities = clone(doc.entities);
  const prefix = options.idPrefix || `${doc.id || 'prefab'}-${++spawnCounter}`;
  const makeId = nextIdFactory(prefix);

  const assign = (list) => {
    for (const entity of list) {
      entity.id = makeId();
      normalizeNode(entity);
      assign(entity.children);
    }
  };
  assign(entities);

  const root = entities[0];
  root.position = Array.isArray(options.position) ? options.position.slice(0, 3).map((v) => numberOr(v, 0)) : [0, 0, 0];
  root.rotation = Array.isArray(options.rotation) ? options.rotation.slice(0, 3).map((v) => numberOr(v, 0)) : [0, 0, 0];

  if (options.scale != null) {
    const scale = Array.isArray(options.scale)
      ? options.scale.slice(0, 3).map((v) => numberOr(v, 1))
      : (() => {
        const uniform = numberOr(options.scale, 1);
        return [uniform, uniform, uniform];
      })();
    root.scale = scale;
  }

  if (options.visible === false) {
    root.visible = false;
  }

  return {
    entities,
    root,
    projectile: normalizeProjectile(root.projectile),
    id: root.id
  };
}

/** Сбросить счётчик id — только для тестов. */
export function resetSpawnCounter() {
  spawnCounter = 0;
}

export { eulerToQuat };
