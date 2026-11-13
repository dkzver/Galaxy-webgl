// Панель оружия: только отрисовка состояния.
//
// Ничего не читает и не публикует: ввод (клавиши 1–3, клики по слотам HUD, ЛКМ)
// и выбор оружия живут в weapons/controller.js. Панель берёт `weapons.slots` и
// `weapons.status` из общего состояния и обновляет HUD: активный слот и строку
// статуса. Скрипты оружия отдают свои статусы (`laser.status` и т. д.).

export const params = {};

/** Строка статуса по данным выбранного оружия. */
function statusText(status) {
  if (!status) return 'ГОТОВ';

  if (status.mode === 'burst') {
    const left = Number(status.burstRemaining) || 0;
    const total = Number(status.burstTotal) || 0;
    if (left > 0 && total > 0) return `ОЧЕРЕДЬ ${total - left}/${total}`;
    if (Number(status.cooldown) > 0) return `ПЕРЕЗАРЯДКА ${Number(status.cooldown).toFixed(1)} С`;
    return 'ГОТОВ';
  }

  if (status.mode === 'single') {
    if (Number(status.cooldown) > 0) return `ПЕРЕЗАРЯДКА ${Number(status.cooldown).toFixed(1)} С`;
    return 'ГОТОВ';
  }

  return status.active ? 'ЛУЧ АКТИВЕН' : 'ГОТОВ';
}

export default {
  init(ctx) {
    ctx.api.claim('weapons-ui');
    this.render(ctx);
  },

  update(ctx) {
    this.render(ctx);
  },

  render(ctx) {
    const shared = ctx.api.shared;
    const status = shared?.get?.('weapons.status') || null;
    const slots = shared?.get?.('weapons.slots') || [];

    for (let index = 0; index < slots.length; index++) {
      ctx.api.hud?.setClass?.(`weapon-slot-${index}`, 'active', index === status?.index);
    }

    ctx.api.hud?.setText?.('weapon-status', statusText(status));
  },

  dispose() {}
};
