// Лазерная указка: свой скрипт на объекте «Оружие».
//
// Пока ЛКМ удерживается, из точки вылета к точке прицела горит луч. Точки
// вылета — массив: muzzle1…muzzle4 из инспектора, каждое новое нажатие берёт
// следующую. Массив пуст — луч идёт из носа корабля.
//
// Точка вылета пересчитывается каждый кадр: ствол — ребёнок корабля, и луч
// не должен оставаться в мире там, где его включили (см. weapons/muzzles.js).
//
// Про активный луч скрипт пишет в общий статус `laser.status`, его читает
// weapons.js (панель оружия) и показывает «ЛУЧ АКТИВЕН».

import {
  collectMuzzles,
  pickMuzzle as nextMuzzle,
  muzzlePosition,
  targetPoint
} from './muzzles.js';

export const params = {
  body: { label: 'Корабль', default: '', type: 'entity' },

  muzzle1: { label: 'Точка вылета 1', default: '', type: 'entity' },
  muzzle2: { label: 'Точка вылета 2', default: '', type: 'entity' },
  muzzle3: { label: 'Точка вылета 3', default: '', type: 'entity' },
  muzzle4: { label: 'Точка вылета 4', default: '', type: 'entity' },

  targetDistance: { label: 'Дальность прицела', default: 500, min: 20, max: 5000, step: 10 },
  width: { label: 'Толщина луча', default: 8, min: 1, max: 40, step: 1 },
  intensity: { label: 'Яркость', default: 2.4, min: 0.2, max: 6, step: 0.1 }
};

const COLOR = [1.0, 0.55, 0.2];

function number(value, fallback, min, max) {
  const result = Number(value);
  if (!Number.isFinite(result)) return fallback;
  return Math.min(max, Math.max(min, result));
}

export default {
  init(ctx) {
    ctx.api.claim('laser');

    const state = ctx.state;
    state.holding = false;
    state.origin = [0, 0, 0];
    state.muzzleId = null;
    state.side = 0;

    state.muzzles = collectMuzzles(ctx.params);

    // Панель оружия решает, выбран ли слот «указатель».
    state.panel = (ctx.api.entities || []).some((entity) => (entity.scripts || [])
      .some((script) => String(script.file || '').endsWith('weapons.js')));

    this.publishStatus(ctx);
    if (!state.panel) ctx.api.hud?.setText?.('weapon-status', 'ГОТОВ');

    // Отладка только в браузере: в node --test window нет.
    if (typeof window !== 'undefined') {
      window.__laserDebug = state;
      window.__laserInit = (window.__laserInit || 0) + 1;
      window.__laserTicks = 0;
    }
  },

  update(ctx) {
    if (typeof window !== 'undefined') window.__laserTicks = (window.__laserTicks || 0) + 1;

    const state = ctx.state;

    // Ввод сюда не приходит: панель оружия присылает weapon.trigger.
    if (state.holding) {
      // Ствол читаем заново каждый кадр: иначе луч застыл бы в мире.
      state.origin = muzzlePosition(ctx, state.muzzleId);

      const target = this.target(ctx);
      if (target) {
        ctx.api.effects?.beam?.('beam-pointer', {
          from: state.origin,
          to: target,
          color: COLOR,
          width: number(ctx.params.width, 8, 1, 40),
          intensity: number(ctx.params.intensity, 2.4, 0.2, 6),
          ttl: 0.06
        });
      }
    }

    this.publishStatus(ctx);
    this.updateHud(ctx);
  },

  /** Команда от панели оружия: нажали или отпустили ЛКМ. */
  onEvent(ctx, event) {
    if (event.type !== 'weapon.trigger') return;
    if (event.weapon !== 'pointer') return;

    if (event.down) this.press(ctx);
    else this.release(ctx);
  },

  press(ctx) {
    const state = ctx.state;
    if (state.holding) return;

    state.holding = true;
    state.muzzleId = nextMuzzle(state);
    state.origin = muzzlePosition(ctx, state.muzzleId);

    this.publishStatus(ctx);
    ctx.api.emit?.({ type: 'weapon.fire', weapon: 'pointer', mode: 'hold', kind: 'beam' });
  },

  release(ctx) {
    ctx.state.holding = false;
    this.publishStatus(ctx);
  },

  /** Мировая позиция выбранного ствола на текущий кадр. */
  muzzle(ctx, id = ctx.state.muzzleId) {
    return muzzlePosition(ctx, id);
  },

  target(ctx) {
    return targetPoint(ctx, number(ctx.params.targetDistance, 500, 20, 5000));
  },

  /** Статус активного луча — его читает weapons.js. */
  publishStatus(ctx) {
    const state = ctx.state;
    ctx.api.shared?.set?.('laser.status', {
      id: 'pointer',
      mode: 'hold',
      active: state.holding,
      firing: state.holding,
      busy: state.holding,
      origin: state.origin,
      width: number(ctx.params.width, 8, 1, 40)
    });
  },

  updateHud(ctx) {
    const state = ctx.state;
    if (state.panel) return; // строку статуса пишет панель оружия

    ctx.api.hud?.setText?.('weapon-status', state.holding ? 'ЛУЧ АКТИВЕН' : 'ГОТОВ');
  },

  dispose(ctx) {
    ctx.api.shared?.delete?.('laser.status');
  }
};
