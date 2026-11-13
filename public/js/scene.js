// Формат сцены GalaxyDemo.
//
// Здесь только данные: разбор JSON, значения по умолчанию и проверки.
// Ни WebGL, ни DOM — поэтому модуль можно проверять тестами в Node.
//
// Сцена — это дерево сущностей (entities). У каждой есть тип, трансформ,
// необязательное физическое тело и необязательные скрипты:
//
//   model      — ассет из public/models (корабли, астероиды, импорт)
//   primitive  — примитив: box / sphere / cylinder / wedge
//   trigger    — объём-триггер, событий входа/выхода
//   spawn      — точка появления корабля или бота
//   bot        — бот с архетипом и скриптом поведения
//   hud        — HTML-слой интерфейса из public/hud; движок только вставляет его
//                в контейнер сцены, положение задаёт сам HTML/CSS
//   camera     — камера сцены: fov / near / far. Пока это объект с
//                параметрами и маркером, поведение задают скрипты
//   empty      — пустой узел: трансформ и скрипты без геометрии, внутрь
//                кладутся модели и другие узлы (дети наследуют трансформ)

import { quatFromAxisAngle, quatMul, quatNormalize } from './math.js';
import { normalizeProjectile } from './prefabs.js';
import { normalizeReticleConfig } from './reticles.js';

export const SCENE_VERSION = 1;
/** Тип корневого объекта сцены: он один, его нельзя удалить. */
export const SCENE_ROOT_TYPE = 'scene';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export const DEFAULT_MATERIAL = {
  color: '#8a95a6',
  tint: '#ffffff',
  emissive: '#000000',
  metal: 0.4,
  specular: 1,
  textured: true
};

export const DEFAULT_BODY = {
  kind: 'static',
  mass: 0,
  restitution: 0.55,
  friction: 0.2,
  lockRotation: true
};

/** Углы Эйлера в градусах → кватернион. Порядок: X, затем Y, затем Z. */
export function eulerToQuat(rotation = [0, 0, 0]) {
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

/** Кватернион → углы Эйлера в градусах (порядок тот же, что в eulerToQuat). */
export function quatToEuler(quaternion) {
  const [x, y, z, w] = quaternion;

  const r00 = 1 - 2 * (y * y + z * z);
  const r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w);
  const r11 = 1 - 2 * (x * x + z * z);
  const r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w);
  const r22 = 1 - 2 * (x * x + y * y);

  const sinX = Math.max(-1, Math.min(1, -r12));
  const angleX = Math.asin(sinX);

  let angleY;
  let angleZ;

  if (Math.abs(sinX) > 0.9999) {
    // Рядом с полюсом: фиксируем Z, восстанавливаем Y
    angleZ = 0;
    angleY = Math.atan2(-r20, r00);
  } else {
    angleY = Math.atan2(r02, r22);
    angleZ = Math.atan2(r10, r11);
  }

  return [
    Math.round(angleX * RAD * 10) / 10,
    Math.round(angleY * RAD * 10) / 10,
    Math.round(angleZ * RAD * 10) / 10
  ];
}

function toVec3(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length < 3) return fallback.slice();
  const result = value.slice(0, 3).map((item) => Number(item) || 0);
  return Number.isFinite(result[0] + result[1] + result[2]) ? result : fallback.slice();
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hexToText(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback;
}

/** Файл стилей сцены для HTML-слоёв HUD: только путь внутри public/hud. */
export function normalizeHudStyle(value) {
  return typeof value === 'string' && /^hud\/[\w./-]+\.css$/i.test(value) ? value : null;
}

/** Загрузочный экран сцены: HTML из public/hud и скрипт из public/scripts. */
export const DEFAULT_LOADING = { file: 'hud/loading.html', script: 'scripts/loading.js' };

export function normalizeLoading(raw) {
  const loading = raw && typeof raw === 'object' ? raw : {};

  return {
    file: typeof loading.file === 'string' && /^hud\/[\w./-]+\.html$/i.test(loading.file)
      ? loading.file
      : DEFAULT_LOADING.file,
    script: typeof loading.script === 'string' && /^scripts\/[\w./-]+\.js$/i.test(loading.script)
      ? loading.script
      : DEFAULT_LOADING.script
  };
}

