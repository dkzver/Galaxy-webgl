// Виджет «Круг»: курсор мыши.
//
// Показывается только если сцена ссылается на этот объект полем cursor.
// Если ссылка пустая или чужая — виджет скрывается, работает системный курсор.
// Позицию задаёт движок: экранная точка указателя.

export default {
  init(ctx) {
    ctx.api.claim('cursor');
  },

  update(ctx) {
    const target = ctx.api.target;
    if (!target?.cursor) return;

    const bound = ctx.api.scene?.cursor || '';
    if (!bound || bound !== ctx.entity.id) {
      target.hideCursor?.();
      return;
    }

    target.cursor({
      config: this.config(ctx),
      state: {}
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
    ctx.api.target?.hideCursor?.();
  }
};
