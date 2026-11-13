/**
 * @fileoverview Бот-турель: находит игрока в конусе обзора, наводится и стреляет.
 *
 * Разделение ответственности:
 *   - `vision.js` — чистые функции конуса, упреждения и доворота;
 *   - этот скрипт — состояние боя (обнаружение, потеря цели, очередь огня)
 *     и выстрелы через `ctx.api.projectiles`.
 *
 * Обнаружение работает только по конусу: пока игрок вне зоны, бот сканирует
 * пространство. Как только цель взята, наведение не ограничено углом — корпус
 * доворачивается в любую сторону, поэтому выстрел возможен независимо от того,
 * где находится игрок. Потеря цели — с задержкой `loseGrace`.
 *
 * Связь: обнаруживший бот рассылает событие `bot.contact`, соседи в радиусе
 * `squadRange` запоминают точку контакта и доворачиваются к ней, пока не увидят
 * игрока сами (стреляют только по собственному контакту).
 */

import { quatFromAxisAngle, quatMul, quatNormalize } from '../../js/math.js';
import { angleBetween, forwardOf, inVisionCone, predictAimPoint, turnToward } from './vision.js';

const FORWARD = [0, 0, -1];

export const params = {
  range: { label: 'Дальность обзора, м', default: 180, min: 10, max: 5000, step: 5 },
  fovDeg: { label: 'Угол обзора, °', default: 140, min: 10, max: 360, step: 5 },
  turnRate: { label: 'Наведение, рад/с', default: 1.6, min: 0.05, max: 20, step: 0.05 },
  scanRate: { label: 'Сканирование, рад/с', default: 0.4, min: 0, max: 5, step: 0.05 },

  fireInterval: { label: 'Интервал огня, с', default: 2.6, min: 0.1, max: 30, step: 0.1 },
  aimToleranceDeg: { label: 'Допуск наведения, °', default: 14, min: 1, max: 90, step: 1 },
  projectile: { label: 'Снаряд: префаб', default: 'rocket', type: 'text' },
  projectileSpeed: { label: 'Снаряд: скорость', default: 120, min: 5, max: 5000, step: 5 },
  projectileLife: { label: 'Снаряд: жизнь, с', default: 5, min: 0.1, max: 60, step: 0.5 },
  muzzleOffset: { label: 'Смещение дула, м', default: 5, min: 0, max: 200, step: 0.5 },
  lead: { label: 'Упреждение, 0…1', default: 0.8, min: 0, max: 1, step: 0.05 },

  loseGrace: { label: 'Потеря цели через, с', default: 3, min: 0, max: 120, step: 0.5 },
  squadRange: { label: 'Связь с ботами, м', default: 400, min: 0, max: 10000, step: 10 },
  squadMemory: { label: 'Память о контакте, с', default: 4, min: 0.1, max: 60, step: 0.5 }
};

function number(value, fallback, min, max) {
  const result = Number(value);
  if (!Number.isFinite(result)) return fallback;
  return Math.min(max, Math.max(min, result));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v) {
  const len = length(v);
  return len < 1e-9 ? [0, 0, -1] : [v[0] / len, v[1] / len, v[2] / len];
}

function worldPosition(entity) {
  const matrix = entity?.matrix;
  if (matrix) return [matrix[12], matrix[13], matrix[14]];
  return (entity?.position || [0, 0, 0]).slice(0, 3);
}

/** Игрок сцены: движок отдаёт его в ctx.api.player, иначе ищем по тегу. */
function resolvePlayer(ctx) {
  if (ctx.api.player) return ctx.api.player;

  const entities = ctx.api.entities || [];
  return entities.find((entity) => (entity.raw?.tags || []).includes('player')) || null;
}

function velocityOf(ctx, player) {
  const velocity = ctx.api.getVelocity?.(player);
  if (Array.isArray(velocity)) return velocity;
  return player?.body?.velocity || [0, 0, 0];
}