function normalizeCollider(raw, path) {
  if (raw == null) return null;

  const shape = raw.shape || 'sphere';

  if (shape === 'sphere') {
    const radius = toNumber(raw.radius, 0);
    if (!(radius > 0)) throw new Error(`${path}: у сферы коллайдера нужен radius > 0`);
    return { shape, radius, offset: toVec3(raw.offset) };
  }

  if (shape === 'box') {
    const halfExtents = Array.isArray(raw.halfExtents)
      ? toVec3(raw.halfExtents, [1, 1, 1]).map((value) => Math.abs(value))
      : (() => {
        const size = toVec3(raw.size, [2, 2, 2]).map((value) => Math.abs(value) / 2);
        return size;
      })();
    if (!(halfExtents[0] > 0 && halfExtents[1] > 0 && halfExtents[2] > 0)) {
      throw new Error(`${path}: у бокса коллайдера нужны положительные полуразмеры`);
    }
    return { shape, halfExtents, offset: toVec3(raw.offset) };
  }

  if (shape === 'compound') {
    const rawSpheres = Array.isArray(raw.spheres) ? raw.spheres : [];
    const rawBoxes = Array.isArray(raw.boxes) ? raw.boxes : [];
    if (!rawSpheres.length && !rawBoxes.length) {
      throw new Error(`${path}: составной коллайдер без частей`);
    }

    const spheres = rawSpheres.map((sphere, index) => {
      const radius = toNumber(sphere?.radius, 0);
      if (!(radius > 0)) throw new Error(`${path}: сфера ${index} без радиуса`);
      return { offset: toVec3(sphere?.offset), radius };
    });

    const boxes = rawBoxes.map((box, index) => {
      const halfExtents = toVec3(box?.halfExtents, [0, 0, 0]).map((value) => Math.abs(value));
      if (!(halfExtents[0] > 0 && halfExtents[1] > 0 && halfExtents[2] > 0)) {
        throw new Error(`${path}: бокс ${index} без положительных полуразмеров`);
      }
      return { offset: toVec3(box?.offset), halfExtents };
    });

    return { shape, spheres, boxes };
  }

  throw new Error(`${path}: неизвестная форма коллайдера «${shape}»`);
}

function normalizeBody(raw, path) {
  if (!raw) return null;

  const kind = raw.kind === 'dynamic' ? 'dynamic' : (raw.type === 'dynamic' ? 'dynamic' : 'static');
  const body = {
    ...DEFAULT_BODY,
    ...raw,
    kind,
    restitution: Math.min(1, Math.max(0, toNumber(raw.restitution, DEFAULT_BODY.restitution))),
    friction: Math.max(0, toNumber(raw.friction, DEFAULT_BODY.friction))
  };

  body.collider = normalizeCollider(raw.collider, `${path}.body.collider`);
  body.mass = kind === 'dynamic' ? Math.max(1e-3, toNumber(raw.mass, 20)) : 0;
  body.lockRotation = raw.lockRotation ?? (kind !== 'dynamic');

  return body;
}

function normalizeMaterial(raw, path) {
  if (!raw) return { ...DEFAULT_MATERIAL };

  return {
    color: hexToText(raw.color, DEFAULT_MATERIAL.color),
    tint: hexToText(raw.tint, DEFAULT_MATERIAL.tint),
    emissive: hexToText(raw.emissive, DEFAULT_MATERIAL.emissive),
    metal: Math.min(1, Math.max(0, toNumber(raw.metal, DEFAULT_MATERIAL.metal))),
    specular: Math.max(0, toNumber(raw.specular, DEFAULT_MATERIAL.specular)),
    textured: raw.textured === undefined ? DEFAULT_MATERIAL.textured : Boolean(raw.textured)
  };
}

function normalizeSpin(raw, path) {
  if (!raw) return null;
  if (typeof raw === 'number') return { axis: [0, 1, 0], speed: raw };
  return {
    axis: toVec3(raw.axis, [0, 1, 0]),
    speed: toNumber(raw.speed, 0)
  };
}

