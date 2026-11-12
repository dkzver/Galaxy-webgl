/**
 * @fileoverview Твёрдые тела и физический мир.
 *
 * Шаг мира: гравитация → broad phase → narrow phase → импульсы → интеграция
 * → позиционная коррекция → события. Модуль чистый, работает в Node.js.
 */

import { quatIdentity, quatMul, quatFromAxisAngle } from '../math.js';
import {
  clamp,
  numberOr,
  toVec3,
  normalizeQuat,
  sphereShape,
  localSpheres,
  localBoxes,
  boxPartRadius,
  worldPoint
} from './shapes.js';
import { boxSphereContact, boxBoxGeometry, sphereNormal } from './narrowphase.js';

/* --------------------------------- Тело ---------------------------------- */

let nextBodyId = 1;

/**
 * Твёрдое тело. Масса 0 (или type: 'static') делает тело неподвижным:
 * импульсы его не двигают, но оно участвует в контактах.
 */
export class Body {
  constructor(definition = {}) {
    this.id = definition.id ?? nextBodyId++;
    this.name = definition.name || `body-${this.id}`;

    // С какими телами не считаем контакты: родитель и его жёстко
    // прикреплённые дети не должны отталкивать друг друга
    this.ignores = new Set();

    const staticBody =
      definition.type === 'static' ||
      definition.mass === 0 ||
      definition.mass === Infinity;

    this.type = staticBody ? 'static' : 'dynamic';
    this.shape = definition.shape || sphereShape(0.5);
    this.position = toVec3(definition.position);
    this.quaternion = definition.quaternion
      ? normalizeQuat(definition.quaternion)
      : quatIdentity();
    this.lockRotation = Boolean(definition.lockRotation);
    this.velocity = staticBody ? [0, 0, 0] : toVec3(definition.velocity);
    this.angularVelocity = staticBody || this.lockRotation
      ? [0, 0, 0]
      : toVec3(definition.angularVelocity);

    const requestedMass = numberOr(definition.mass, 1);
    if (!staticBody && requestedMass <= 0) {
      throw new Error('Body: масса динамического тела должна быть больше нуля');
    }

    this.mass = staticBody ? 0 : Math.max(requestedMass, 1e-4);
    this.invMass = this.mass > 0 ? 1 / this.mass : 0;

    const inertia = staticBody
      ? 0
      : numberOr(definition.inertia, 0.4 * this.mass * this.shape.boundingRadius ** 2);
    this.inertia = Math.max(0, inertia);
    this.invInertia = this.inertia > 0 && !this.lockRotation ? 1 / this.inertia : 0;

    this.restitution = clamp(numberOr(definition.restitution, 0.2), 0, 1);
    this.friction = Math.max(0, numberOr(definition.friction, 0.3));
    this.linearDamping = Math.max(0, numberOr(definition.linearDamping, 0));
    this.angularDamping = Math.max(0, numberOr(definition.angularDamping, 0.05));

    // Произвольные данные игрового слоя (тип сущности, ссылка на модель).
    this.userData = definition.userData ?? null;

    this.aabb = { min: [0, 0, 0], max: [0, 0, 0] };
    this.updateAABB();
  }

  get isStatic() {
    return this.invMass === 0;
  }

  get isDynamic() {
    return this.invMass > 0;
  }

  updateAABB() {
    const radius = this.shape.boundingRadius;
    this.aabb.min[0] = this.position[0] - radius;
    this.aabb.min[1] = this.position[1] - radius;
    this.aabb.min[2] = this.position[2] - radius;
    this.aabb.max[0] = this.position[0] + radius;
    this.aabb.max[1] = this.position[1] + radius;
    this.aabb.max[2] = this.position[2] + radius;
    return this;
  }

  setPosition(position) {
    const next = toVec3(position, this.position);
    this.position[0] = next[0];
    this.position[1] = next[1];
    this.position[2] = next[2];
    return this.updateAABB();
  }

  setQuaternion(quaternion) {
    this.quaternion = normalizeQuat(quaternion);
    return this;
  }

  setVelocity(velocity) {
    if (this.invMass === 0) {
      this.velocity[0] = 0;
      this.velocity[1] = 0;
      this.velocity[2] = 0;
      return this;
    }

    const next = toVec3(velocity, this.velocity);
    this.velocity[0] = next[0];
    this.velocity[1] = next[1];
    this.velocity[2] = next[2];
    return this;
  }

