// Оружие игрока: вся логика в этом скрипте.
//
// Движок не знает про режимы оружия — он только рисует эффекты, которые
// присылает скрипт (effects.*), и даёт HUD-контролы.
//
// Точки выстрела — пустые объекты на корабле (muzzleLeft / muzzleRight).
// Если ссылки не заданы, стреляем из носа корабля.

import { quatRotate } from '../js/math.js';

export const params = {
  body: { label: 'Корабль', default: 'ship', type: 'entity' },
  muzzleLeft: { label: 'Точка выстрела L', default: '', type: 'entity' },
  muzzleRight: { label: 'Точка выстрела R', default: '', type: 'entity' },
  targetDistance: { label: 'Дальность прицела', default: 500, min: 20, max: 5000, step: 10 },

  laserDuration: { label: 'Лазер: импульс, с', default: 0.45, min: 0.05, max: 5, step: 0.05 },
  pointerWidth: { label: 'Указка: толщина', default: 8, min: 1, max: 40, step: 1 },

  mgCount: { label: 'Пулемёт: выстрелов', default: 25, min: 1, max: 200, step: 1 },
  mgInterval: { label: 'Пулемёт: интервал, с', default: 0.2, min: 0.02, max: 2, step: 0.01 },
  mgCooldown: { label: 'Пулемёт: перезарядка, с', default: 0.8, min: 0, max: 10, step: 0.1 },
  mgSpeed: { label: 'Пулемёт: скорость', default: 650, min: 50, max: 5000, step: 10 },
  mgLife: { label: 'Пулемёт: жизнь, с', default: 1.2, min: 0.1, max: 10, step: 0.1 },

  rocketCooldown: { label: 'Ракета: перезарядка, с', default: 1.4, min: 0, max: 20, step: 0.1 },
  rocketPrefab: { label: 'Ракета: префаб', default: 'rocket', type: 'text' },
  rocketSpeed: { label: 'Ракета: скорость', default: 95, min: 10, max: 1000, step: 5 },
  rocketLife: { label: 'Ракета: жизнь, с', default: 6, min: 0.5, max: 30, step: 0.5 }
};

const WEAPONS = [
  { id: 'laser', key: '1', name: 'ЛАЗЕР', mode: 'pulse' },
  { id: 'pointer', key: '2', name: 'УКАЗАТЕЛЬ', mode: 'hold' },
  { id: 'machinegun', key: '3', name: 'ПУЛЕМЁТ', mode: 'burst' },
  { id: 'rocket', key: '4', name: 'РАКЕТА', mode: 'single' }
];