function normalizeScripts(raw, path) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];

  return list.map((item, index) => {
    const script = typeof item === 'string'
      ? { file: item }
      : (item && typeof item.file === 'string' ? { ...item } : null);

    if (!script) throw new Error(`${path}.scripts[${index}]: нужен путь к файлу скрипта`);

    if (script.params && typeof script.params === 'object' && !Array.isArray(script.params)) {
      script.params = { ...script.params };
    } else {
      delete script.params;
    }

    return script;
  });
}

let autoId = 0;

const EFFECT_TRIGGERS = ['auto', 'manual', 'impact', 'trigger.enter', 'trigger.exit'];

/**
 * Ссылка на ассет эффекта или встроенное описание.
 * @param {unknown} value
 * @param {string} path
 * @returns {string|object}
 */
function normalizeEffectRef(value, path) {
  if (typeof value === 'string' && /^[a-z0-9][\w.-]*$/i.test(value)) return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value };
  throw new Error(`${path}: нужен id эффекта или объект описания`);
}

function normalizeEffectParams(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const params = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
      params[key] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
      params[key] = value.slice();
    }
  }

  return params;
}

/**
 * Один слот эффекта на сущности или узел `type: 'effect'`.
 * @param {object} raw
 * @param {string} path
 * @param {string} [fallbackId]
 * @param {string|object} [fallbackEffect]
 * @returns {object}
 */
function normalizeEffectSlot(raw, path, fallbackId = 'effect', fallbackEffect = 'smoke-trail') {
  const slot = raw && typeof raw === 'object' ? raw : {};
  const effect = normalizeEffectRef(slot.effect ?? fallbackEffect, path);

  return {
    id: typeof slot.id === 'string' && slot.id ? slot.id : fallbackId,
    effect,
    trigger: EFFECT_TRIGGERS.includes(slot.trigger) ? slot.trigger : 'manual',
    loop: Boolean(slot.loop),
    duration: Math.max(0.01, toNumber(slot.duration, 1)),
    offset: toVec3(slot.offset),
    rotation: Array.isArray(slot.rotation) ? slot.rotation.slice(0, 3).map((v) => toNumber(v, 0)) : [0, 0, 0],
    scale: Array.isArray(slot.scale) ? toVec3(slot.scale, [1, 1, 1]) : (() => {
      const uniform = Math.abs(toNumber(slot.scale, 1)) || 1;
      return [uniform, uniform, uniform];
    })(),
    params: normalizeEffectParams(slot.params)
  };
}

/**
 * Список слотов эффектов на сущности. id слотов уникальны внутри сущности.
 * @param {unknown} raw
 * @param {string} path
 * @returns {Array<object>}
 */
function normalizeEffects(raw, path, entityId = 'entity') {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const used = new Set();

  return list.map((item, index) => {
    const slot = normalizeEffectSlot(item, `${path}.effects[${index}]`, `${entityId}-effect-${index + 1}`);
    let id = slot.id;
    let suffix = 1;
    while (used.has(id)) id = `${slot.id}-${suffix++}`;
    used.add(id);
    slot.id = id;
    return slot;
  });
}

