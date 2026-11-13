// Контроллер оружия: выбор слота и команды стрельбы.
//
// Единственное место, где читается ввод:
//   * клавиши 1–3 (и Numpad1–3) — выбор оружия;
//   * клики по слотам HUD (`weapon-slot-N`) — выбор оружия;
//   * ЛКМ — press/release выбранному оружию.
//
// Контроллер смотрит на статусы оружия (`laser.status`, `machinegun.status`,
// `rocket.status`) и не даёт стрелять, пока предыдущее оружие ещё отрабатывает.
// Панель `weapons.js` — только отрисовка: она читает `weapons.slots` и
// `weapons.status`, которые публикует контроллер.

const WEAPONS = [
  { id: 'pointer', key: '1', name: 'УКАЗАТЕЛЬ', mode: 'hold', statusKey: 'laser.status' },
  { id: 'machinegun', key: '2', name: 'ПУЛЕМЁТ', mode: 'burst', statusKey: 'machinegun.status' },
  { id: 'rocket', key: '3', name: 'РАКЕТА', mode: 'single', statusKey: 'rocket.status' }
];

// Клавиша → индекс слота. Цифры сверху и на цифровой клавиатуре.
const KEY_SLOTS = {
  Digit1: 0, Numpad1: 0,
  Digit2: 1, Numpad2: 1,
  Digit3: 2, Numpad3: 2
};

export const params = {};

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

/** Оружие ещё отрабатывает: очередь, удержание луча. */
function isBusy(status) {
  return Boolean(status?.busy);
}

export default {
  init(ctx) {
    ctx.api.claim('weapons');

    ctx.state.index = 0;
    ctx.state.commanded = null;

    // Карта слотов для панели: что рисовать и какие статусы читать.
    ctx.api.shared?.set?.('weapons.slots', WEAPONS.map((weapon) => ({
      id: weapon.id,
      key: weapon.key,
      name: weapon.name,
      mode: weapon.mode,
      statusKey: weapon.statusKey
    })));

    // Клик по кнопке HUD выбирает слот.
    for (let index = 0; index < WEAPONS.length; index++) {
      ctx.api.hud?.onClick?.(`weapon-slot-${index}`, () => {
        ctx.state.index = index;
      });
    }

    this.publishStatus(ctx);
  },

  update(ctx) {
    this.selectByKeys(ctx);
    this.syncTrigger(ctx);
    this.publishStatus(ctx);
  },

  selectByKeys(ctx) {
    const pressed = ctx.api.input?.keysDown;
    if (!pressed) return;

    for (const [code, index] of Object.entries(KEY_SLOTS)) {
      if (pressed.has(code) && ctx.state.index !== index) {
        ctx.state.index = index;
        return;
      }
    }
  },

  /** Статус выбранного оружия — его читает панель и рисовальщики HUD. */
  publishStatus(ctx) {
    const weapon = WEAPONS[ctx.state.index];
    if (!weapon) return;

    const own = weapon.statusKey ? ctx.api.shared?.get?.(weapon.statusKey) : null;
    const active = Boolean(own?.active ?? own?.firing);
    const firing = Boolean(own?.firing ?? own?.active);

    ctx.api.shared?.set?.('weapons.status', {
      index: ctx.state.index,
      id: weapon.id,
      key: weapon.key,
      name: weapon.name,
      mode: weapon.mode,
      statusKey: weapon.statusKey,
      active,
      beamHold: weapon.mode === 'hold' && active,
      beamPulse: false,
      firing,
      cooldown: number(own?.cooldown),
      cooldownTotal: number(own?.cooldownTotal),
      burstRemaining: number(own?.burstRemaining),
      burstTotal: number(own?.burstTotal)
    });
  },

  /**
   * ЛКМ: press выбранному оружию, release при отпускании, смене слота или
   * открытом меню. Пока другое оружие занято, новая команда не отправляется.
   */
  syncTrigger(ctx) {
    const state = ctx.state;
    const weapon = WEAPONS[state.index];
    if (!weapon) return;

    const blocked = Boolean(ctx.api.hud?.isVisible?.('hud-menu'));
    const down = Boolean(ctx.api.input?.mouse?.down) && !blocked;

    if (!down) {
      this.release(ctx);
      return;
    }

    // Выбрали другое оружие — старое отпускаем.
    if (state.commanded && state.commanded !== weapon.id) {
      this.release(ctx);
    }

    const own = weapon.statusKey ? ctx.api.shared?.get?.(weapon.statusKey) : null;

    // Пока другое оружие отрабатывает, новому стрелять нельзя.
    const busy = WEAPONS.some((slot) => slot.id !== weapon.id
      && isBusy(ctx.api.shared?.get?.(slot.statusKey)));
    if (busy) return;

    // У выбранного оружия ещё идёт очередь или перезарядка — команду не даём.
    if (!this.canFire(weapon, own)) return;

    if (state.commanded === weapon.id) return;

    state.commanded = weapon.id;
    ctx.api.emit?.({
      type: 'weapon.trigger',
      weapon: weapon.id,
      slot: state.index,
      down: true
    });
  },

  /** Можно ли выбранному оружию начинать стрельбу. */
  canFire(weapon, own) {
    if (!own) return true;

    if (weapon.mode === 'hold') return !own.active;

    if (weapon.mode === 'burst') {
      return !(number(own.burstRemaining) > 0) && !(number(own.cooldown) > 0);
    }

    return !(number(own.cooldown) > 0);
  },

  /** Отпустить оружие, которому контроллер дал команду. */
  release(ctx) {
    const state = ctx.state;
    if (!state.commanded) return;

    ctx.api.emit?.({ type: 'weapon.trigger', weapon: state.commanded, down: false });
    state.commanded = null;
  }
};
