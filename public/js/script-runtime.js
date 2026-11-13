// Рантайм скриптов сцены.
//
// Скрипт — обычный ES-модуль в public/scripts, по умолчанию экспортирует
// объект с хуками:
//
//   export default {
//     init(ctx) {},          // один раз при загрузке сцены
//     update(ctx, dt) {},    // каждый кадр, пока игра не на паузе
//     onEvent(ctx, event) {},// события триггеров и сцены
//     dispose(ctx) {}        // при выгрузке сцены
//   }
//
// ctx = { entity, part, scene, state, api }. `state` — личное хранилище
// экземпляра скрипта: одно и то же поведение на разных объектах не делит данные.

import { triggerContains } from './scene-runtime.js';
import { quatFromAxisAngle, quatMul, quatNormalize } from './math.js';

export class ScriptRuntime {
  constructor({ scene, entities, ship, player = null, input = null, flight = null, effects = null, mining = null, miningTargets = null, hud = null, camera = null, projectiles = null, prefabs = null, targets = null }) {
    this.scene = scene;
    this.entities = entities;
    this.ship = ship;
    this.player = player;
    this.input = input;
    this.flight = flight;
    this.effects = effects;
    this.mining = mining;
    this.miningTargets = miningTargets;
    this.hud = hud;
    this.camera = camera;
    this.projectiles = projectiles;
    this.prefabs = prefabs;
    this.targets = targets;
    this.time = 0;
    this.instances = [];
    this.listeners = new Map();
    this.errors = [];

    // Общее состояние скриптов сцены: оружие публикует статус, прицел читает.
    // Это канал между скриптами, а не движком: содержимое — их договорённость.
    this.shared = new Map();

    // Скрипты заявляют подсистемы, которые взяли на себя: движок
    // перестаёт делать это сам, иначе управление сработает дважды
    this.claims = new Set();

    this.triggers = entities
      .filter((entity) => entity.type === 'trigger')
      .map((entity) => ({ entity, inside: false, fired: false }));

    this.api = {
      entities,
      ship,
      player,
      input,
      scene,
      claim: (name) => this.claims.add(String(name)),
      find: (id) => this.find(id),
      move: (entity, delta) => this.move(entity, delta),
      setPosition: (entity, position) => this.setPosition(entity, position),
      rotate: (entity, axis, angle) => this.rotate(entity, axis, angle),
      faceDirection: (entity, direction) => this.faceDirection(entity, direction),
      impulse: (entity, impulse) => entity?.body?.applyImpulse(impulse),
      setVelocity: (entity, velocity) => this.setVelocity(entity, velocity),
      getVelocity: (entity) => this.getVelocity(entity),
      setQuaternion: (entity, quaternion) => this.setQuaternion(entity, quaternion),
      aimQuaternion: () => this.flight?.aimQuaternion?.() || null,
      aimTarget: () => this.flight?.target?.() || null,
      miningTargets: () => this.miningTargets?.() || [],
      effects: {
        beam: (id, data) => this.effects?.beam?.(id, data) || null,
        tracer: (id, data) => this.effects?.tracer?.(id, data) || null,
        smoke: (id, data) => this.effects?.smoke?.(id, data) || null,
        spark: (id, data) => this.effects?.spark?.(id, data) || null,
        spawn: (effect, options = {}) => this.effects?.spawn?.(effect, {
          ...options,
          parentEntity: options.parentEntity || (typeof options.parent === 'string' ? this.find(options.parent) : options.parent) || null
        }) || null,
        play: (entityOrId, slotOrEffectId, params = {}) => {
          const entity = typeof entityOrId === 'string' ? this.find(entityOrId) : entityOrId;
          return this.effects?.play?.(entity, slotOrEffectId, params) || null;
        },
        stop: (instanceOrEntityId, slotId = null, immediate = true) => {
          const target = typeof instanceOrEntityId === 'string' && !this.find(instanceOrEntityId)
            ? instanceOrEntityId
            : (typeof instanceOrEntityId === 'string' ? this.find(instanceOrEntityId) : instanceOrEntityId);
          return this.effects?.stop?.(target, slotId, immediate) || 0;
        },
        setParams: (instanceOrEntityId, slotIdOrParams = {}, params = {}) => {
          const target = typeof instanceOrEntityId === 'string' && this.find(instanceOrEntityId)
            ? this.find(instanceOrEntityId)
            : instanceOrEntityId;
          return this.effects?.setParams?.(target, slotIdOrParams, params) || false;
        },
        isActive: (instanceOrEntityId, slotId = null) => {
          const target = typeof instanceOrEntityId === 'string' && this.find(instanceOrEntityId)
            ? this.find(instanceOrEntityId)
            : instanceOrEntityId;
          return this.effects?.isActive?.(target, slotId) || false;
        },
        clear: () => this.effects?.clear?.() || false
      },
      camera: {
        set: (params) => this.camera?.set?.(params) || null,
        get: () => this.camera?.get?.() || null,
        setPose: (pose) => this.camera?.setPose?.(pose) || false,
        clearPose: () => this.camera?.clearPose?.() || false,
        isScripted: () => this.camera?.isScripted?.() || false
      },
      projectiles: {
        fire: (options) => this.projectiles?.fire?.(options) || null,
        stats: () => this.projectiles?.stats?.() || null
      },
      shared: {
        get: (key) => this.shared.get(String(key)) ?? null,
        set: (key, value) => {
          this.shared.set(String(key), value);
          return value;
        },
        delete: (key) => this.shared.delete(String(key))
      },
      target: {
        show: (options) => this.targets?.show?.(options) || null,
        hide: () => this.targets?.hide?.() || false,
        pulse: () => this.targets?.pulse?.() || false,
        cursor: (options) => this.targets?.cursor?.(options) || false,
        hideCursor: () => this.targets?.hideCursor?.() || false,
        aim: () => this.targets?.aim?.() || null
      },
      spawnPrefab: (id, transform) => this.prefabs?.spawn?.(id, transform) || null,
      despawnPrefab: (handle) => this.prefabs?.despawn?.(handle) || false,
      mining: {
        hold: (on) => this.mining?.hold?.(Boolean(on))
      },
      hud: {
        value: (controlId) => this.hud?.value?.(controlId) ?? null,
        setValue: (controlId, value) => this.hud?.setValue?.(controlId, value) || false,
        setText: (id, text) => this.hud?.setText?.(id, text) || false,
        setStyle: (id, property, value) => this.hud?.setStyle?.(id, property, value) || false,
        setClass: (id, name, enabled) => this.hud?.setClass?.(id, name, enabled) || false,
        onClick: (id, handler) => this.hud?.onClick?.(id, handler) || null,
        show: (id) => this.hud?.setVisible?.(id, true) || false,
        hide: (id) => this.hud?.setVisible?.(id, false) || false,
        toggle: (id) => this.hud?.toggle?.(id) ?? null,
        isVisible: (id) => this.hud?.isVisible?.(id) || false,
        exists: (id) => this.hud?.exists?.(id) || false
      },
      on: (type, handler) => this.on(type, handler),
      emit: (event) => this.emit(event),
      log: (...args) => console.log('[script]', ...args)
    };
  }