  setAngularVelocity(angularVelocity) {
    if (this.invInertia === 0) {
      this.angularVelocity[0] = 0;
      this.angularVelocity[1] = 0;
      this.angularVelocity[2] = 0;
      return this;
    }
    const next = toVec3(angularVelocity, this.angularVelocity);
    this.angularVelocity[0] = next[0];
    this.angularVelocity[1] = next[1];
    this.angularVelocity[2] = next[2];
    return this;
  }

  /**
   * Приложить импульс (кг·м/с) в мировой точке. Если точка не задана,
   * импульс действует по центру масс и не раскручивает тело.
   */
  applyImpulse(impulse, worldPoint = null) {
    if (this.invMass === 0) return this;

    const ix = numberOr(impulse?.[0], 0);
    const iy = numberOr(impulse?.[1], 0);
    const iz = numberOr(impulse?.[2], 0);

    this.velocity[0] += ix * this.invMass;
    this.velocity[1] += iy * this.invMass;
    this.velocity[2] += iz * this.invMass;

    if (worldPoint && this.invInertia > 0) {
      const rx = worldPoint[0] - this.position[0];
      const ry = worldPoint[1] - this.position[1];
      const rz = worldPoint[2] - this.position[2];

      this.angularVelocity[0] += (ry * iz - rz * iy) * this.invInertia;
      this.angularVelocity[1] += (rz * ix - rx * iz) * this.invInertia;
      this.angularVelocity[2] += (rx * iy - ry * ix) * this.invInertia;
    }

    return this;
  }
}

/* ------------------------------ Контактные данные ------------------------ */

function applyImpulseAt(body, r, ix, iy, iz) {
  if (body.invMass === 0) return;

  body.velocity[0] += ix * body.invMass;
  body.velocity[1] += iy * body.invMass;
  body.velocity[2] += iz * body.invMass;

  if (body.invInertia > 0) {
    body.angularVelocity[0] += (r[1] * iz - r[2] * iy) * body.invInertia;
    body.angularVelocity[1] += (r[2] * ix - r[0] * iz) * body.invInertia;
    body.angularVelocity[2] += (r[0] * iy - r[1] * ix) * body.invInertia;
  }
}

function relativeVelocity(contact) {
  const { a, b, rA, rB } = contact;
  const av = a.angularVelocity;
  const bv = b.angularVelocity;

  const vax = a.velocity[0] + av[1] * rA[2] - av[2] * rA[1];
  const vay = a.velocity[1] + av[2] * rA[0] - av[0] * rA[2];
  const vaz = a.velocity[2] + av[0] * rA[1] - av[1] * rA[0];

  const vbx = b.velocity[0] + bv[1] * rB[2] - bv[2] * rB[1];
  const vby = b.velocity[1] + bv[2] * rB[0] - bv[0] * rB[2];
  const vbz = b.velocity[2] + bv[0] * rB[1] - bv[1] * rB[0];

  return [vbx - vax, vby - vay, vbz - vaz];
}

// I^-1 для скалярного момента инерции: n · ((I^-1 (r × n)) × r)
function angularMass(body, r, axis) {
  if (body.invInertia === 0) return 0;
  const cx = r[1] * axis[2] - r[2] * axis[1];
  const cy = r[2] * axis[0] - r[0] * axis[2];
  const cz = r[0] * axis[1] - r[1] * axis[0];
  return (cx * cx + cy * cy + cz * cz) * body.invInertia;
}

function effectiveMass(a, b, rA, rB, axis) {
  return a.invMass + b.invMass + angularMass(a, rA, axis) + angularMass(b, rB, axis);
}

/* --------------------------------- Мир ----------------------------------- */

/**
 * Физический мир с фиксированным шагом и накоплением времени.
 *
 * ```js
 * const world = new PhysicsWorld({ fixedStep: 1 / 120, iterations: 8 });
 * const rock = world.addBody({ type: 'static', position: [0, 0, -20], shape: sphereShape(5) });
 * const ship = world.addBody({ mass: 12, position: [0, 0, 0], shape: sphereShape(3), restitution: 0.55 });
 *
 * world.on('impact', (event) => console.log(event.speed));
 * world.step(dt);
 * ```
 */
