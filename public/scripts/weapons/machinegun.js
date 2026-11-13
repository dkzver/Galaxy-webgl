// Пулемёт как самостоятельное оружие: скрипт живёт на объекте «Оружие»
// в префабе игрока, а не внутри общего weapons.js.
//
// Точки вылета задаются в редакторе (muzzle1…muzzle4) и собираются в массив
// state.muzzles: выстрелы идут по кругу, поэтому стволы стреляют по очереди.
// Если точки не заданы — стреляем из носа корабля.
//
// Если в сцене есть weapons.js (панель оружия), пулемёт работает только при
// выбранном слоте «ПУЛЕМЁТ»: панель владеет переключением, скрипт — стрельбой.

import {
  add,
  collectMuzzles,
  muzzlePosition,
  normalize,
  pickMuzzle as nextMuzzle,
  scale,
  sub,
  targetPoint
} from './muzzles.js';

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

export default {
  init(ctx) {
    ctx.api.claim('machinegun');

    const state = ctx.state;
    state.burstRemaining = 0;
    state.burstTotal = 0;
    state.burstTimer = 0;
    state.cooldown = 0;
    state.side = 0;
    state.shots = 0;
    state.tracers = new Map();

    // Массив точек вылета: пустые значения отбрасываем, порядок сохраняем.
    state.muzzles = collectMuzzles(ctx.params);

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

    // Меню сцены отменяет остаток очереди; ввод приходит только от панели.
    const blocked = Boolean(ctx.api.hud?.isVisible?.('hud-menu'));
    if (blocked) state.burstRemaining = 0;

    this.updateBurst(ctx, step);
    this.updateTracers(ctx, step);
    this.publishStatus(ctx);
    this.updateHud(ctx);
  },

  /** Команда от панели оружия: нажали ЛКМ. Отпускание очередь не останавливает. */
  onEvent(ctx, event) {
    if (event.type !== 'weapon.trigger') return;
    if (event.weapon !== 'machinegun') return;

    if (event.down) this.startBurst(ctx);
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

  /** Точка вылета по кругу на текущий выстрел. */
  muzzle(ctx) {
    const id = nextMuzzle(ctx.state);
    return muzzlePosition(ctx, id);
  },

  target(ctx) {
    return targetPoint(ctx, number(ctx.params.targetDistance, 500, 20, 5000));
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
      firing: state.burstRemaining > 0,
      busy: state.burstRemaining > 0
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
