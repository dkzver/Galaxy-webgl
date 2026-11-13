// Пулемёт как самостоятельное оружие: скрипт живёт на объекте «Оружие»
// в префабе игрока, а не внутри общего weapons.js.
//
// Точки вылета задаются в редакторе (muzzle1…muzzle4) и собираются в массив
// state.muzzles: выстрелы идут по кругу, поэтому стволы стреляют по очереди.
// Если точки не заданы — стреляем из носа корабля.
//
// Если в сцене есть weapons.js (панель оружия), пулемёт работает только при
// выбранном слоте «ПУЛЕМЁТ»: панель владеет переключением, скрипт — стрельбой.

import { quatRotate } from '../js/math.js';

export const params = {
  body: { label: 'Корабль', default: '', type: 'entity' },

  muzzle1: { label: 'Точка вылета 1', default: 'gun-left', type: 'entity' },
  muzzle2: { label: 'Точка вылета 2', default: 'gun-right', type: 'entity' },
  muzzle3: { label: 'Точка вылета 3', default: '', type: 'entity' },
  muzzle4: { label: 'Точка вылета 4', default: '', type: 'entity' },

  targetDistance: { label: 'Дальность прицела', default: 500, min: 20, max: 5000, step: 10 },
  count: { label: 'Выстрелов в очереди', default: 25, min: 1, max: 200, step: 1 },
  interval: { label: 'Интервал, с', default: 0.2, min: 0.02, max: 2, step: 0.01 },
  cooldown: { label: 'Перезарядка, с', default: 0.8, min: 0, max: 10, step: 0.1 },
  speed: { label: 'Скорость трассера', default: 650, min: 50, max: 5000, step: 10 },
  life: { label: 'Жизнь трассера, с', default: 1.2, min: 0.1, max: 10, step: 0.1 },
  width: { label: 'Толщина трассера', default: 7, min: 1, max: 30, step: 1 }
};

const COLORS = {
  tracer: [1.0, 0.62, 0.28],
  spark: [1.0, 0.75, 0.35],
  smoke: [0.72, 0.78, 0.86]
};

function number(value, fallback, min, max) {
  const result = Number(value);
  if (!Number.isFinite(result)) return fallback;
  return Math.min(max, Math.max(min, result));
}