function normalizeEntity(raw, path, taken, nested = false) {
  if (!raw || typeof raw !== 'object') throw new Error(`${path}: сущность должна быть объектом`);

  const type = raw.type === 'vfx'
    ? 'effect'
    : (raw.type || (raw.shape ? 'primitive' : (raw.asset ? 'model' : 'entity')));
  const id = raw.id || `${type}-${++autoId}`;

  if (taken.has(id)) throw new Error(`${path}: повторяющийся id «${id}»`);
  taken.add(id);

  const entity = {
    id,
    type,
    name: raw.name || id,
    position: toVec3(raw.position),
    rotation: Array.isArray(raw.rotation) ? raw.rotation.slice(0, 3).map((v) => toNumber(v, 0)) : [0, 0, 0],
    scale: Array.isArray(raw.scale) ? toVec3(raw.scale, [1, 1, 1]) : (() => {
      const uniform = toNumber(raw.scale, 1);
      return [uniform, uniform, uniform];
    })(),
    visible: raw.visible !== false,
    tags: Array.isArray(raw.tags) ? raw.tags.slice() : [],
    // Скрытые части модели: список имён объектов/групп (модульный корабль)
    hiddenParts: Array.isArray(raw.hiddenParts)
      ? raw.hiddenParts.filter((value) => typeof value === 'string' && value).slice(0, 64)
      : [],
    // Материал из public/materials: рисует оболочку щита и т.п.
    materialId: typeof raw.materialId === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(raw.materialId)
      ? raw.materialId
      : null,
    // Снаряд из префаба: баллистика хранится в данных, а не в коде оружия
    projectile: normalizeProjectile(raw.projectile),
    // Прицел: вариант, размер и цвета — данные сущности, не код движка
    reticle: type === 'reticle' ? normalizeReticleConfig(raw.reticle) : null,
    // Взаимодействие с мышью: наведение и клик по модели
    mouse: type === 'model' && raw.mouse && typeof raw.mouse === 'object'
      ? { hover: Boolean(raw.mouse.hover), click: Boolean(raw.mouse.click) }
      : null,
    scripts: normalizeScripts(raw.scripts, path),
    partScripts: raw.partScripts && typeof raw.partScripts === 'object' ? { ...raw.partScripts } : {},
    body: normalizeBody(raw.body, path),
    spin: normalizeSpin(raw.spin, path),
    effects: [],
    glow: raw.glow
      ? {
        color: hexToText(raw.glow.color, '#59d8ff'),
        size: Math.max(0.01, toNumber(raw.glow.size, 4)),
        intensity: Math.max(0, toNumber(raw.glow.intensity, 0.6))
      }
      : null,
    material: normalizeMaterial(raw.material, path),
    children: []
  };

  if (entity.scale[0] <= 0 || entity.scale[1] <= 0 || entity.scale[2] <= 0) {
    throw new Error(`${path}: масштаб должен быть больше нуля`);
  }

  if (type === 'model') {
    if (typeof raw.asset !== 'string' || !raw.asset) {
      throw new Error(`${path}: модель без поля asset`);
    }
    entity.asset = raw.asset;
    entity.mining = raw.mining
      ? {
        zoneScale: Math.max(1, toNumber(raw.mining.zoneScale, 2)),
        zoneRadius: raw.mining.zoneRadius == null ? null : toNumber(raw.mining.zoneRadius, 0)
      }
      : null;
  }

  if (type === 'primitive') {
    entity.shape = raw.shape || 'box';
    entity.size = toVec3(raw.size, [2, 2, 2]).map((value) => Math.abs(value) || 0.01);
    entity.radius = Math.max(0.01, toNumber(raw.radius, entity.size[0] / 2));
    entity.segments = Math.max(6, Math.floor(toNumber(raw.segments, 24)));
    entity.rings = Math.max(3, Math.floor(toNumber(raw.rings, 16)));
    entity.tip = toNumber(raw.tip, 0.25);
    entity.blend = raw.blend === 'additive' ? 'additive' : 'opaque';
    entity.depthWrite = raw.depthWrite !== false;
  }

  if (type === 'trigger') {
    entity.trigger = {
      shape: raw.trigger?.shape === 'sphere' ? 'sphere' : 'box',
      size: toVec3(raw.trigger?.size ?? raw.size, [10, 10, 10]).map((value) => Math.abs(value) || 0.01),
      radius: Math.max(0.01, toNumber(raw.trigger?.radius ?? raw.radius, 5)),
      once: Boolean(raw.trigger?.once ?? raw.once),
      events: raw.trigger?.events ?? raw.events ?? {}
    };
  }

  if (type === 'hud') {
    const hud = raw.hud || {};
    const anchors = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];

    entity.hud = {
      file: typeof hud.file === 'string' && /^hud\/[\w./-]+\.html$/i.test(hud.file) ? hud.file : null,
      follow: ['none', 'mouse', 'target', 'parent', 'entity'].includes(hud.follow) ? hud.follow : 'none',
      target: typeof hud.target === 'string' && hud.target ? hud.target : null,
      offset: Array.isArray(hud.offset)
        ? [toNumber(hud.offset[0], 0), toNumber(hud.offset[1], 0)]
        : [0, 0],
      anchor: anchors.includes(hud.anchor) ? hud.anchor : 'top-left',
      scale: Math.min(4, Math.max(0.25, toNumber(hud.scale, 1))),
      bind: hud.bind === 'model' ? 'model' : null,
      startHidden: Boolean(hud.startHidden)
    };
  }

  if (type === 'camera') {
    const camera = raw.camera || {};
    const near = Math.max(0.01, toNumber(camera.near, 0.1));

    entity.camera = {
      height: Math.min(200, Math.max(0, toNumber(camera.height, 20))),
      distance: Math.min(120, Math.max(0, toNumber(camera.distance, 120))),
      drop: Math.min(15, Math.max(0, toNumber(camera.drop, 0))),
      tilt: Math.min(360, Math.max(0, toNumber(camera.tilt, 0))),
      background: typeof camera.background === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(camera.background)
        ? camera.background
        : null,
      fov: Math.min(120, Math.max(5, toNumber(camera.fov, 50))),
      near,
      far: Math.max(near + 1, toNumber(camera.far, 5000))
    };
  }

  if (type === 'spawn') {
    entity.spawn = {
      tag: raw.spawn?.tag || raw.tag || 'start',
      for: raw.spawn?.for || raw.for || 'ship'
    };
  }

  if (type === 'bot') {
    entity.asset = raw.asset || 'spaceship';
    entity.bot = {
      archetype: raw.bot?.archetype || raw.archetype || 'patrol',
      brain: raw.bot?.brain || raw.brain || null,
      spawn: raw.bot?.spawn || raw.spawnId || null
    };
  }

  if (type === 'effect') {
    const own = raw.effects != null ? normalizeEffects(raw.effects, path, id) : [];
    entity.effects = own.length ? own : [normalizeEffectSlot(raw, `${path}.effect`, `${id}-effect`)];
  } else {
    entity.effects = normalizeEffects(raw.effects, path, id);
  }

  // Тело ребёнка живёт в мировых координатах, а трансформ — в локальных:
  // динамику внутри группы не поддерживаем, чтобы не было двойного сдвига
  if (nested && entity.body?.kind === 'dynamic') {
    throw new Error(`${path}: динамическое тело внутри группы не поддерживается — держите его на верхнем уровне`);
  }

  const children = Array.isArray(raw.children) ? raw.children : [];
  entity.children = children.map((child, index) =>
    normalizeEntity(child, `${path}.children[${index}]`, taken, true)
  );

  return entity;
}