export class PhysicsWorld {
  constructor(options = {}) {
    this.gravity = toVec3(options.gravity, [0, 0, 0]);
    this.fixedStep = Math.max(numberOr(options.fixedStep, 1 / 120), 1e-4);
    this.maxSubSteps = Math.max(1, Math.floor(numberOr(options.maxSubSteps, 6)));
    this.iterations = Math.max(1, Math.floor(numberOr(options.iterations, 8)));
    this.positionIterations = Math.max(1, Math.floor(numberOr(options.positionIterations, 3)));
    this.positionCorrection = clamp(numberOr(options.positionCorrection, 0.9), 0, 1);
    this.slop = Math.max(0, numberOr(options.slop, 0.001));
    this.restitutionThreshold = Math.max(0, numberOr(options.restitutionThreshold, 1.0));
    this.impactThreshold = Math.max(0, numberOr(options.impactThreshold, 2.0));

    this.bodies = [];
    this.contacts = [];
    this.manifolds = [];

    this.stats = {
      bodies: 0,
      pairs: 0,
      contacts: 0,
      steps: 0,
      impacts: 0
    };

    this._pairs = [];
    this._accumulator = 0;
    this._listeners = new Map();
    this.narrowphase = {
      boxSphere: 0,
      boxBox: 0,
      culled: 0
    };
  }

  /**
   * Добавить тело. Принимает готовый Body или описание для конструктора.
   * @returns {Body}
   */
  addBody(definition = {}) {
    const body = definition instanceof Body ? definition : new Body(definition);
    if (this.bodies.includes(body)) throw new Error('addBody: тело уже добавлено в этот мир');
    this.bodies.push(body);
    this.stats.bodies = this.bodies.length;
    return body;
  }

  removeBody(bodyOrId) {
    const index = this.bodies.findIndex((body) => body === bodyOrId || body.id === bodyOrId);
    if (index < 0) return false;

    const [body] = this.bodies.splice(index, 1);
    this.contacts = this.contacts.filter((contact) => contact.a !== body && contact.b !== body);
    this.manifolds = this.manifolds.filter((manifold) => manifold.a !== body && manifold.b !== body);
    this._pairs = this._pairs.filter(([a, b]) => a !== body && b !== body);
    this.stats.bodies = this.bodies.length;
    this.stats.pairs = this._pairs.length;
    this.stats.contacts = this.contacts.length;
    return true;
  }

  clear() {
    this.bodies.length = 0;
    this.contacts.length = 0;
    this.manifolds.length = 0;
    this._pairs.length = 0;
    this._accumulator = 0;
    this.stats.bodies = 0;
    this.stats.pairs = 0;
    this.stats.contacts = 0;
    this.stats.steps = 0;
    this.stats.impacts = 0;
  }

  /**
   * Подписка на события. Возвращает функцию отписки.
   *  - 'contact' — есть контакт (каждый шаг, пока тела соприкасаются);
   *  - 'impact'  — скорость сближения выше impactThreshold.
   */
  on(type, handler) {
    if (typeof handler !== 'function') throw new Error('on: обработчик должен быть функцией');
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    const handlers = this._listeners.get(type);
    if (!handlers) return;
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  }

  _emit(type, event) {
    const handlers = this._listeners.get(type);
    if (!handlers || handlers.length === 0) return;
    for (const handler of handlers.slice()) handler(event);
  }

  /**
   * Перенести внешнее состояние в тело (например, управляемый игроком корабль).
   * Копирует значения, массивы игры и физики остаются раздельными.
   */
  syncBody(body, state = {}) {
    if (state.position) body.setPosition(state.position);
    if (state.quaternion) body.setQuaternion(state.quaternion);
    if (state.velocity) body.setVelocity(state.velocity);
    if (state.angularVelocity) body.setAngularVelocity(state.angularVelocity);
    return body;
  }

  /** Приложить импульс к телу в мировой точке. */
  applyImpulse(body, impulse, worldPoint = null) {
    body.applyImpulse(impulse, worldPoint);
    return this;
  }

  /** Сбросить накопленное время (например, после паузы). */
  resetClock() {
    this._accumulator = 0;
  }

