// Ракета как самостоятельное оружие: свой скрипт на объекте «Оружие».
//
// Скрипт только выбирает точку пуска, направление и момент — саму ракету
// создаёт движок из префаба (api.projectiles.fire). Своих снарядов скрипт не
// рисует: без системы снарядов выстрела не будет.
//
// Если в сцене есть weapons.js (панель оружия), ракета стреляет только на
// выбранном слоте «РАКЕТА»: панель владеет переключением, скрипт — пуском.

import { quatRotate } from '../js/math.js';

export const params = {
  body: { label: 'Корабль', default: '', type: 'entity' },

  muzzle1: { label: 'Точка пуска 1', default: 'gun-left', type: 'entity' },
  muzzle2: { label: 'Точка пуска 2', default: 'gun-right', type: 'entity' },

  targetDistance: { label: 'Дальность прицела', default: 500, min: 20, max: 5000, step: 10 },
  cooldown: { label: 'Перезарядка, с', default: 1.4, min: 0, max: 20, step: 0.1 },
  prefab: { label: 'Префаб ракеты', default: 'rocket', type: 'text' },
  speed: { label: 'Скорость', default: 95, min: 10, max: 1000, step: 5 },
  life: { label: 'Жизнь, с', default: 6, min: 0.5, max: 30, step: 0.5 }
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
    ctx.api.claim('rocket');

    const state = ctx.state;
    state.cooldown = 0;
    state.firing = false;
    state.side = 0;
    state.shots = 0;

    // Массив точек пуска: порядок сохраняем, пустые отбрасываем.
    state.muzzles = [ctx.params.muzzle1, ctx.params.muzzle2]
      .filter((id) => typeof id === 'string' && id.length > 0);

    // Панель оружия сама решает, когда выбран слот «ракета».
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
    const allowed = !blocked && this.allowed(ctx);
    const mouseDown = Boolean(ctx.api.input?.mouse?.down) && allowed;
    const pressed = mouseDown && !state.firing;
    state.firing = mouseDown;

    if (pressed) this.fire(ctx);

    this.publishStatus(ctx);
    this.updateHud(ctx);
  },

  /** Панель оружия есть — пускаем только на выбранном слоте «ракета». */
  allowed(ctx) {
    if (!ctx.state.panel) return true;
    const status = ctx.api.shared?.get?.('weapons.status');
    return status?.id === 'rocket';
  },

  /** Точка пуска по кругу: 1-я, 2-я, затем снова 1-я. */
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

  fire(ctx) {
    const state = ctx.state;
    if (state.cooldown > 0) return;

    const target = this.target(ctx);
    if (!target) return;

    const origin = this.muzzle(ctx);
    const direction = normalize(sub(target, origin));
    const prefab = ctx.params.prefab || 'rocket';

    // Единственный путь: ракета — сущность из префаба, попадание считает свип.
    const shot = ctx.api.projectiles?.fire?.({
      prefab,
      from: origin,
      direction,
      speed: number(ctx.params.speed, 95, 10, 1000),
      life: number(ctx.params.life, 6, 0.5, 30),
      owner: ctx.api.find?.(ctx.params.body) || ctx.api.player || null
    });

    state.shots += 1;
    state.cooldown = number(ctx.params.cooldown, 1.4, 0, 20);

    ctx.api.emit?.({
      type: 'weapon.fire',
      weapon: 'rocket',
      mode: 'single',
      kind: 'rocket',
      prefab,
      fired: Boolean(shot)
    });

    void prefab;
  },

  publishStatus(ctx) {
    const state = ctx.state;
    ctx.api.shared?.set?.('rocket.status', {
      mode: 'single',
      cooldown: state.cooldown,
      cooldownTotal: number(ctx.params.cooldown, 1.4, 0, 20),
      shots: state.shots,
      firing: state.cooldown > 0
    });
  },

  updateHud(ctx) {
    const state = ctx.state;
    if (state.panel) return; // строку статуса пишет панель оружия

    const status = state.cooldown > 0
      ? `ПЕРЕЗАРЯДКА ${state.cooldown.toFixed(1)} С`
      : 'ГОТОВ';

    ctx.api.hud?.setText?.('weapon-status', status);
  },

  dispose(ctx) {
    ctx.api.shared?.delete?.('rocket.status');
  }
};