/**
 * Проверить и дополнить сцену значениями по умолчанию.
 * Бросает Error с путём до проблемного места — редактору это удобно показывать.
 */
export function normalizeScene(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('scene: ожидался объект');

  const version = toNumber(raw.version, SCENE_VERSION);
  if (version !== SCENE_VERSION) {
    throw new Error(`scene: версия ${version} не поддерживается (нужна ${SCENE_VERSION})`);
  }

  if (!raw.id || typeof raw.id !== 'string') throw new Error('scene: нужен id');

  autoId = 0;
  const taken = new Set();

  const sceneSettings = raw.scene && typeof raw.scene === 'object' ? raw.scene : {};

  // Корневой объект «Сцена»: его настройки — общие для всего, дети — сама сцена
  const rawRoot = (Array.isArray(raw.entities) ? raw.entities : [])
    .find((entity) => entity && entity.type === SCENE_ROOT_TYPE) || null;

  // Старый формат без корня читается как есть
  const rest = (Array.isArray(raw.entities) ? raw.entities : [])
    .filter((entity) => !(entity && entity.type === SCENE_ROOT_TYPE));
  const entityList = rawRoot
    ? [...(Array.isArray(rawRoot.children) ? rawRoot.children : []), ...rest]
    : rest;

  const entities = entityList.map((entity, index) =>
    normalizeEntity(entity, `entities[${index}]`, taken)
  );

  const spawns = [];
  const walk = (list) => {
    for (const entity of list) {
      if (entity.type === 'spawn') spawns.push(entity);
      walk(entity.children);
    }
  };
  walk(entities);

  const player = rawRoot?.player || raw.player || sceneSettings.player || {};

  // Скрипт сцены — обязательная точка входа; его params задают настройки кадра
  const sceneScripts = normalizeScripts(rawRoot?.scripts, 'scene');
  const sceneParams = sceneScripts[0]?.params || {};

  const backgroundValue = sceneParams.background
    ?? rawRoot?.background ?? sceneSettings.background ?? raw.background;
  const hudStyleValue = sceneParams.hudStyle
    ?? rawRoot?.hud?.style ?? sceneSettings.hudStyle ?? raw.hudStyle;
  const loadingValue = sceneParams.loadingFile || sceneParams.loadingScript
    ? { file: sceneParams.loadingFile, script: sceneParams.loadingScript }
    : (rawRoot?.loading ?? sceneSettings.loading ?? raw.loading);
  const cursorId = sceneParams.cursor ?? rawRoot?.cursor ?? raw.cursor ?? sceneSettings.cursor ?? null;
  const cursor = typeof cursorId === 'string' && cursorId ? cursorId : null;
  const spawnId = player.spawn || null;
  const spawnEntity = spawnId ? spawns.find((item) => item.id === spawnId) : null;

  // Точка спавна необязательна: битая ссылка не должна ломать сцену
  if (spawnId && !spawnEntity) {
    console.warn(`scene: точка появления «${spawnId}» не найдена — старт с player.position`);
  }


  return {
    version,
    id: raw.id,
    title: raw.title || raw.id,
    background: hexToText(backgroundValue, '#000000'),
    scene: {
      id: rawRoot?.id || 'scene',
      type: SCENE_ROOT_TYPE,
      name: rawRoot?.name || 'Сцена',
      background: hexToText(backgroundValue, '#000000'),
      hudStyle: normalizeHudStyle(hudStyleValue),
      loading: normalizeLoading(loadingValue),
      cursor,
      scripts: sceneScripts,
      player: {
        model: player.model || 'corinth',
        spawn: spawnEntity ? spawnId : null,
        position: toVec3(player.position),
        rotation: Array.isArray(player.rotation) ? player.rotation.slice(0, 3).map((v) => toNumber(v, 0)) : [0, 0, 0]
      }
    },
    player: {
      model: player.model || 'corinth',
      spawn: spawnEntity ? spawnId : null,
      position: toVec3(player.position),
      rotation: Array.isArray(player.rotation) ? player.rotation.slice(0, 3).map((v) => toNumber(v, 0)) : [0, 0, 0]
    },
    cursor,
    scripts: sceneScripts,
    entities,
    spawns
  };
}