  /**
   * Продвинуть мир на dt секунд. Внутри — фиксированные подшаги.
   * @returns {number} сколько подшагов реально выполнено
   */
  step(dt) {
    const frameTime = Math.min(numberOr(dt, 0), this.fixedStep * this.maxSubSteps);
    if (!(frameTime > 0)) {
      this.stats.steps = 0;
      return 0;
    }

    this._accumulator += frameTime;
    let steps = 0;

    while (this._accumulator + 1e-12 >= this.fixedStep && steps < this.maxSubSteps) {
      this.stepFixed(this.fixedStep);
      this._accumulator -= this.fixedStep;
      steps++;
    }

    // Если не успели догнать время, не копим долг бесконечно.
    if (steps === this.maxSubSteps && this._accumulator >= this.fixedStep) {
      this._accumulator = 0;
    }

    this.stats.steps = steps;
    return steps;
  }

  /** Один фиксированный шаг без накопления времени. */
  stepFixed(h = this.fixedStep) {
    this._applyForces(h);
    this._buildPairs();
    this._buildContacts();
    this._solveVelocities();
    this._integratePositions(h);
    this._correctPositions();
    this._updateStats();
    this._emitContacts();
  }

  _applyForces(h) {
    const [gx, gy, gz] = this.gravity;

    for (const body of this.bodies) {
      if (body.invMass === 0) continue;

      body.velocity[0] += gx * h;
      body.velocity[1] += gy * h;
      body.velocity[2] += gz * h;

      if (body.linearDamping > 0) {
        const damping = Math.exp(-body.linearDamping * h);
        body.velocity[0] *= damping;
        body.velocity[1] *= damping;
        body.velocity[2] *= damping;
      }

      if (body.lockRotation) {
        body.angularVelocity[0] = 0;
        body.angularVelocity[1] = 0;
        body.angularVelocity[2] = 0;
      } else if (body.angularDamping > 0) {
        const damping = Math.exp(-body.angularDamping * h);
        body.angularVelocity[0] *= damping;
        body.angularVelocity[1] *= damping;
        body.angularVelocity[2] *= damping;
      }
    }
  }

  // Broad phase: sweep and prune по X, затем проверка Y/Z. Для нескольких
  // десятков тел это дешевле перебора всех пар и не требует сетки.
  _buildPairs() {
    const entries = [];

    for (const body of this.bodies) {
      body.updateAABB();
      entries.push({ body, minX: body.aabb.min[0], maxX: body.aabb.max[0] });
    }

    entries.sort((a, b) => a.minX - b.minX);
    const pairs = [];

    for (let i = 0; i < entries.length; i++) {
      const left = entries[i];

      for (let j = i + 1; j < entries.length; j++) {
        const right = entries[j];
        if (right.minX > left.maxX) break;

        const a = left.body;
        const b = right.body;

        // Два статических тела не могут дать полезного контакта.
        if (a.invMass === 0 && b.invMass === 0) continue;

        if (a.aabb.min[1] > b.aabb.max[1] || b.aabb.min[1] > a.aabb.max[1]) continue;
        if (a.aabb.min[2] > b.aabb.max[2] || b.aabb.min[2] > a.aabb.max[2]) continue;

        pairs.push([a, b]);
      }
    }

    this._pairs = pairs;
  }

  _buildContacts() {
    this.contacts.length = 0;
    this.manifolds.length = 0;
    this.narrowphase.boxSphere = 0;
    this.narrowphase.boxBox = 0;
    this.narrowphase.culled = 0;

    for (const [a, b] of this._pairs) {
      const manifold = this._collide(a, b);
      if (!manifold) continue;

      this.manifolds.push(manifold);
      for (const contact of manifold.contacts) this.contacts.push(contact);
    }
  }

