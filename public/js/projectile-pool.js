/**
 * @fileoverview Пул снарядов: прогретые экземпляры префаба без аллокаций.
 *
 * Пока ракета летит, её поддерево уже собрано: acquire только показывает
 * корень и включает эффекты, release — гасит и прячет. Спящие экземпляры
 * не дымят: эффекты привязываются без autoplay и запускаются на выстрел.
 *
 * Модуль не знает про WebGL: рантайм префабов приходит снаружи, поэтому
 * пул проверяется в node --test с заглушкой.
 */

/**
 * @param {object} options
 * @param {object} options.runtime рантайм префабов (spawn/despawn)
 * @param {object|null} [options.effects] система эффектов
 * @param {string} [options.prefab] id префаба
 * @param {number} [options.size] сколько экземпляров прогреть
 */
export function createProjectilePool({ runtime, effects = null, prefab = 'rocket', size = 12 }) {
  const instances = [];
  const free = [];
  let created = 0;
  let rejected = 0;
  let shots = 0;

  async function prewarm(count = size) {
    const total = Math.max(0, Math.floor(count));

    for (let index = 0; index < total; index++) {
      const handle = await runtime.spawn(prefab, { visible: false });
      const instance = {
        root: handle.root,
        entities: handle.entities || [],
        projectile: handle.projectile || null,
        prefab: handle.prefab || prefab,
        active: false,
        dead: true
      };

      hide(instance);
      instances.push(instance);
      free.push(instance);
      created += 1;
    }

    return instances.length;
  }

  function hide(instance) {
    for (const entity of entitiesOf(instance)) {
      entity.visible = false;
      if (entity.raw) entity.raw.visible = false;
    }
  }

  function show(instance) {
    for (const entity of entitiesOf(instance)) {
      entity.visible = true;
      if (entity.raw) entity.raw.visible = true;
    }
  }

  function entitiesOf(instance) {
    return instance.entities?.length ? instance.entities : (instance.root ? [instance.root] : []);
  }

  function mount(instance) {
    show(instance);
    if (!effects) return;

    effects.mount?.(instance.root);
    const trail = instance.projectile?.trail || null;
    if (trail) effects.play?.(instance.root, trail);
  }

  function acquire() {
    const instance = free.pop();
    if (!instance) {
      rejected += 1;
      return null;
    }

    instance.active = true;
    instance.dead = false;
    shots += 1;
    mount(instance);
    return instance;
  }

  function release(instance) {
    if (!instance) return;
    instance.active = false;
    instance.dead = true;

    if (effects && instance.root) {
      effects.stop?.(instance.root);
      effects.unmount?.(instance.root);
    }
    hide(instance);

    if (!free.includes(instance)) free.push(instance);
  }

  function stats() {
    return {
      prefab,
      size: created,
      free: free.length,
      active: created - free.length,
      shots,
      rejected
    };
  }

  return {
    prewarm,
    acquire,
    release,
    mount,
    stats,
    instances
  };
}