/** Все сущности плоским списком: удобно для поиска, скриптов и редактора. */
export function flattenEntities(entities, out = []) {
  for (const entity of entities || []) {
    out.push(entity);
    flattenEntities(entity.children || [], out);
  }
  return out;
}

/** Переименовать сущности дерева: id остаются уникальными в сцене. */
export function reassignIds(entities, nextId) {
  for (const entity of entities) {
    entity.id = nextId(entity.id);
    if (Array.isArray(entity.children)) reassignIds(entity.children, nextId);
  }

  return entities;
}

export function findEntity(entities, id) {
  return flattenEntities(entities).find((entity) => entity.id === id) || null;
}

/**
 * Переписать ссылки на сущности после перенумерации id (вставка префаба).
 * Ссылки живут в параметрах скриптов и в hud.target.
 * @param {object[]} entities
 * @param {Map<string,string>} idMap старый id → новый id
 */
export function remapEntityReferences(entities, idMap) {
  if (!(idMap instanceof Map) || !idMap.size) return entities;

  const remap = (value) => (typeof value === 'string' && idMap.has(value) ? idMap.get(value) : value);

  const visit = (raw) => {
    for (const script of raw.scripts || []) {
      if (!script || typeof script !== 'object' || !script.params) continue;

      for (const [key, value] of Object.entries(script.params)) {
        const next = remap(value);
        if (next !== value) script.params[key] = next;
      }
    }

    if (raw.hud && typeof raw.hud.target === 'string') {
      raw.hud.target = remap(raw.hud.target);
    }

    // Точка появления бота — тоже ссылка на сущность
    if (raw.bot && typeof raw.bot.spawn === 'string') {
      raw.bot.spawn = remap(raw.bot.spawn);
    }
    if (typeof raw.spawnId === 'string') {
      raw.spawnId = remap(raw.spawnId);
    }

    for (const child of raw.children || []) visit(child);
  };

  for (const raw of entities) visit(raw);
  return entities;
}