function worldPosition(entity) {
  const matrix = entity?.matrix;
  if (matrix) return [matrix[12], matrix[13], matrix[14]];
  return (entity?.position || [0, 0, 0]).slice();
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

function normalize(a) {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

export default {
  init(ctx) {
    ctx.api.claim('machinegun');

    const state = ctx.state;
    state.burstRemaining = 0;
    state.burstTotal = 0;
    state.burstTimer = 0;
    state.cooldown = 0;
    state.firing = false;
    state.side = 0;
    state.shots = 0;
    state.tracers = new Map();

    // Массив точек вылета: пустые значения отбрасываем, порядок сохраняем.
    state.muzzles = [ctx.params.muzzle1, ctx.params.muzzle2, ctx.params.muzzle3, ctx.params.muzzle4]
      .filter((id) => typeof id === 'string' && id.length > 0);

    // Панель оружия (weapons.js) сама решает, когда выбран пулемёт.
    state.panel = (ctx.api.entities || []).some((entity) => (entity.scripts || [])
      .some((script) => String(script.file || '').endsWith('weapons.js')));

    this.publishStatus(ctx);
    if (!state.panel) ctx.api.hud?.setText?.('weapon-status', 'ГОТОВ');
  },

  update(ctx, dt) {
    const state = ctx.state;
    const step = Math.min(0.1, Math.max(0, dt));

    state.cooldown = Math.max(0, state.cooldown - step);

    const blocked = Boolean(ctx.api.hud?.isVisible?.('hud-menu'));
    if (blocked) {
      state.burstRemaining = 0;
      state.firing = false;
      this.updateTracers(ctx, step);
      this.publishStatus(ctx);
      this.updateHud(ctx);
      return;
    }

    const allowed = this.allowed(ctx);
    const mouseDown = Boolean(ctx.api.input?.mouse?.down) && allowed;
    const pressed = mouseDown && !state.firing;
    state.firing = mouseDown;

    if (pressed) this.startBurst(ctx);
    this.updateBurst(ctx, step);
    this.updateTracers(ctx, step);
    this.publishStatus(ctx);
    this.updateHud(ctx);
  },

  /** Панель оружия есть — стреляем только на выбранном слоте «пулемёт». */
  allowed(ctx) {
    if (!ctx.state.panel) return true;
    const status = ctx.api.shared?.get?.('weapons.status');
    return status?.id === 'machinegun';
  },

  startBurst(ctx) {
    const state = ctx.state;
    if (state.burstRemaining > 0 || state.cooldown > 0) return;

    state.burstTotal = number(ctx.params.count, 25, 1, 200);
    state.burstRemaining = state.burstTotal;
    state.burstTimer = 0;

    this.spawnTracer(ctx);
    state.burstRemaining -= 1;
    state.burstTimer = number(ctx.params.interval, 0.2, 0.02, 2);

    if (state.burstRemaining === 0) {
      state.cooldown = number(ctx.params.cooldown, 0.8, 0, 10);
    }
  },

  updateBurst(ctx, dt) {
    const state = ctx.state;
    if (state.burstRemaining <= 0) return;

    state.burstTimer -= dt;

    // Накопитель: при просадке кадров очередь догоняет долг, а не растягивается.
    while (state.burstRemaining > 0 && state.burstTimer <= 0) {
      this.spawnTracer(ctx);
      state.burstRemaining -= 1;
      state.burstTimer += number(ctx.params.interval, 0.2, 0.02, 2);
    }

    if (state.burstRemaining === 0) {
      state.cooldown = number(ctx.params.cooldown, 0.8, 0, 10);
    }
  },

  /** Точка вылета по кругу: 1-я, 2-я, … затем снова 1-я. */
  muzzle(ctx) {
    const state = ctx.state;
    const ids = state.muzzles || [];
    const id = ids.length ? ids[state.side % ids.length] : null;

    state.side += 1;

    const entity = id ? ctx.api.find?.(id) : null;
    if (entity) return worldPosition(entity);

    const body = ctx.api.find?.(ctx.params.body) || ctx.api.player;
    if (!body) return [0, 0, 0];

    const forward = quatRotate(body.quaternion || [0, 0, 0, 1], [0, 0, -1]);
    return add(worldPosition(body), scale(forward, 5));
  },

  target(ctx) {
    const aim = ctx.api.aimTarget?.();
    if (Array.isArray(aim) && aim.length >= 3) return aim.slice(0, 3);

    const body = ctx.api.find?.(ctx.params.body) || ctx.api.player;
    if (!body) return null;

    const forward = quatRotate(body.quaternion || [0, 0, 0, 1], [0, 0, -1]);
    return add(worldPosition(body), scale(forward, number(ctx.params.targetDistance, 500, 20, 5000)));
  },

  spawnTracer(ctx) {
    const origin = this.muzzle(ctx);
    const target = this.target(ctx);
    if (!target) return;

    const state = ctx.state;
    const id = `mg-${++state.shots}`;

    state.tracers.set(id, {
      position: origin.slice(),
      previous: origin.slice(),
      direction: normalize(sub(target, origin)),
      speed: number(ctx.params.speed, 650, 50, 5000),
      life: number(ctx.params.life, 1.2, 0.1, 10),
      age: 0,
      smokeTimer: 0,
      distance: Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2])
    });

    ctx.api.emit?.({
      type: 'weapon.fire',
      weapon: 'machinegun',
      mode: 'burst',
      kind: 'tracer',
      muzzle: id
    });

    ctx.api.effects?.tracer?.(id, {
      from: origin,
      to: origin,
      color: COLORS.tracer,
      width: number(ctx.params.width, 7, 1, 30),
      intensity: 2.1,
      ttl: 0.06
    });
  },

  updateTracers(ctx, dt) {
    const state = ctx.state;
    const width = number(ctx.params.width, 7, 1, 30);

    for (const [id, tracer] of state.tracers) {
      tracer.previous = tracer.position.slice();
      tracer.position = add(tracer.position, scale(tracer.direction, tracer.speed * dt));
      tracer.age += dt;
      tracer.smokeTimer += dt;

      const traveled = Math.hypot(
        tracer.position[0] - tracer.previous[0],
        tracer.position[1] - tracer.previous[1],
        tracer.position[2] - tracer.previous[2]
      );
      tracer.distance -= traveled;

      if (tracer.distance <= 0) {
        ctx.api.effects?.spark?.(`spark-${id}`, {
          position: tracer.position,
          color: COLORS.spark,
          size: 1.1,
          intensity: 2.5,
          ttl: 0.18
        });
        state.tracers.delete(id);
        continue;
      }

      if (tracer.age > tracer.life) {
        state.tracers.delete(id);
        continue;
      }

      ctx.api.effects?.tracer?.(id, {
        from: tracer.previous,
        to: tracer.position,
        color: COLORS.tracer,
        width,
        intensity: 2.1,
        ttl: 0.06
      });

      if (tracer.smokeTimer >= 0.03) {
        tracer.smokeTimer = 0;
        ctx.api.effects?.smoke?.(`smoke-${id}-${Math.floor(tracer.age * 100)}`, {
          position: tracer.position,
          size: 0.8,
          color: COLORS.smoke,
          opacity: 0.22,
          ttl: 0.55
        });
      }
    }
  },

  publishStatus(ctx) {
    const state = ctx.state;
    ctx.api.shared?.set?.('machinegun.status', {
      mode: 'burst',
      burstRemaining: state.burstRemaining,
      burstTotal: state.burstTotal,
      cooldown: state.cooldown,
      cooldownTotal: number(ctx.params.cooldown, 0.8, 0, 10),
      firing: state.burstRemaining > 0
    });
  },

  updateHud(ctx) {
    const state = ctx.state;
    if (state.panel) return; // строку статуса пишет панель оружия

    let status = 'ГОТОВ';
    if (state.burstRemaining > 0) {
      status = `ОЧЕРЕДЬ ${state.burstTotal - state.burstRemaining}/${state.burstTotal}`;
    } else if (state.cooldown > 0) {
      status = `ПЕРЕЗАРЯДКА ${state.cooldown.toFixed(1)} С`;
    }

    ctx.api.hud?.setText?.('weapon-status', status);
  },

  dispose(ctx) {
    ctx.api.shared?.delete?.('machinegun.status');
    ctx.state.tracers?.clear();
  }
};