const COLORS = {
  laser: [1.0, 0.32, 0.12],
  pointer: [1.0, 0.55, 0.2],
  tracer: [1.0, 0.62, 0.28],
  rocket: [1.0, 0.42, 0.16],
  spark: [1.0, 0.75, 0.35]
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

function worldQuaternion(entity) {
  return (entity?.quaternion || [0, 0, 0, 1]).slice();
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
    ctx.api.claim('weapons');

    ctx.state.index = 0;
    ctx.state.firing = false;
    ctx.state.beamPulse = 0;
    ctx.state.beamHold = false;
    ctx.state.burstRemaining = 0;
    ctx.state.burstTotal = 0;
    ctx.state.burstTimer = 0;
    ctx.state.cooldowns = { laser: 0, pointer: 0, machinegun: 0, rocket: 0 };
    ctx.state.tracers = new Map();
    ctx.state.smoke = 0;
    ctx.state.muzzleSide = 0;

    // Кнопки HUD тоже выбирают оружие
    for (let index = 0; index < WEAPONS.length; index++) {
      ctx.api.hud?.onClick?.(`weapon-slot-${index}`, () => {
        ctx.state.index = index;
        ctx.state.beamPulse = 0;
        ctx.state.beamHold = false;
      });
    }

    this.updateHud(ctx);
    ctx.api.hud?.setText?.('weapon-status', 'ГОТОВ');
  },

  update(ctx, dt) {
    const state = ctx.state;
    const step = Math.min(0.1, Math.max(0, dt));
    const blocked = Boolean(ctx.api.hud?.isVisible?.('hud-menu'));

    this.selectByKeys(ctx);

    for (const id of Object.keys(state.cooldowns)) {
      state.cooldowns[id] = Math.max(0, state.cooldowns[id] - step);
    }

    if (state.beamPulse > 0) state.beamPulse = Math.max(0, state.beamPulse - step);

    const mouseDown = Boolean(ctx.api.input?.mouse?.down) && !blocked;
    const pressed = mouseDown && !state.firing;
    const released = !mouseDown && state.firing;
    state.firing = mouseDown;

    if (pressed) this.fire(ctx);
    if (released) {
      state.beamHold = false;
    }

    this.updateBurst(ctx, step, blocked);
    this.updateTracers(ctx, step);
    this.drawBeam(ctx);
    this.publishStatus(ctx);
    this.updateHud(ctx);
  },

  /** Статус для других скриптов: прицел читает его через api.shared. */
  publishStatus(ctx) {
    const state = ctx.state;
    const weapon = WEAPONS[state.index];
    if (!weapon) return;

    const totals = {
      machinegun: number(ctx.params.mgCooldown, 0.8, 0, 10),
      rocket: number(ctx.params.rocketCooldown, 1.4, 0, 20)
    };
    const cooldown = state.cooldowns[weapon.id] || 0;

    ctx.api.shared?.set?.('weapons.status', {
      id: weapon.id,
      mode: weapon.mode,
      cooldown,
      cooldownTotal: totals[weapon.id] || 0,
      burstRemaining: state.burstRemaining,
      burstTotal: state.burstTotal,
      beamPulse: state.beamPulse,
      beamHold: state.beamHold,
      firing: state.burstRemaining > 0 || state.beamPulse > 0 || state.beamHold
    });
  },

  /** Событие выстрела — прицел ловит его и мигает ядром. */
  shot(ctx, weapon, kind) {
    ctx.api.emit?.({
      type: 'weapon.fire',
      weapon: weapon.id,
      mode: weapon.mode,
      kind
    });
  },

  selectByKeys(ctx) {
    const pressed = ctx.api.input?.keysDown;
    if (!pressed) return;

    const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
    for (const [code, index] of Object.entries(map)) {
      if (pressed.has(code) && ctx.state.index !== index) {
        ctx.state.index = index;
        ctx.state.beamPulse = 0;
        ctx.state.beamHold = false;
        return;
      }
    }
  },

  fire(ctx) {
    const state = ctx.state;
    const weapon = WEAPONS[state.index];
    if (!weapon) return;

    if (weapon.mode === 'pulse') {
      state.beamPulse = number(ctx.params.laserDuration, 0.45, 0.05, 5);
      this.shot(ctx, weapon, 'pulse');
      return;
    }

    if (weapon.mode === 'hold') {
      state.beamHold = true;
      this.shot(ctx, weapon, 'beam');
      return;
    }

    if (weapon.mode === 'burst') {
      if (state.burstRemaining > 0 || state.cooldowns.machinegun > 0) return;

      state.burstTotal = number(ctx.params.mgCount, 25, 1, 200);
      state.burstRemaining = state.burstTotal;
      state.burstTimer = 0;
      this.spawnTracer(ctx);
      state.burstRemaining -= 1;
      state.burstTimer = number(ctx.params.mgInterval, 0.2, 0.02, 2);

      if (state.burstRemaining === 0) {
        state.cooldowns.machinegun = number(ctx.params.mgCooldown, 0.8, 0, 10);
      }
      return;
    }

    if (weapon.mode === 'single') {
      if (state.cooldowns.rocket > 0) return;

      this.spawnRocket(ctx);
      state.cooldowns.rocket = number(ctx.params.rocketCooldown, 1.4, 0, 20);
      this.shot(ctx, weapon, 'rocket');
    }
  },

  updateBurst(ctx, dt, blocked) {
    const state = ctx.state;
    if (state.burstRemaining <= 0) return;

    if (blocked) {
      state.burstRemaining = 0;
      return;
    }

    state.burstTimer -= dt;

    while (state.burstRemaining > 0 && state.burstTimer <= 0) {
      this.spawnTracer(ctx);
      state.burstRemaining -= 1;
      state.burstTimer += number(ctx.params.mgInterval, 0.2, 0.02, 2);
    }

    if (state.burstRemaining === 0) {
      state.cooldowns.machinegun = number(ctx.params.mgCooldown, 0.8, 0, 10);
    }
  },

  target(ctx) {
    const aim = ctx.api.aimTarget?.();
    if (Array.isArray(aim) && aim.length >= 3) return aim.slice(0, 3);

    const body = ctx.api.find(ctx.params.body) || ctx.api.player;
    if (!body) return null;

    const forward = quatRotate(worldQuaternion(body), [0, 0, -1]);
    return add(worldPosition(body), scale(forward, number(ctx.params.targetDistance, 500, 20, 5000)));
  },

  muzzle(ctx) {
    const state = ctx.state;
    const ids = [ctx.params.muzzleLeft, ctx.params.muzzleRight].filter(Boolean);
    const id = ids.length ? ids[state.muzzleSide % ids.length] : null;
    const entity = id ? ctx.api.find(id) : null;

    state.muzzleSide += 1;

    if (entity) return worldPosition(entity);

    const body = ctx.api.find(ctx.params.body) || ctx.api.player;
    if (!body) return [0, 0, 0];

    const forward = quatRotate(worldQuaternion(body), [0, 0, -1]);
    return add(worldPosition(body), scale(forward, 5));
  },

  spawnTracer(ctx) {
    const origin = this.muzzle(ctx);
    const target = this.target(ctx);
    if (!target) return;

    const direction = normalize(sub(target, origin));
    const id = `tracer-${++ctx.state.smoke}`;

    this.shot(ctx, WEAPONS[2], 'tracer');

    ctx.state.tracers.set(id, {
      position: origin.slice(),
      previous: origin.slice(),
      direction,
      speed: number(ctx.params.mgSpeed, 650, 50, 5000),
      life: number(ctx.params.mgLife, 1.2, 0.1, 10),
      age: 0,
      smokeTimer: 0,
      targetDistance: Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2])
    });

    // Первый отрезок виден сразу
    ctx.api.effects.tracer(id, {
      from: origin,
      to: origin,
      color: COLORS.tracer,
      width: 7,
      intensity: 2.1,
      ttl: 0.06
    });
  },

  updateTracers(ctx, dt) {
    for (const [id, tracer] of ctx.state.tracers) {
      tracer.previous = tracer.position.slice();
      tracer.position = add(tracer.position, scale(tracer.direction, tracer.speed * dt));
      tracer.age += dt;
      tracer.smokeTimer += dt;

      const traveled = Math.hypot(
        tracer.position[0] - tracer.previous[0],
        tracer.position[1] - tracer.previous[1],
        tracer.position[2] - tracer.previous[2]
      );
      tracer.targetDistance -= traveled;

      if (tracer.targetDistance <= 0) {
        ctx.api.effects.spark(`spark-${id}`, {
          position: tracer.position,
          color: COLORS.spark,
          size: 1.1,
          intensity: 2.5,
          ttl: 0.18
        });
        ctx.state.tracers.delete(id);
        continue;
      }

      if (tracer.age > tracer.life) {
        ctx.state.tracers.delete(id);
        continue;
      }

      ctx.api.effects.tracer(id, {
        from: tracer.previous,
        to: tracer.position,
        color: COLORS.tracer,
        width: 7,
        intensity: 2.1,
        ttl: 0.06
      });

      if (tracer.smokeTimer >= 0.03) {
        tracer.smokeTimer = 0;
        ctx.api.effects.smoke(`smoke-t-${id}-${Math.floor(tracer.age * 100)}`, {
          position: tracer.position,
          size: 0.8,
          color: [0.72, 0.78, 0.86],
          opacity: 0.22,
          ttl: 0.55
        });
      }
    }
  },

  spawnRocket(ctx) {
    const origin = this.muzzle(ctx);
    const target = this.target(ctx);
    if (!target) return;

    const direction = normalize(sub(target, origin));

    // Единственный путь: ракета — сущность из префаба, попадание считает свип.
    // Движок своих ракет не рисует; без системы снарядов выстрела не будет.
    ctx.api.projectiles?.fire?.({
      prefab: ctx.params.rocketPrefab || 'rocket',
      from: origin,
      direction,
      speed: number(ctx.params.rocketSpeed, 95, 10, 1000),
      life: number(ctx.params.rocketLife, 6, 0.5, 30),
      owner: ctx.api.find(ctx.params.body) || ctx.api.player || null
    });
  },

  drawBeam(ctx) {
    const state = ctx.state;
    const weapon = WEAPONS[state.index];
    if (!weapon) return;

    const active = (weapon.mode === 'pulse' && state.beamPulse > 0)
      || (weapon.mode === 'hold' && state.beamHold);

    if (!active) return;

    const origin = this.muzzle(ctx);
    const target = this.target(ctx);
    if (!target || !origin) return;

    ctx.api.effects.beam(`beam-${weapon.id}`, {
      from: origin,
      to: target,
      color: weapon.mode === 'pulse' ? COLORS.laser : COLORS.pointer,
      width: weapon.mode === 'pulse' ? 10 : number(ctx.params.pointerWidth, 8, 1, 40),
      intensity: 2.4,
      ttl: 0.06
    });
  },

  updateHud(ctx) {
    const state = ctx.state;
    const weapon = WEAPONS[state.index];
    if (!weapon) return;

    const cooldown = state.cooldowns[weapon.id] || 0;

    for (let index = 0; index < WEAPONS.length; index++) {
      ctx.api.hud?.setClass?.(`weapon-slot-${index}`, 'active', index === state.index);
    }

    let status = 'ГОТОВ';
    if (state.burstRemaining > 0) {
      status = `ОЧЕРЕДЬ ${state.burstTotal - state.burstRemaining}/${state.burstTotal}`;
    } else if (cooldown > 0) {
      status = `ПЕРЕЗАРЯДКА ${cooldown.toFixed(1)} С`;
    } else if (weapon.mode === 'hold' && state.beamHold) {
      status = 'ЛУЧ АКТИВЕН';
    }

    ctx.api.hud?.setText?.('weapon-status', status);
  },

  dispose(ctx) {
    ctx.api.shared?.delete?.('weapons.status');
    ctx.api.effects?.clear?.();
  }
};
