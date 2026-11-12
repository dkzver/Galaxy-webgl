// Рантайм сцены: превращает данные из scene.js в объекты сцены —
// меши, матрицы, физические тела и точки для добычи.
//
// Рендер живёт в main.js: здесь только состояние. Примитивы и модели
// складываются в один формат «model.parts», поэтому рисуются одним кодом.

import { M4, quatFromAxisAngle, quatFromMat4, quatMul, quatToMat4 } from './math.js';
import { createMesh } from './gl.js';
import { boxGeometry, cylinderGeometry, sphereGeometry, wedgeGeometry } from './geometry.js';
import { loadBinaryModel } from './ship.js';
import { createMeshHitTest } from './mining.js';
import { boxShape, compoundShape, sphereShape } from './physics.js';
import { eulerToQuat } from './scene.js';

const assetCache = new Map();

function hexToRgb(hex, fallback = [1, 1, 1]) {
  if (typeof hex !== 'string') return fallback.slice();
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6) return fallback.slice();
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return fallback.slice();
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Ассет из public/models: манифест <id>.json + <id>.mesh.bin. */
export async function loadAsset(gl, id, options = {}) {
  const key = `${id}|${options.triangles ? 'tris' : 'mesh'}`;
  if (assetCache.has(key)) return assetCache.get(key);

  const promise = loadBinaryModel(gl, `models/${id}.json`, `models/${id}.mesh.bin`, id, options)
    .then((model) => {
      if (!model) throw new Error(`Ассет «${id}» не найден: public/models/${id}.json`);
      return model;
    });

  assetCache.set(key, promise);
  return promise;
}

function primitiveGeometry(entity) {
  const [sx, sy, sz] = entity.size;

  switch (entity.shape) {
    case 'sphere':
      return sphereGeometry(sx / 2, sy / 2, sz / 2, entity.segments, entity.rings);
    case 'cylinder':
      return cylinderGeometry(sx / 2, sz, entity.segments);
    case 'wedge':
      return wedgeGeometry([sx, sy, sz], entity.tip);
    case 'box':
    default:
      return boxGeometry([sx, sy, sz]);
  }
}

function materialPart(entity, mesh) {
  return {
    name: entity.id,
    mesh,
    matrix: M4.identity(),
    color: hexToRgb(entity.material.color, [0.54, 0.58, 0.65]),
    tint: hexToRgb(entity.material.tint, [1, 1, 1]),
    emissive: hexToRgb(entity.material.emissive, [0, 0, 0]),
    specular: entity.material.specular,
    metal: entity.material.metal,
    material: null,
    blend: entity.blend || 'opaque',
    depthWrite: entity.depthWrite !== false
  };
}

function worldScaleOf(scale) {
  return Math.max(scale[0], scale[1], scale[2]);
}

async function buildEntity(gl, raw, parent, flat, options) {
  // Скрытый объект не участвует в игре: ни меша, ни тела, ни скриптов, ни детей.
  // В редакторе его всё равно строим, чтобы можно было выбрать и вернуть.
  if (raw.visible === false && !options.includeHidden) return null;

  const entity = {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    raw,
    parent,
    children: [],
    position: raw.position.slice(),
    pos: null, // заполним ссылкой на position: так ждёт mining.js
    rotation: raw.rotation.slice(),
    scale: raw.scale.slice(),
    baseQuaternion: eulerToQuat(raw.rotation),
    quaternion: eulerToQuat(raw.rotation),
    spinAngle: 0,
    angle: (raw.rotation[1] || 0) * Math.PI / 180,
    matrix: M4.identity(),
    model: null,
    body: null,
    radius: 0,
    hitTest: null,
    mining: raw.mining || null,
    glow: raw.glow || null,
    glowColor: raw.glow ? hexToRgb(raw.glow.color, [0.22, 0.78, 1]) : null,
    trigger: raw.trigger || null,
    projectile: raw.projectile || null,
    hud: raw.hud || null,
    camera: raw.camera || null,
    spawn: raw.spawn || null,
    bot: raw.bot || null,
    scripts: raw.scripts,
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    partScripts: raw.partScripts,
    visible: raw.visible,
    tags: raw.tags
  };

  entity.pos = entity.position;
  entity.scaleUniform = worldScaleOf(raw.scale);

  if (raw.type === 'model' || raw.type === 'bot') {
    const wantsTriangles = Boolean(raw.mining) || raw.type === 'bot';
    const model = await loadAsset(gl, raw.asset, { triangles: wantsTriangles });
    entity.model = model;
    entity.radius = (model.radius || 5) * entity.scaleUniform;

    if (raw.mining) {
      // mining.js ждёт объект с pos/angle/scale — отдаём адаптер,
      // чтобы логика добычи не зависела от формата сцены
      const rockView = {
        pos: entity.position,
        get angle() { return entity.angle; },
        get scale() { return entity.scaleUniform; }
      };
      entity.hitTest = model.triangles ? createMeshHitTest(rockView, model.triangles) : null;
      entity.mining = raw.mining;
    }
  }

  if (raw.type === 'primitive') {
    const mesh = createMesh(gl, primitiveGeometry(raw));
    entity.model = { id: raw.id, parts: [materialPart(raw, mesh)] };
    entity.radius = Math.max(
      Math.abs(raw.size[0]), Math.abs(raw.size[1]), Math.abs(raw.size[2])
    ) * 0.5 * entity.scaleUniform;
  }

  flat.push(entity);
  if (parent) parent.children.push(entity);
  options.progress?.();

  for (const childRaw of raw.children) {
    await buildEntity(gl, childRaw, entity, flat, options);
  }

  return entity;
}