  setVelocity(entity, velocity) {
    if (!entity || !velocity) return;

    const next = [
      Number(velocity[0]) || 0,
      Number(velocity[1]) || 0,
      Number(velocity[2]) || 0
    ];

    entity.velocity = next;
    entity.body?.setVelocity(next);
  }

  getVelocity(entity) {
    if (!entity) return [0, 0, 0];
    return entity.body ? entity.body.velocity.slice() : (entity.velocity || [0, 0, 0]).slice();
  }

  setQuaternion(entity, quaternion) {
    if (!entity || !quaternion) return;

    const next = quatNormalize(quaternion.slice());
    entity.quaternion = next;
    entity.baseQuaternion = next;
    entity.body?.setQuaternion(next);
  }

  find(id) {
    return this.entities.find((entity) => entity.id === id) || null;
  }

  move(entity, delta) {
    if (!entity) return;
    for (let i = 0; i < 3; i++) entity.position[i] += delta[i] || 0;
  }

  setPosition(entity, position) {
    if (!entity) return;
    for (let i = 0; i < 3; i++) entity.position[i] = position[i] ?? entity.position[i];

    // Тело живёт отдельно от трансформа — переносим и его
    entity.body?.setPosition(entity.position);
  }

  rotate(entity, axis, angle) {
    if (!entity) return;
    entity.quaternion = quatMul(quatFromAxisAngle(axis, angle), entity.quaternion);
  }

  /** Развернуть сущность носом (−Z) в сторону направления. */
  faceDirection(entity, direction) {
    if (!entity) return;
    const yaw = -Math.atan2(direction[0], -direction[2]);
    entity.quaternion = quatFromAxisAngle([0, 1, 0], yaw);
  }