export default {
  init(ctx) {
    ctx.state.engaged = false;
    ctx.state.lastSeen = Infinity;
    ctx.state.lastKnown = null;
    ctx.state.suspicion = 0;
    ctx.state.cooldown = 0;
    ctx.state.shots = 0;
    ctx.state.contacts = 0;

    // Соседний бот увидел игрока — запоминаем точку, но стреляем только сами
    ctx.state.unsubscribe = ctx.api.on?.('bot.contact', (event) => {
      if (!event || !event.position || event.from === ctx.entity.id) return;

      const range = number(ctx.params.squadRange, 400, 0, 10000);
      if (length(sub(event.position, worldPosition(ctx.entity))) > range) return;

      ctx.state.suspicion = Math.max(
        ctx.state.suspicion,
        number(ctx.params.squadMemory, 4, 0.1, 60)
      );
      ctx.state.lastKnown = event.position.slice(0, 3);
      ctx.state.contacts += 1;
    });
  },

  update(ctx, dt) {
    const state = ctx.state;
    const entity = ctx.entity;
    const step = clamp(Number(dt) || 0, 0, 0.1);

    state.cooldown = Math.max(0, state.cooldown - step);
    state.suspicion = Math.max(0, state.suspicion - step);

    const position = worldPosition(entity);
    const player = resolvePlayer(ctx);
    const turnRate = number(ctx.params.turnRate, 1.6, 0.05, 20);

    if (!player) {
      this.patrol(ctx, step, turnRate);
      return;
    }

    const target = worldPosition(player);
    const forward = forwardOf(entity.quaternion, FORWARD);
    const range = number(ctx.params.range, 180, 1, 5000);
    const halfAngle = number(ctx.params.fovDeg, 140, 10, 360) * Math.PI / 360;
    const visible = inVisionCone({ position, forward, target, range, halfAngle });

    if (visible) {
      const firstContact = !state.engaged;
      state.engaged = true;
      state.lastSeen = 0;
      state.lastKnown = target.slice();

      if (firstContact) {
        ctx.api.emit?.({
          type: 'bot.contact',
          from: entity.id,
          target: player.id || null,
          position: position.slice()
        });
      }
    } else {
      state.lastSeen += step;
      if (state.lastSeen > number(ctx.params.loseGrace, 3, 0, 120)) {
        state.engaged = false;
      }
    }

    if (!state.engaged) {
      this.patrol(ctx, step, turnRate);
      return;
    }

    // Наведение не ограничено конусом: корпус доворачивается куда угодно
    const velocity = velocityOf(ctx, player);
    const projectileSpeed = number(ctx.params.projectileSpeed, 120, 5, 5000);
    const aimPoint = predictAimPoint(position, target, velocity, projectileSpeed, number(ctx.params.lead, 0.8, 0, 1));
    const direction = normalize(sub(aimPoint, position));

    entity.quaternion = turnToward(entity.quaternion, direction, turnRate * step, FORWARD);
    ctx.api.setQuaternion?.(entity, entity.quaternion);

    const aimed = angleBetween(forwardOf(entity.quaternion, FORWARD), direction);
    const tolerance = number(ctx.params.aimToleranceDeg, 14, 1, 90) * Math.PI / 180;

    if (state.cooldown <= 0 && aimed <= tolerance) {
      this.fire(ctx, position, direction);
      state.cooldown = number(ctx.params.fireInterval, 1.6, 0.1, 30);
    }
  },

  /** Ожидание: доворот к точке контакта или плавное сканирование. */
  patrol(ctx, step, turnRate) {
    const state = ctx.state;
    const entity = ctx.entity;

    if (state.suspicion > 0 && state.lastKnown) {
      const direction = normalize(sub(state.lastKnown, worldPosition(entity)));
      entity.quaternion = turnToward(entity.quaternion, direction, turnRate * 0.6 * step, FORWARD);
      ctx.api.setQuaternion?.(entity, entity.quaternion);
      return;
    }

    const scanRate = number(ctx.params.scanRate, 0.4, 0, 5);
    if (scanRate <= 0) return;

    entity.quaternion = quatNormalize(
      quatMul(quatFromAxisAngle([0, 1, 0], scanRate * step), entity.quaternion)
    );
    ctx.api.setQuaternion?.(entity, entity.quaternion);
  },

  fire(ctx, position, direction) {
    const state = ctx.state;
    const from = add(position, scale(direction, number(ctx.params.muzzleOffset, 5, 0, 200)));
    state.shots += 1;

    const shot = ctx.api.projectiles?.fire?.({
      prefab: ctx.params.projectile || 'rocket',
      from,
      direction,
      speed: number(ctx.params.projectileSpeed, 120, 5, 5000),
      life: number(ctx.params.projectileLife, 5, 0.1, 60),
      owner: ctx.entity
    });

    // Вспышка только если снаряд действительно ушёл: пустой пул не рисует выстрел
    if (!shot) return;

    ctx.api.effects?.spark?.(`bot-muzzle-${ctx.entity.id}-${state.shots}`, {
      position: from,
      color: [1, 0.62, 0.28],
      size: 0.8,
      intensity: 2,
      ttl: 0.12
    });
  },

  dispose(ctx) {
    ctx.state.unsubscribe?.();
  }
};