  // Narrow phase: сферы ↔ сферы, боксы ↔ сферы, боксы ↔ боксы.
  // Части compound перебираются попарно, нормаль контакта всегда от A к B.
  _collide(a, b) {
    if (a.ignores?.has(b) || b.ignores?.has(a)) return null;

    const contacts = [];
    const spheresA = localSpheres(a);
    const spheresB = localSpheres(b);
    const boxesA = localBoxes(a);
    const boxesB = localBoxes(b);

    for (const sphereA of spheresA) {
      for (const sphereB of spheresB) {
        const normal = sphereNormal(a, sphereA, b, sphereB);
        if (!normal) continue;

        const centerA = worldPoint(a, sphereA.offset);
        const penetration = sphereA.radius + sphereB.radius - normal.distance;

        contacts.push(this._makeContact(a, b, {
          normal: normal.direction,
          point: [
            centerA[0] + normal.direction[0] * (sphereA.radius - penetration * 0.5),
            centerA[1] + normal.direction[1] * (sphereA.radius - penetration * 0.5),
            centerA[2] + normal.direction[2] * (sphereA.radius - penetration * 0.5)
          ],
          penetration,
          sphereA,
          sphereB
        }));
      }
    }

    for (const boxPart of boxesA) {
      for (const sphere of spheresB) {
        const reach = boxPartRadius(boxPart) + sphere.radius;
        const boxCenter = worldPoint(a, boxPart.offset);
        const sphereCenter = worldPoint(b, sphere.offset);
        const dx = sphereCenter[0] - boxCenter[0];
        const dy = sphereCenter[1] - boxCenter[1];
        const dz = sphereCenter[2] - boxCenter[2];
        if (dx * dx + dy * dy + dz * dz >= reach * reach) {
          this.narrowphase.culled++;
          continue;
        }

        this.narrowphase.boxSphere++;
        const geometry = boxSphereContact(a, boxPart, b, sphere);
        if (!geometry) continue;

        contacts.push(this._makeContact(a, b, {
          normal: geometry.outward,
          point: geometry.point,
          penetration: geometry.penetration,
          boxBody: a,
          boxPart,
          sphereBody: b,
          sphere
        }));
      }
    }

    for (const sphere of spheresA) {
      for (const boxPart of boxesB) {
        const reach = boxPartRadius(boxPart) + sphere.radius;
        const boxCenter = worldPoint(b, boxPart.offset);
        const sphereCenter = worldPoint(a, sphere.offset);
        const dx = sphereCenter[0] - boxCenter[0];
        const dy = sphereCenter[1] - boxCenter[1];
        const dz = sphereCenter[2] - boxCenter[2];
        if (dx * dx + dy * dy + dz * dz >= reach * reach) {
          this.narrowphase.culled++;
          continue;
        }

        this.narrowphase.boxSphere++;
        const geometry = boxSphereContact(b, boxPart, a, sphere);
        if (!geometry) continue;

        contacts.push(this._makeContact(a, b, {
          normal: [-geometry.outward[0], -geometry.outward[1], -geometry.outward[2]],
          point: geometry.point,
          penetration: geometry.penetration,
          boxBody: b,
          boxPart,
          sphereBody: a,
          sphere
        }));
      }
    }

    for (const partA of boxesA) {
      for (const partB of boxesB) {
        const reach = boxPartRadius(partA) + boxPartRadius(partB);
        const centerA = worldPoint(a, partA.offset);
        const centerB = worldPoint(b, partB.offset);
        const dx = centerB[0] - centerA[0];
        const dy = centerB[1] - centerA[1];
        const dz = centerB[2] - centerA[2];
        if (dx * dx + dy * dy + dz * dz >= reach * reach) {
          this.narrowphase.culled++;
          continue;
        }

        this.narrowphase.boxBox++;
        const geometry = boxBoxGeometry(a, partA, b, partB);
        if (!geometry) continue;

        // Одна пара боксов даёт несколько точек касания. Импульсы считаем
        // по всем, а позиционную коррекцию — один раз на пару, иначе тело
        // выталкивается столько раз, сколько вершин попало внутрь.
        const boxPair = {};

        for (const point of geometry.points) {
          contacts.push(this._makeContact(a, b, {
            normal: geometry.normal,
            point,
            penetration: geometry.overlap,
            bodyA: a,
            partA,
            bodyB: b,
            partB,
            boxPair
          }));
        }
      }
    }

    if (!contacts.length) return null;

    let deepest = contacts[0];
    let approachSpeed = 0;

    for (const contact of contacts) {
      if (contact.penetration > deepest.penetration) deepest = contact;
      if (contact.approachSpeed > approachSpeed) approachSpeed = contact.approachSpeed;
    }

    return {
      a,
      b,
      contacts,
      approachSpeed,
      normal: deepest.normal,
      point: deepest.point
    };
  }

