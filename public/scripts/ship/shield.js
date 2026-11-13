// Щит корабля: две модели поведения.
//
// 1. На сущности задан materialId (например, «shield») — оболочку рисует
//    материал, меш скрывать нельзя. Скрипт только копит попадания: рендер
//    читает entity.shieldHits и зажигает пятно и кольцо.
// 2. Материала нет — старое поведение: меш скрыт, коллайдер продолжает работать.
//
// raw.visible не трогаем: при visible: false движок не построит ни меш, ни тело.

function setVisuals(entity, visible) {
  if (!entity) return;
  if (entity.model) entity.visible = visible;

  for (const child of entity.children || []) setVisuals(child, visible);
}

export default {
  init(ctx) {
    const materialId = ctx.entity.raw?.materialId;
    ctx.state.hits = [];

    if (materialId) {
      ctx.state.hidden = false;
      ctx.entity.shieldHits = ctx.state.hits;

      ctx.state.unsubscribe = ctx.api.on?.('projectile.hit', (event) => {
        if (!event?.entity || event.entity.id !== ctx.entity.id) return;

        ctx.state.hits.unshift({ position: event.point.slice(), age: 0 });
        if (ctx.state.hits.length > 4) ctx.state.hits.length = 4;
      });

      return;
    }

    ctx.state.hidden = true;
    setVisuals(ctx.entity, false);
  },

  update(ctx, dt) {
    const hits = ctx.state.hits;
    if (!hits?.length) return;

    const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
    for (const hit of hits) hit.age += step;

    while (hits.length && hits[hits.length - 1].age > 2) hits.pop();
  },

  dispose(ctx) {
    ctx.state.unsubscribe?.();
  }
};
