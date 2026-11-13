// Виджет «Перекрестие»: прицел точки.
//
// Контроллер target.js на weapon-target строит линию от игрока к точке прицела
// и публикует target.state / target.point. Здесь — только отрисовка: показать
// перекрестие, если ссылка указывает на этот объект, и включить цвет наведения.

export default {
  init(ctx) {
    ctx.api.claim('reticle');
  },

  update(ctx) {
    const target = ctx.api.target;
    if (!target?.show) return;

    // Ссылка с weapon-target: без неё или при чужой ссылке прицел не рисуется
    const bound = ctx.api.shared?.get?.('target.reticle') || '';
    if (!bound || bound !== ctx.entity.id) {
      target.hide?.();
      return;
    }

    const state = ctx.api.shared?.get?.('target.state') || {};
    const point = ctx.api.shared?.get?.('target.point') || null;

    if (!state.visible || !Array.isArray(point)) {
      target.hide?.();
      return;
    }

    target.show({
      point,
      config: this.config(ctx),
      state: { aimed: Boolean(state.aimed) }
    });
  },

  /** Блок `reticle` сущности + дизайн из её скрипта reticles/*.js. */
  config(ctx) {
    const raw = ctx.entity?.raw || {};
    return {
      ...(raw.reticle && typeof raw.reticle === 'object' ? raw.reticle : {}),
      design: ctx.entity?.reticleDesign || null
    };
  },

  dispose(ctx) {
    ctx.api.target?.hide?.();
  }
};