/** Построить все сущности сцены. Возвращает плоский список (родители раньше детей). */
export async function buildScene(gl, scene, options = {}) {
  const flat = [];

  // Сколько объектов реально будет построено — для прогресса загрузки
  let total = 0;
  const count = (list) => {
    for (const raw of list) {
      if (raw.visible === false && !options.includeHidden) continue;
      total++;
      count(raw.children || []);
    }
  };
  count(scene.entities);

  let done = 0;
  const progress = () => {
    done++;
    options.onProgress?.(done, Math.max(1, total));
  };

  for (const raw of scene.entities) {
    await buildEntity(gl, raw, null, flat, { ...options, progress });
  }

  updateMatrices(flat);

  // Эффекты привязываются после матриц: auto-инстансы сразу знают мировую точку.
  if (options.effects) {
    for (const entity of flat) options.effects.registerEntity(entity);
  }

  return flat;
}

function localMatrix(entity) {
  return M4.mul(
    M4.translation(entity.position[0], entity.position[1], entity.position[2]),
    M4.mul(
      quatToMat4(entity.quaternion),
      M4.scaling(entity.scale[0], entity.scale[1], entity.scale[2])
    )
  );
}

/** Пересчитать мировые матрицы. Список идёт сверху вниз, поэтому родитель уже готов. */
export function updateMatrices(entities) {
  for (const entity of entities) {
    const local = localMatrix(entity);
    entity.matrix = entity.parent ? M4.mul(entity.parent.matrix, local) : local;
    entity.pos = entity.position;
  }
}

/** Вращение и движение: фиксированные объекты крутятся, динамические следуют за телом. */
export function updateScene(entities, dt) {
  for (const entity of entities) {
    if (entity.body?.isDynamic) {
      for (let i = 0; i < 3; i++) entity.position[i] = entity.body.position[i];
      entity.quaternion = entity.body.quaternion.slice();
      entity.angle = 0; // у динамических камней поворот уже в кватернионе
    }

    if (entity.raw.spin) {
      entity.spinAngle += entity.raw.spin.speed * dt;
      entity.quaternion = quatMul(
        quatFromAxisAngle(entity.raw.spin.axis, entity.spinAngle),
        entity.baseQuaternion
      );
      entity.angle = entity.spinAngle + (entity.rotation[1] || 0) * Math.PI / 180;

      if (entity.body) entity.body.setQuaternion(entity.quaternion);
    }
  }

  updateMatrices(entities);
  syncAttachedBodies(entities);
}

/**
 * Жёсткая связь: тело ребёнка каждый кадр ставится по мировой матрице.
 * Без этого коллайдер остался бы там, где родитель был при загрузке сцены,
 * хотя картинка уже уехала вместе с родителем.
 */
export function syncAttachedBodies(entities) {
  for (const entity of entities) {
    if (!entity.body || !entity.parent) continue;

    const matrix = entity.matrix;
    entity.body.setPosition([matrix[12], matrix[13], matrix[14]]);
    entity.body.setQuaternion(quatFromMat4(matrix));
  }
}

function modelOf(entity) {
  if (entity.model) return entity.model;

  for (const child of entity.children || []) {
    const model = modelOf(child);
    if (model) return model;
  }

  return null;
}

/** Корпус по модели: набор сфер, как у корабля в main.js. */
function compoundFromModel(model, scale) {
  const collision = model?.collision;
  if (collision?.points?.length && collision.radius > 0) {
    return compoundShape(collision.points.map((offset) => ({
      offset: offset.map((value) => value * scale),
      radius: collision.radius * scale
    })));
  }

  const length = model?.length || 7.4;
  const radius = Math.max(0.8, length * 0.22) * scale;
  const offset = length * 0.28 * scale;
  return compoundShape([
    { offset: [0, 0, -offset], radius },
    { offset: [0, 0, 0], radius },
    { offset: [0, 0, offset], radius }
  ]);
}