  on(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  emit(event) {
    const payload = { time: this.time, ...event };

    for (const [type, handlers] of this.listeners) {
      if (type === event.type || type === '*') {
        for (const handler of handlers) {
          try {
            handler(payload);
          } catch (err) {
            this.report(err, `listener ${type}`);
          }
        }
      }
    }

    for (const instance of this.instances) {
      if (typeof instance.definition.onEvent !== 'function') continue;
      try {
        instance.definition.onEvent(instance.ctx, payload);
      } catch (err) {
        this.report(err, `${instance.file} onEvent`);
      }
    }
  }

  report(error, where) {
    const message = `${where}: ${error.message}`;
    this.errors.push(message);
    console.warn('[scripts]', message);
  }

  /** Загрузить все скрипты сцены и сущностей. */
  async loadAll(base = '../scripts/', options = {}) {
    const tasks = [];

    // Скрипт самого объекта «Сцена»: обязательная точка входа сцены.
    // init уже вызван при сборке кадра (api.scene.build), поэтому его пропускаем.
    const sceneScripts = Array.isArray(this.scene?.scripts) ? this.scene.scripts : [];
    if (sceneScripts.length) {
      const root = {
        id: this.scene?.scene?.id || 'scene',
        type: 'scene',
        name: this.scene?.scene?.name || 'Сцена',
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        children: [],
        parent: null,
        raw: { type: 'scene', scripts: sceneScripts }
      };

      for (const script of sceneScripts) {
        tasks.push({
          entity: root,
          part: null,
          file: script.file || script,
          params: script.params || null,
          skipInit: options.sceneScriptsReady === true
        });
      }
    }

    for (const entity of this.entities) {
      for (const script of entity.scripts || []) {
        tasks.push({ entity, part: null, file: script.file || script, params: script.params || null });
      }

      for (const [partName, list] of Object.entries(entity.partScripts || {})) {
        for (const item of list) {
          tasks.push({ entity, part: partName, file: item.file || item });
        }
      }
    }

    for (const task of tasks) {
      await this.loadOne(task, base);
    }
  }

  async loadOne({ entity, part, file, params: sceneParams = null, skipInit = false }, base) {
    const path = String(file).startsWith('/') ? String(file) : `${base}${file}`;

    try {
      const url = new URL(path, import.meta.url);
      const module = await import(url.href);
      const definition = module.default || module;

      if (!definition || typeof definition !== 'object') {
        throw new Error('скрипт должен экспортировать объект с хуками');
      }

      // Схема параметров из модуля + значения из сцены
      const schema = module.params && typeof module.params === 'object' ? module.params : null;
      const defaults = {};

      if (schema) {
        for (const [key, meta] of Object.entries(schema)) {
          if (meta && Object.prototype.hasOwnProperty.call(meta, 'default')) defaults[key] = meta.default;
        }
      }

      const params = { ...defaults, ...(sceneParams || {}) };

      const instance = {
        entity,
        part,
        file: String(file),
        definition,
        params,
        state: {},
        ctx: {
          entity,
          part,
          params,
          scene: this.scene,
          state: null,
          api: this.api
        }
      };

      instance.ctx.state = instance.state;
      this.instances.push(instance);

      if (typeof definition.init === 'function' && !skipInit) {
        definition.init(instance.ctx);
      }
    } catch (err) {
      this.report(err, `загрузка ${file}`);
    }
  }

  update(dt) {
    this.time += dt;

    for (const instance of this.instances) {
      if (typeof instance.definition.update !== 'function') continue;
      try {
        instance.definition.update(instance.ctx, dt);
      } catch (err) {
        this.report(err, `${instance.file} update`);
      }
    }

    this.checkTriggers();
  }

  checkTriggers() {
    const position = this.ship?.pos;
    if (!position) return;

    for (const trigger of this.triggers) {
      const inside = triggerContains(trigger.entity, position);
      if (inside === trigger.inside) continue;

      trigger.inside = inside;
      if (!inside) {
        this._triggerEffects(trigger.entity, 'trigger.exit', false);
        this.emit({ type: 'trigger.exit', trigger: trigger.entity.id, tag: trigger.entity.trigger?.tag });
        continue;
      }

      const once = trigger.entity.trigger?.once;
      if (once && trigger.fired) continue;

      trigger.fired = true;
      this._triggerEffects(trigger.entity, 'trigger.enter', true);
      this.emit({ type: 'trigger.enter', trigger: trigger.entity.id, tag: trigger.entity.trigger?.tag });
    }
  }

  /**
   * Запуск/остановка эффектов, привязанных к самому триггеру.
   * @param {object} entity
   * @param {'trigger.enter'|'trigger.exit'} triggerType
   * @param {boolean} play
   */
  _triggerEffects(entity, triggerType, play) {
    if (!this.effects) return;

    for (const slot of entity.effects || []) {
      if (slot.trigger !== triggerType) continue;
      if (play) this.effects.play(entity, slot.id);
      else this.effects.stop(entity, slot.id);
    }
  }

  dispose() {
    for (const instance of this.instances) {
      if (typeof instance.definition.dispose === 'function') {
        try {
          instance.definition.dispose(instance.ctx);
        } catch (err) {
          this.report(err, `${instance.file} dispose`);
        }
      }
    }

    this.instances.length = 0;
    this.listeners.clear();
  }
}