  // Один контакт: геометрия, плечи, материал и упругость в одном месте —
  // чтобы сферы, боксы и их смеси считались одинаково.
  _makeContact(a, b, geometry) {
    const { normal, point, penetration } = geometry;

    const contact = {
      a,
      b,
      normal,
      point,
      rA: [point[0] - a.position[0], point[1] - a.position[1], point[2] - a.position[2]],
      rB: [point[0] - b.position[0], point[1] - b.position[1], point[2] - b.position[2]],
      penetration,
      normalImpulse: 0,
      tangentImpulse: 0,
      restitutionBias: 0,
      approachSpeed: 0,
      friction: Math.sqrt(a.friction * b.friction)
    };

    if (geometry.sphereA) {
      contact.sphereA = geometry.sphereA;
      contact.sphereB = geometry.sphereB;
    }
    if (geometry.boxPart) {
      contact.boxBody = geometry.boxBody;
      contact.boxPart = geometry.boxPart;
      contact.sphereBody = geometry.sphereBody;
      contact.sphere = geometry.sphere;
    }
    if (geometry.partA) {
      contact.bodyA = geometry.bodyA;
      contact.partA = geometry.partA;
      contact.bodyB = geometry.bodyB;
      contact.partB = geometry.partB;
      contact.boxPair = geometry.boxPair ?? null;
    }

    const relative = relativeVelocity(contact);
    const normalSpeed =
      relative[0] * normal[0] +
      relative[1] * normal[1] +
      relative[2] * normal[2];

    contact.approachSpeed = Math.max(0, -normalSpeed);

    const restitution = Math.max(a.restitution, b.restitution);
    if (-normalSpeed > this.restitutionThreshold) {
      // Целевая скорость после удара: -e * vn. Порог не даёт дрожать
      // на медленном касании.
      contact.restitutionBias = -restitution * normalSpeed;
    }

    contact.normalMass = 1 / effectiveMass(a, b, contact.rA, contact.rB, normal);
    return contact;
  }

  _solveVelocities() {
    for (let iteration = 0; iteration < this.iterations; iteration++) {
      for (const contact of this.contacts) this._solveContact(contact);
    }
  }

  _solveContact(contact) {
    const { a, b, normal, rA, rB } = contact;

    // Нормальный импульс с накоплением и ограничением снизу:
    // контакт может только отталкивать, но не притягивать.
    const relative = relativeVelocity(contact);
    const normalSpeed =
      relative[0] * normal[0] +
      relative[1] * normal[1] +
      relative[2] * normal[2];

    let lambda = -(normalSpeed - contact.restitutionBias) * contact.normalMass;
    const oldImpulse = contact.normalImpulse;
    const newImpulse = Math.max(0, oldImpulse + lambda);
    lambda = newImpulse - oldImpulse;
    contact.normalImpulse = newImpulse;

    if (lambda !== 0) {
      applyImpulseAt(a, rA, -normal[0] * lambda, -normal[1] * lambda, -normal[2] * lambda);
      applyImpulseAt(b, rB, normal[0] * lambda, normal[1] * lambda, normal[2] * lambda);
    }

    // Трение Кулона: касательный импульс ограничен μ * нормального.
    const friction = contact.friction;
    if (friction <= 0 || contact.normalImpulse <= 0) return;

    const sliding = relativeVelocity(contact);
    const slidingNormal =
      sliding[0] * normal[0] +
      sliding[1] * normal[1] +
      sliding[2] * normal[2];

    let tx = sliding[0] - normal[0] * slidingNormal;
    let ty = sliding[1] - normal[1] * slidingNormal;
    let tz = sliding[2] - normal[2] * slidingNormal;
    const tangentSpeed = Math.hypot(tx, ty, tz);

    if (tangentSpeed < 1e-7) return;

    tx /= tangentSpeed;
    ty /= tangentSpeed;
    tz /= tangentSpeed;

    const tangent = [tx, ty, tz];
    const denominator = effectiveMass(a, b, rA, rB, tangent);
    if (!(denominator > 0)) return;

    let tangentImpulse =
      -(sliding[0] * tx + sliding[1] * ty + sliding[2] * tz) / denominator;

    const maxFriction = friction * contact.normalImpulse;
    const oldTangent = contact.tangentImpulse;
    const newTangent = clamp(oldTangent + tangentImpulse, -maxFriction, maxFriction);
    tangentImpulse = newTangent - oldTangent;
    contact.tangentImpulse = newTangent;

    if (tangentImpulse !== 0) {
      applyImpulseAt(a, rA, -tx * tangentImpulse, -ty * tangentImpulse, -tz * tangentImpulse);
      applyImpulseAt(b, rB, tx * tangentImpulse, ty * tangentImpulse, tz * tangentImpulse);
    }
  }

