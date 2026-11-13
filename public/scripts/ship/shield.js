// Щит корабля: две модели поведения.
//
// 1. На сущности задан materialId (например, «shield») — оболочку рисует
//    материал, меш скрывать нельзя. Скрипт только копит попадания: рендер
//    читает entity.shieldHits и зажигает локальное гексагональное пятно.
// 2. Материала нет — старое поведение: меш скрыт, коллайдер продолжает работать.
//
// raw.visible не трогаем: при visible: false движок не построит ни меш, ни тело.

import { M4 } from '../../js/math.js';

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

        // Точка удара приходит в мире; храним её в локальных координатах щита,
        // иначе при движении корабля пятно «съезжает» с места попадания.
        const point = Array.isArray(event.point) ? event.point.slice(0, 3) : [0, 0, 0];
        const matrix = ctx.entity.matrix;
        const local = matrix ? M4.transformPoint(M4.invert(matrix), point) : point;

        ctx.state.hits.unshift({ position: local, age: 0 });
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
