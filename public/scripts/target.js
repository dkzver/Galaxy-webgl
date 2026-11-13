// Контроллер прицела: скрипт на weapon-target.
//
// Ссылки задаются в инспекторе:
//   player  — объект игрока (начало линии);
//   reticle — объект-прицел (что показывать).
//
// Каждый кадр строит бесконечную линию от игрока к точке прицела, проверяет её
// по моделям сцены и публикует состояние для виджета:
//   target.reticle — ссылка на прицел;
//   target.point   — мировая точка прицела (или null);
//   target.state   — { visible, aimed }.

import { pickClosest } from '../js/picking.js';

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-9) return null;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function positionOf(entity) {
  const matrix = entity?.matrix;
  if (matrix) return [matrix[12], matrix[13], matrix[14]];
  return entity?.position || entity?.pos || [0, 0, 0];
}

/** Свой корабль в трассировке не участвует. */
function belongsToPlayer(entity, player) {
  let node = entity;
  while (node) {
    if (node === player) return true;
    node = node.parent;
  }
  return false;
}

export const params = {
  player: { label: 'Игрок', default: '', type: 'entity' },
  reticle: { label: 'Прицел', default: '', type: 'reticle' }
};

export default {
  init(ctx) {
    ctx.api.claim('target');
    this.publish(ctx);
  },

  update(ctx) {
    this.publish(ctx);
  },

  publish(ctx) {
    const shared = ctx.api.shared;
    if (!shared) return;

    shared.set('target.reticle', String(ctx.params.reticle || ''));

    const player = ctx.api.find?.(ctx.params.player) || null;
    const aim = ctx.api.target?.aim?.();
    const visible = Boolean(player && aim?.visible);
    const point = visible ? aim.point : null;

    let aimed = false;
    if (visible) {
      const origin = positionOf(player);
      const direction = normalize([
        point[0] - origin[0],
        point[1] - origin[1],
        point[2] - origin[2]
      ]);

      const models = (ctx.api.entities || []).filter((entity) => entity.type === 'model'
        && entity.visible !== false
        && entity.model?.bounds
        && !belongsToPlayer(entity, player));

      aimed = Boolean(direction && pickClosest({ origin, direction }, models));
    }

    shared.set('target.point', point);
    shared.set('target.state', { visible, aimed });
  },

  dispose(ctx) {
    ctx.api.shared?.delete?.('target.reticle');
    ctx.api.shared?.delete?.('target.point');
    ctx.api.shared?.delete?.('target.state');
  }
};