function shapeFor(entity, collider) {
  const scale = entity.scaleUniform;

  if (collider) {
    const center = Array.isArray(collider.offset)
      ? collider.offset.slice(0, 3).map((value) => (Number(value) || 0) * scale)
      : [0, 0, 0];
    const shifted = center.some((value) => Math.abs(value) > 1e-9);

    // Коллайдер задан в локальных единицах: без масштаба у уменьшенной
    // модели остаётся прежний огромный объём, а картинка с ним не сходится
    if (collider.shape === 'box') {
      const half = collider.halfExtents.map((value) => value * scale);
      return shifted
        ? compoundShape([{ type: 'box', offset: center, halfExtents: half }])
        : boxShape(half);
    }
    if (collider.shape === 'compound') {
      const parts = [];

      for (const sphere of collider.spheres || []) {
        parts.push({
          offset: sphere.offset.map((value) => value * scale),
          radius: sphere.radius * scale
        });
      }

      for (const box of collider.boxes || []) {
        parts.push({
          type: 'box',
          offset: box.offset.map((value) => value * scale),
          halfExtents: box.halfExtents.map((value) => value * scale)
        });
      }

      return compoundShape(parts);
    }

    const radius = collider.radius * scale;
    return shifted
      ? compoundShape([{ offset: center, radius }])
      : sphereShape(radius);
  }

  // Коллайдер не задан — берём габарит по мешу
  // Коллайдер не задан: собираем корпус по модели — своей или вложенной
  const model = modelOf(entity);
  if (model) return compoundFromModel(model, scale);

  return sphereShape(Math.max(0.5, entity.radius));
}

/** Создать физические тела для сущностей, у которых описано body. */
export function attachBodies(entities, physics) {
  for (const entity of entities) {
    const body = entity.raw.body;
    if (!body || entity.body) continue;

    // У ребёнка позиция локальная, а тело живёт в мире: берём мировую матрицу.
    // Дальше syncAttachedBodies каждый кадр ведёт тело за родителем.
    const world = entity.matrix;

    entity.body = physics.addBody({
      name: entity.id,
      type: body.kind === 'dynamic' ? 'dynamic' : 'static',
      mass: body.kind === 'dynamic' ? body.mass : 0,
      position: [world[12], world[13], world[14]],
      quaternion: quatFromMat4(world),
      restitution: body.restitution,
      friction: body.friction,
      lockRotation: body.lockRotation,
      shape: shapeFor(entity, body.collider),
      userData: { kind: 'scene', entityId: entity.id, entity }
    });

    // Корпус и его жёстко прикреплённые детали не сталкиваются друг с другом
    let ancestor = entity.parent;
    while (ancestor) {
      if (ancestor.body) {
        entity.body.ignores.add(ancestor.body);
        ancestor.body.ignores.add(entity.body);
      }
      ancestor = ancestor.parent;
    }
  }
}

/**
 * Подписать impact-эффекты сущностей на физические удары.
 * Возвращает функцию отписки.
 * @param {Array<object>} entities
 * @param {object} physics
 * @param {object} effects
 * @returns {Function}
 */
export function bindEffectTriggers(entities, physics, effects) {
  if (!physics?.on || !effects?.play) return () => {};

  const impactEntities = new Set();
  for (const entity of entities) {
    if (!entity.body) continue;
    if ((entity.effects || []).some((slot) => slot.trigger === 'impact')) impactEntities.add(entity);
  }

  if (!impactEntities.size) return () => {};

  return physics.on('impact', (event) => {
    for (const entity of impactEntities) {
      if (entity.body !== event.a && entity.body !== event.b) continue;

      for (const slot of entity.effects || []) {
        if (slot.trigger !== 'impact') continue;
        effects.play(entity, slot.id, {
          hitPoint: event.point.slice(),
          normal: event.normal.slice(),
          intensity: event.speed
        });
      }
    }
  });
}

/** Радиус зоны добычи вокруг камня. */
export function miningZoneRadius(entity) {
  const zone = entity.mining;
  if (!zone) return 0;
  if (zone.zoneRadius > 0) return zone.zoneRadius;

  const collider = entity.raw.body?.collider;
  const base = collider?.shape === 'sphere'
    ? collider.radius * entity.scaleUniform
    : (entity.model?.radius || 1) * entity.scaleUniform;

  return base * (zone.zoneScale || 2);
}

/** Проверка попадания точки в триггер (пока в локальных осях объёма). */
export function triggerContains(entity, point) {
  if (!entity.trigger) return false;

  const offset = [
    point[0] - entity.position[0],
    point[1] - entity.position[1],
    point[2] - entity.position[2]
  ];

  if (entity.trigger.shape === 'sphere') {
    return Math.hypot(offset[0], offset[1], offset[2]) <= entity.trigger.radius * entity.scaleUniform;
  }

  const half = entity.trigger.size.map((value) => value * entity.scaleUniform * 0.5);
  return Math.abs(offset[0]) <= half[0] && Math.abs(offset[1]) <= half[1] && Math.abs(offset[2]) <= half[2];
}
