// Эффекты, которые рисует движок, а создают скрипты и сцена.
//
// Два уровня:
// 1. items — покадровые примитивы (beam, tracer, rocket, smoke, spark), как
//    раньше: скрипт присылает состояние с ttl, движок сам гасит его.
// 2. instances — составные эффекты из public/effects/*.effect.json. Живут по
//    таймеру, могут быть привязаны к сущности сцены и переиспользуются из пула.
//
// Модуль не знает про WebGL и DOM: его можно тестировать в Node.js.

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function transformPoint(matrix, point) {
  if (!matrix) return point.slice();
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14]
  ];
}

function toColor(value, fallback = [0.68, 0.72, 0.8]) {
  if (Array.isArray(value) && value.length >= 3) {
    return [numberOr(value[0], fallback[0]), numberOr(value[1], fallback[1]), numberOr(value[2], fallback[2])];
  }

  if (typeof value === 'string') {
    const clean = value.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    if (/^[0-9a-f]{6}$/i.test(full)) {
      const number = Number.parseInt(full, 16);
      return [((number >> 16) & 255) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
    }
  }

  return fallback.slice();
}

function randomInSphere(radius) {
  const u = Math.random();
  const v = Math.random();
  const theta = u * Math.PI * 2;
  const phi = Math.acos(2 * v - 1);
  const r = radius * Math.cbrt(Math.random());
  return [
    Math.sin(phi) * Math.cos(theta) * r,
    Math.sin(phi) * Math.sin(theta) * r,
    Math.cos(phi) * r
  ];
}

/**
 * Система эффектов: примитивы и составные VFX-инстансы.
 */
export class EffectSystem {
  constructor() {
    this.items = new Map();
    this.instances = new Map();
    this.pool = [];
    this.counter = 0;
    this.instanceCounter = 0;

    this.definitions = new Map();
    this.handlers = new Map();
    this.entities = new Map();

    this.registerLayerHandler('smoke', (instance, layer, dt, system) => this._updateSmoke(instance, layer, dt, system));
    this.registerLayerHandler('spark', (instance, layer, dt, system) => this._updateSpark(instance, layer, dt, system));
  }

  /* --------------------------- Старый API -------------------------------- */

  set(id, type, data = {}, ttl = 0.06) {
    if (!id) id = `${type}-${++this.counter}`;
    this.items.set(id, {
      ...data,
      type,
      ttl: Math.max(0.001, Number(ttl) || 0.06)
    });
    return id;
  }

  beam(id, data) {
    return this.set(id, 'beam', data, data?.ttl ?? 0.06);
  }

  tracer(id, data) {
    return this.set(id, 'tracer', data, data?.ttl ?? 0.06);
  }

  smoke(id, data) {
    return this.set(id, 'smoke', data, data?.ttl ?? 0.9);
  }

  spark(id, data) {
    return this.set(id, 'spark', data, data?.ttl ?? 0.2);
  }

  /* --------------------------- Определения -------------------------------- */

  /**
   * Зарегистрировать определение эффекта из public/effects.
   * @param {string} id
   * @param {object} definition
   */
  registerDefinition(id, definition) {
    if (!id || !definition || typeof definition !== 'object') return null;
    const normalized = {
      id,
      title: definition.title || id,
      duration: Math.max(0.01, numberOr(definition.duration, 1)),
      loop: Boolean(definition.loop),
      params: definition.params && typeof definition.params === 'object' ? { ...definition.params } : {},
      layers: Array.isArray(definition.layers) ? definition.layers.map((layer) => ({ ...layer })) : []
    };
    this.definitions.set(id, normalized);
    return normalized;
  }

  getDefinition(id) {
    return this.definitions.get(id) || null;
  }

  registerLayerHandler(type, handler) {
    if (typeof type === 'string' && typeof handler === 'function') {
      this.handlers.set(type, handler);
    }
    return this;
  }

  /**
   * Привязать сущность сцены: запомнить её и запустить auto-эффекты.
   * @param {object} entity
   * @param {{autoplay?: boolean}} [options] autoplay: false — только привязка
   *   (нужно пулу снарядов: спящая ракета не должна дымить)
   */
  registerEntity(entity, options = {}) {
    if (!entity?.id) return entity;
    this.entities.set(entity.id, entity);

    const autoplay = options.autoplay !== false;
    if (entity.__effectsRegistered || !autoplay) return entity;
    entity.__effectsRegistered = true;

    for (const slot of entity.effects || []) {
      if (slot.trigger === 'auto') this.play(entity, slot.id);
    }

    return entity;
  }

  unregisterEntity(entityOrId) {
    const id = typeof entityOrId === 'string' ? entityOrId : entityOrId?.id;
    if (!id) return false;

    // Сначала гасим инстансы: после удаления из карты их родитель уже не найти.
    this.stop(entityOrId);
    this.entities.delete(id);
    return true;
  }

  /** Привязать поддерево без запуска auto-эффектов. */
  mount(root) {
    this._walk(root, (entity) => this.registerEntity(entity, { autoplay: false }));
    return root;
  }

  /** Отвязать поддерево и погасить его эффекты. */
  unmount(root) {
    this._walk(root, (entity) => {
      this.stop(entity);
      this.unregisterEntity(entity);
      entity.__effectsRegistered = false;
    });
    return root;
  }

  _walk(entity, visit) {
    if (!entity) return;
    visit(entity);
    for (const child of entity.children || []) this._walk(child, visit);
  }

  /* ----------------------------- Инстансы --------------------------------- */

  /**
   * Создать и запустить эффект в мире.
   * @param {string|object} effectIdOrSpec id ассета или описание
   * @param {object} [options]
   * @returns {string|null}
   */
  spawn(effectIdOrSpec, options = {}) {
    const definition = this._resolveDefinition(effectIdOrSpec);
    if (!definition) return null;

    return this.createInstance(definition, {
      parent: options.parentEntity || null,
      position: options.position || [0, 0, 0],
      rotation: options.rotation || [0, 0, 0],
      scale: options.scale || [1, 1, 1],
      params: options.params || {},
      duration: options.duration,
      loop: options.loop,
      slotId: options.slotId || null,
      trigger: options.trigger || 'manual'
    });
  }

  /**
   * Запустить эффект, прикреплённый к сущности.
   * @param {object|string} entityOrId
   * @param {string|null} slotOrEffectId
   * @param {object} [overrideParams]
   * @returns {string|null}
   */
  play(entityOrId, slotOrEffectId = null, overrideParams = {}) {
    const entity = typeof entityOrId === 'string' ? this.entities.get(entityOrId) : entityOrId;
    if (!entity) return null;

    const slots = entity.effects || [];
    const slot = slots.find((item) => item.id === slotOrEffectId)
      || slots.find((item) => item.effect === slotOrEffectId)
      || (slotOrEffectId == null ? slots[0] : null);

    if (!slot) return null;

    const definition = this._resolveDefinition(slot.effect);
    if (!definition) return null;

    return this.createInstance(definition, {
      parent: entity,
      position: slot.offset || [0, 0, 0],
      rotation: slot.rotation || [0, 0, 0],
      scale: slot.scale || [1, 1, 1],
      params: { ...(slot.params || {}), ...(overrideParams || {}) },
      duration: slot.duration,
      loop: slot.loop,
      slotId: slot.id,
      trigger: slot.trigger
    });
  }

  /**
   * @param {string|object} instanceOrEntityId
   * @param {string|null} [slotId]
   * @param {boolean} [immediate=true]
   * @returns {number} сколько инстансов остановлено
   */
  stop(instanceOrEntityId, slotId = null, immediate = true) {
    if (typeof instanceOrEntityId === 'string' && this.instances.has(instanceOrEntityId)) {
      this._releaseInstance(instanceOrEntityId);
      return 1;
    }

    const entity = typeof instanceOrEntityId === 'string'
      ? this.entities.get(instanceOrEntityId)
      : instanceOrEntityId;
    if (!entity) return 0;

    let count = 0;
    for (const [id, instance] of this.instances) {
      if (instance.parent !== entity) continue;
      if (slotId && instance.slotId !== slotId) continue;
      this._releaseInstance(id, immediate);
      count++;
    }
    return count;
  }

  /**
   * @param {string|object} instanceOrEntityId
   * @param {object|string} slotIdOrParams
   * @param {object} [params]
   * @returns {boolean}
   */
  setParams(instanceOrEntityId, slotIdOrParams = {}, params = {}) {
    const instance = typeof instanceOrEntityId === 'string'
      ? this.instances.get(instanceOrEntityId)
      : null;

    if (instance) {
      instance.params = { ...instance.params, ...(slotIdOrParams || {}) };
      return true;
    }

    const entity = typeof instanceOrEntityId === 'string'
      ? this.entities.get(instanceOrEntityId)
      : instanceOrEntityId;
    if (!entity) return false;

    const slotId = typeof slotIdOrParams === 'string' ? slotIdOrParams : null;
    const patch = typeof slotIdOrParams === 'string' ? params : (slotIdOrParams || {});
    let changed = false;

    for (const active of this.instances.values()) {
      if (active.parent !== entity) continue;
      if (slotId && active.slotId !== slotId) continue;
      active.params = { ...active.params, ...(patch || {}) };
      changed = true;
    }

    return changed;
  }

  /**
   * @param {string|object} instanceOrEntityId
   * @param {string|null} [slotId]
   * @returns {boolean}
   */
  isActive(instanceOrEntityId, slotId = null) {
    if (typeof instanceOrEntityId === 'string' && this.instances.has(instanceOrEntityId)) return true;

    const entity = typeof instanceOrEntityId === 'string'
      ? this.entities.get(instanceOrEntityId)
      : instanceOrEntityId;
    if (!entity) return false;

    for (const instance of this.instances.values()) {
      if (instance.parent !== entity) continue;
      if (!slotId || instance.slotId === slotId) return true;
    }
    return false;
  }

  /* -------------------------- Жизненный цикл ------------------------------- */

  _resolveDefinition(spec) {
    if (typeof spec === 'string') {
      return this.definitions.get(spec) || this.registerDefinition(spec, {
        title: spec,
        duration: 1,
        loop: false,
        layers: []
      });
    }

    if (!spec || typeof spec !== 'object') return null;

    if (Array.isArray(spec.layers)) {
      const id = spec.id || `inline-${++this.counter}`;
      return this.registerDefinition(id, spec);
    }

    if (spec.effect) {
      const base = this._resolveDefinition(spec.effect);
      if (!base) return null;
      return {
        ...base,
        ...spec,
        params: { ...(base.params || {}), ...(spec.params || {}) },
        layers: Array.isArray(spec.layers) ? spec.layers : base.layers
      };
    }

    return null;
  }

  createInstance(definition, options) {
    const id = `vfx-${++this.instanceCounter}`;
    const instance = this.pool.pop() || {};

    instance.id = id;
    instance.definition = definition;
    instance.layers = definition.layers || [];
    instance.params = { ...(options.params || {}) };
    instance.parent = options.parent || null;
    instance.slotId = options.slotId || null;
    instance.trigger = options.trigger || 'manual';
    instance.offset = (options.position || [0, 0, 0]).slice();
    instance.rotation = (options.rotation || [0, 0, 0]).slice();
    instance.scale = Array.isArray(options.scale) ? options.scale.slice() : [1, 1, 1];
    instance.loop = options.loop != null ? Boolean(options.loop) : Boolean(definition.loop);
    instance.duration = Math.max(0.01, numberOr(options.duration, definition.duration || 1));
    instance.elapsed = 0;
    instance.progress = 0;
    instance.playing = true;
    instance.position = instance.offset.slice();
    instance.state = { accumulator: 0, started: false, sparked: false };

    this.instances.set(id, instance);
    this._updateInstancePosition(instance);

    // Стартовые слои (например, вспышка/искры) получают dt=0.
    instance.state.started = true;
    for (const layer of instance.layers) {
      const handler = this.handlers.get(layer.type);
      if (handler) handler(instance, layer, 0, this);
    }

    return id;
  }

  _updateInstancePosition(instance) {
    if (instance.parent?.matrix) {
      instance.position = transformPoint(instance.parent.matrix, instance.offset);
    } else {
      instance.position = instance.offset.slice();
    }
  }

  _releaseInstance(id, immediate = true) {
    const instance = this.instances.get(id);
    if (!instance) return false;
    this.instances.delete(id);

    instance.playing = false;
    instance.parent = null;
    instance.definition = null;
    instance.layers = [];
    instance.params = {};
    instance.state = {};
    if (this.pool.length < 64) this.pool.push(instance);

    return true;
  }

  /* ------------------------------ Слои ------------------------------------ */

  _updateSmoke(instance, layer, dt) {
    const params = { ...(layer.params || {}), ...(instance.params || {}) };
    const rate = clamp(numberOr(params.rate, 30), 0, 200);
    const life = Math.max(0.05, numberOr(params.life, 1));
    const size = Math.max(0.01, numberOr(params.size, 1));
    const opacity = clamp(numberOr(params.opacity, 0.25), 0, 1);
    const speed = Math.max(0, numberOr(params.speed, 1));
    const spread = Math.max(0, numberOr(params.spread, 0.3));

    instance.state.accumulator += rate * dt;
    let guard = 0;

    while (instance.state.accumulator >= 1 && guard++ < 32) {
      instance.state.accumulator -= 1;
      const offset = randomInSphere(spread);
      const position = [
        instance.position[0] + offset[0],
        instance.position[1] + offset[1],
        instance.position[2] + offset[2]
      ];
      const velocity = [
        (Math.random() - 0.5) * speed,
        (Math.random() - 0.5) * speed,
        (Math.random() - 0.5) * speed
      ];

      this.smoke(`vfx-smoke-${++this.counter}`, {
        position,
        velocity,
        color: toColor(params.color, [0.55, 0.58, 0.64]),
        size,
        opacity,
        size0: size * 0.35,
        size1: size,
        opacity0: opacity,
        opacity1: 0,
        life,
        ttl: life
      });
    }
  }

  _updateSpark(instance, layer) {
    if (instance.state.sparked) return;
    instance.state.sparked = true;

    const params = { ...(layer.params || {}), ...(instance.params || {}) };
    const count = Math.max(1, Math.min(32, Math.round(numberOr(params.count, 8))));
    const size = Math.max(0.01, numberOr(params.size, 0.5));
    const spread = Math.max(0, numberOr(params.spread, 1));

    for (let i = 0; i < count; i++) {
      const offset = randomInSphere(spread);
      this.spark(`vfx-spark-${++this.counter}`, {
        position: [
          instance.position[0] + offset[0],
          instance.position[1] + offset[1],
          instance.position[2] + offset[2]
        ],
        color: toColor(params.color, [1, 0.65, 0.25]),
        size,
        ttl: Math.max(0.05, numberOr(params.life, 0.25))
      });
    }
  }

  /* ------------------------------- Update --------------------------------- */

  update(dt) {
    const step = Math.max(0, Number(dt) || 0);

    // Старые покадровые примитивы: ttl + необязательное движение/затухание.
    for (const [id, item] of this.items) {
      item.ttl -= step;

      if (Array.isArray(item.velocity)) {
        item.position = (item.position || [0, 0, 0]).map((value, index) => value + item.velocity[index] * step);
      }

      if (item.life > 0) {
        const progress = clamp(1 - item.ttl / item.life, 0, 1);
        if (Number.isFinite(item.size0) && Number.isFinite(item.size1)) {
          item.size = item.size0 + (item.size1 - item.size0) * progress;
        }
        if (Number.isFinite(item.opacity0) && Number.isFinite(item.opacity1)) {
          item.opacity = item.opacity0 + (item.opacity1 - item.opacity0) * progress;
        }
      }

      if (item.ttl <= 0) this.items.delete(id);
    }

    for (const [id, instance] of this.instances) {
      if (!instance.playing) continue;

      if (instance.parent) {
        if (instance.parent.visible === false || instance.parent.removed) {
          this._releaseInstance(id);
          continue;
        }
        this._updateInstancePosition(instance);
      }

      const nextElapsed = instance.elapsed + step;
      instance.elapsed = nextElapsed;
      instance.progress = instance.loop
        ? (nextElapsed % instance.duration) / instance.duration
        : clamp(nextElapsed / instance.duration, 0, 1);

      for (const layer of instance.layers) {
        const handler = this.handlers.get(layer.type);
        if (handler) handler(instance, layer, step, this);
      }

      if (!instance.loop && nextElapsed >= instance.duration) {
        this._releaseInstance(id);
      }
    }
  }

  clear() {
    this.items.clear();
    this.instances.clear();
    this.pool.length = 0;
    this.entities.clear();
  }

  byType(type) {
    const result = [];
    for (const item of this.items.values()) {
      if (item.type === type) result.push(item);
    }
    return result;
  }
}