/** Снять суффикс копии: «gun-left-2» → «gun-left». */
function idBase(id) {
  return String(id || 'node').replace(/-\d+$/, '') || 'node';
}

/** Свободный id в принятой в редакторе форме: <base>-1, <base>-2, … */
function nextFreeId(base, taken) {
  let index = 1;
  let id = `${base}-${index}`;

  while (taken.has(id)) {
    index += 1;
    id = `${base}-${index}`;
  }

  taken.add(id);
  return id;
}

/**
 * Обновить инстанс префаба данными из файла.
 *
 * Возвращает новые корни: содержимое берётся из префаба, а id узлов
 * переиспользуются по позиции в дереве. Поэтому ссылки остальной сцены на
 * инстанс (параметры скриптов, hud.target, точка появления) остаются рабочими,
 * а новые узлы получают свободные id. Место установки корня (position) тоже
 * остаётся сценным: префаб обновляет содержимое, а не место установки — иначе
 * объект прыгал бы к камере при каждом обновлении. Поворот и масштаб берутся
 * из сцены только при совпадении типа корня: у застаревшего инстанса (корень
 * был моделью, а в префабе стал группой с той же моделью внутри) масштаб
 * применился бы дважды — к группе и к мешу.
 *
 * @param {object[]} existing текущие корни инстанса на сцене
 * @param {object[]} incoming свежие корни из файла префаба (не мутируются)
 * @param {{taken?: Set<string>|string[]}} [options] занятые id документа
 * @returns {{entities: object[], kept: number, added: number, removed: number, idMap: Map<string,string>}}
 */
export function refreshPrefabRoots(existing, incoming, options = {}) {
  const taken = new Set(options.taken || []);
  const entities = JSON.parse(JSON.stringify(Array.isArray(incoming) ? incoming : []));
  const previous = new Map();

  const index = (list, prefix) => {
    (list || []).forEach((raw, position) => {
      if (!raw || typeof raw !== 'object') return;
      const path = prefix ? `${prefix}.${position}` : String(position);
      previous.set(path, raw);
      index(raw.children, path);
    });
  };
  index(existing, '');

  const idMap = new Map();
  const fresh = new Set();
  let kept = 0;
  let added = 0;

  const walk = (list, prefix) => {
    list.forEach((raw, position) => {
      const path = prefix ? `${prefix}.${position}` : String(position);
      fresh.add(path);

      const old = previous.get(path) || null;
      const original = typeof raw.id === 'string' && raw.id ? raw.id : null;
      let id = old && old.id ? String(old.id) : null;

      if (id) {
        kept += 1;
      } else {
        id = nextFreeId(idBase(original), taken);
        added += 1;
      }

      taken.add(id);
      raw.id = id;
      if (original && original !== id) idMap.set(original, id);

      // Корень стоит там, куда его поставили на сцене
      if (!prefix && old) {
        if (Array.isArray(old.position)) raw.position = old.position.slice();

        const sameKind = String(old.type || '') === String(raw.type || '');
        if (sameKind) {
          if (Array.isArray(old.rotation)) raw.rotation = old.rotation.slice();
          if (old.scale != null) raw.scale = old.scale;
        }
      }

      if (Array.isArray(raw.children)) walk(raw.children, path);
    });
  };
  walk(entities, '');

  // Ссылки внутри префаба указывают на исходные id — переводим их на выданные
  remapEntityReferences(entities, idMap);

  let removed = 0;
  for (const path of previous.keys()) {
    if (!fresh.has(path)) removed += 1;
  }

  return { entities, kept, added, removed, idMap };
}