  _integratePositions(h) {
    for (const body of this.bodies) {
      if (body.invMass === 0) continue;

      body.position[0] += body.velocity[0] * h;
      body.position[1] += body.velocity[1] * h;
      body.position[2] += body.velocity[2] * h;

      if (!body.lockRotation) {
        const wx = body.angularVelocity[0];
        const wy = body.angularVelocity[1];
        const wz = body.angularVelocity[2];
        const speed = Math.hypot(wx, wy, wz);

        if (speed > 1e-7) {
          const angle = speed * h;
          const axis = [wx / speed, wy / speed, wz / speed];
          body.quaternion = normalizeQuat(
            quatMul(quatFromAxisAngle(axis, angle), body.quaternion)
          );
        }
      }

      body.updateAABB();
    }
  }

  // Позиционная коррекция: убираем остаточное проникновение, не добавляя
  // энергии в скорости. Несколько проходов нужны для составных коллайдеров.
  _correctPositions() {
    for (let iteration = 0; iteration < this.positionIterations; iteration++) {
      let moved = false;
      const corrected = new Set();

      for (const contact of this.contacts) {
        const { a, b } = contact;
        const invMassSum = a.invMass + b.invMass;
        if (invMassSum === 0) continue;

        let nx = contact.normal[0];
        let ny = contact.normal[1];
        let nz = contact.normal[2];
        let penetration = contact.penetration;

        if (contact.sphereA && contact.sphereB) {
          const normal = sphereNormal(a, contact.sphereA, b, contact.sphereB);
          if (!normal) continue;
          nx = normal.direction[0];
          ny = normal.direction[1];
          nz = normal.direction[2];
          penetration = contact.sphereA.radius + contact.sphereB.radius - normal.distance;
        } else if (contact.boxPart) {
          // Бокс-сфера: пересчитываем на текущей позиции. С застывшим значением
          // из narrow phase каждая итерация выталкивала бы всё глубже.
          const fresh = boxSphereContact(contact.boxBody, contact.boxPart, contact.sphereBody, contact.sphere);
          if (!fresh) continue;

          const sign = a === contact.boxBody ? 1 : -1;
          nx = fresh.outward[0] * sign;
          ny = fresh.outward[1] * sign;
          nz = fresh.outward[2] * sign;
          penetration = fresh.penetration;
        } else if (contact.partA && contact.partB) {
          // Бокс-бокс: свежий SAT, иначе нормаль устаревает за итерации
          if (contact.boxPair) {
            if (corrected.has(contact.boxPair)) continue;
            corrected.add(contact.boxPair);
          }

          const fresh = boxBoxGeometry(contact.bodyA, contact.partA, contact.bodyB, contact.partB);
          if (!fresh) continue;

          const sign = a === contact.bodyA ? 1 : -1;
          nx = fresh.normal[0] * sign;
          ny = fresh.normal[1] * sign;
          nz = fresh.normal[2] * sign;
          penetration = fresh.overlap;
        }

        if (penetration <= this.slop) continue;
        const correction =
          ((penetration - this.slop) * this.positionCorrection) / invMassSum;

        a.position[0] -= nx * correction * a.invMass;
        a.position[1] -= ny * correction * a.invMass;
        a.position[2] -= nz * correction * a.invMass;
        b.position[0] += nx * correction * b.invMass;
        b.position[1] += ny * correction * b.invMass;
        b.position[2] += nz * correction * b.invMass;

        a.updateAABB();
        b.updateAABB();
        moved = true;
      }

      if (!moved) break;
    }
  }

  _updateStats() {
    this.stats.bodies = this.bodies.length;
    this.stats.pairs = this._pairs.length;
    this.stats.contacts = this.contacts.length;
  }

  _emitContacts() {
    for (const manifold of this.manifolds) {
      const impulse = manifold.contacts.reduce(
        (sum, contact) => sum + contact.normalImpulse,
        0
      );

      const event = {
        a: manifold.a,
        b: manifold.b,
        speed: manifold.approachSpeed,
        point: manifold.point.slice(),
        normal: manifold.normal.slice(),
        impulse
      };

      this._emit('contact', event);

      if (manifold.approachSpeed >= this.impactThreshold) {
        this.stats.impacts++;
        this._emit('impact', event);
      }
    }
  }
}
