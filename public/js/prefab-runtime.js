/**
 * @fileoverview Рантайм префабов: собрать поддерево префаба в живой сцене.
 *
 * Префаб — файл public/prefabs/<id>.json. Здесь он превращается в сущности
 * scene-runtime (меши, матрицы, тела) и вставляется в общий массив сцены.
 *
 * Снаряды (`projectile`) собираются без физического тела: попадания считает
 * projectiles.js свипом, а не решатель контактов.
 *
 * Модуль браузерный: buildScene грузит меши через WebGL.
 */

import { preparePrefab } from './prefabs.js';
import { attachBodies, buildScene, updateMatrices } from './scene-runtime.js';

const prefabCache = new Map();

/** Загрузить документ префаба через API сервера (с кэшем на сессию). */
export async function loadPrefab(id) {
  if (prefabCache.has(id)) return prefabCache.get(id);

  const promise = fetch(`/api/prefab/${encodeURIComponent(id)}`, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`префаб «${id}» не найден (${response.status})`);
      return response.json();
    });

  prefabCache.set(id, promise);
  return promise;
}

/** Сбросить кэш документов — после правки префаба в редакторе. */
export function clearPrefabCache(id = null) {
  if (id == null) prefabCache.clear();
  else prefabCache.delete(id);
}

/**
 * @param {object} options
 * @param {WebGL2RenderingContext} options.gl
 * @param {object} options.physics
 * @param {object|null} [options.effects]
 * @param {object[]} options.entities общий плоский список сущностей сцены
 */
export function createPrefabRuntime({ gl, physics, effects = null, entities }) {
  if (!Array.isArray(entities)) throw new Error('prefab-runtime: нужен массив entities');

  async function spawn(id, transform = {}) {
    const doc = await loadPrefab(id);
    const prepared = preparePrefab(doc, transform);
    const created = await buildScene(gl, { entities: prepared.entities }, {
      includeHidden: true,
      effects: null
    });

    if (!created.length) throw new Error(`префаб «${id}»: нечего строить`);

    // Скрытый корень прячет всё поддерево: иначе меш ребёнка рисовался бы сам.
    if (prepared.root.visible === false) {
      for (const entity of created) {
        entity.visible = false;
        entity.raw.visible = false;
      }
    }

    // У снаряда тела нет: положение ведёт свип, а не физический мир.
    if (!prepared.projectile) attachBodies(created, physics);

    entities.push(...created);
    updateMatrices(created);

    if (effects) {
      for (const entity of created) {
        effects.registerEntity(entity, { autoplay: false });
      }
    }

    return {
      root: created[0],
      entities: created,
      projectile: prepared.projectile,
      prefab: id
    };
  }

  function despawn(handle) {
    const root = handle?.root || handle;
    const list = (handle?.entities?.length ? handle.entities : [root]).filter(Boolean);
    if (!list.length) return false;

    for (const entity of list) {
      if (entity.body) physics?.removeBody?.(entity.body);
      effects?.unregisterEntity?.(entity);
      entity.removed = true;
      entity.visible = false;
      if (entity.raw) entity.raw.visible = false;
    }

    const removed = new Set(list);
    for (let index = entities.length - 1; index >= 0; index--) {
      if (removed.has(entities[index])) entities.splice(index, 1);
    }

    return true;
  }

  return { spawn, despawn };
}