/**
 * Починить ссылки в сохраняемом префабе.
 *
 * Внутри ветки ссылки остаются целыми — при вставке они перенумеруются.
 * Ссылки на объекты вне ветки и на несуществующие id очищаются: иначе
 * префаб будет хранить адрес, который в другой сцене ничего не значит.
 *
 * @param {object[]} entities корни префаба (мутируются)
 * @param {object} [options]
 * @param {Set<string>|string[]} [options.sceneIds] все id документа
 * @param {(file:string, key:string)=>boolean} [options.isEntityParam] схема скрипта
 * @returns {Array<{where:string, value:string, reason:string}>}
 */
export function sanitizePrefabReferences(entities, options = {}) {
  const internal = new Set(flattenEntities(entities).map((entity) => entity.id));
  const sceneIds = options.sceneIds instanceof Set ? options.sceneIds : new Set(options.sceneIds || []);
  const isEntityParam = typeof options.isEntityParam === 'function' ? options.isEntityParam : () => false;
  const cleared = [];

  const reasonFor = (value) => (sceneIds.has(value) ? 'вне префаба' : 'не найдено');

  const visit = (raw) => {
    for (const script of raw.scripts || []) {
      if (!script || typeof script !== 'object' || !script.params) continue;
      const file = String(script.file || '');

      for (const [key, value] of Object.entries(script.params)) {
        if (typeof value !== 'string' || !value) continue;
        if (internal.has(value)) continue;

        // Ссылка — либо параметр с типом entity, либо строка, совпадающая с id объекта
        if (!isEntityParam(file, key) && !sceneIds.has(value)) continue;

        cleared.push({ where: `${raw.id}.${key}`, value, reason: reasonFor(value) });
        script.params[key] = '';
      }
    }

    if (raw.hud && typeof raw.hud.target === 'string' && raw.hud.target && !internal.has(raw.hud.target)) {
      cleared.push({ where: `${raw.id}.hud.target`, value: raw.hud.target, reason: reasonFor(raw.hud.target) });
      raw.hud.target = null;
    }

    if (raw.bot && typeof raw.bot.spawn === 'string' && raw.bot.spawn && !internal.has(raw.bot.spawn)) {
      cleared.push({ where: `${raw.id}.bot.spawn`, value: raw.bot.spawn, reason: reasonFor(raw.bot.spawn) });
      raw.bot.spawn = null;
    }

    if (typeof raw.spawnId === 'string' && raw.spawnId && !internal.has(raw.spawnId)) {
      cleared.push({ where: `${raw.id}.spawnId`, value: raw.spawnId, reason: reasonFor(raw.spawnId) });
      delete raw.spawnId;
    }

    for (const child of raw.children || []) visit(child);
  };

  for (const raw of entities) visit(raw);
  return cleared;
}

export function findSpawn(entities, id) {
  return flattenEntities(entities).find((entity) => entity.type === 'spawn' && entity.id === id) || null;
}

/* ------------------------------- Загрузка -------------------------------- */

const SCENE_DIR = 'scenes/';

/** Список сцен из public/scenes/index.json. */
export async function loadSceneIndex() {
  const response = await fetch(`${SCENE_DIR}index.json`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Не найден public/scenes/index.json');

  const data = await response.json();
  return Array.isArray(data.scenes) ? data.scenes : [];
}

/** Прочитать и проверить сцену по id. Принимаем и <id>.scene.json, и <id>.json. */
export async function loadScene(id) {
  let response = await fetch(`${SCENE_DIR}${id}.scene.json`, { cache: 'no-store' });

  if (!response.ok) {
    response = await fetch(`${SCENE_DIR}${id}.json`, { cache: 'no-store' });
  }

  if (!response.ok) throw new Error(`Сцена «${id}» не найдена: scenes/${id}.scene.json`);

  return normalizeScene(await response.json());
}
