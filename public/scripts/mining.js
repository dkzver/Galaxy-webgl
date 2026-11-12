// Добыча ресурсов: вся логика в скрипте.
//
// Луч выходит из пустого объекта mining-origin на корабле, направление берётся
// из позиции мыши (input.cursorRay), прогресс и ресурсы живут в state.
// Движок только рисует эффекты и обновляет HUD по командам скрипта.

export const params = {
  origin: { label: 'Точка луча', default: '', type: 'entity' },
  body: { label: 'Корабль', default: 'ship', type: 'entity' },
  range: { label: 'Дальность луча', default: 60, min: 5, max: 500, step: 5 },
  cycleTime: { label: 'Секунд на единицу', default: 2.6, min: 0.2, max: 30, step: 0.1 },
  decay: { label: 'Остывание прогресса', default: 0.7, min: 0, max: 10, step: 0.1 },
  sparkInterval: { label: 'Искры, с', default: 0.05, min: 0.01, max: 1, step: 0.01 }
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

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function zoneRadius(target) {
  const mining = target.mining || {};
  if (mining.zoneRadius > 0) return mining.zoneRadius;

  const collider = target.raw?.body?.collider;
  const base = collider?.shape === 'sphere'
    ? collider.radius * (target.scaleUniform || 1)
    : (target.model?.radius || 1) * (target.scaleUniform || 1);

  return base * (mining.zoneScale || 2);
}

function raySphere(origin, direction, center, radius) {
  const ox = origin[0] - center[0];
  const oy = origin[1] - center[1];
  const oz = origin[2] - center[2];
  const b = ox * direction[0] + oy * direction[1] + oz * direction[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(discriminant);
  const near = -b - root;
  const far = -b + root;
  if (near > 1e-6) return near;
  return far > 1e-6 ? far : null;
}

function nearestHit(origin, direction, targets) {
  let best = null;

  for (const target of targets) {
    const position = worldPosition(target);
    const radius = target.radius || target.model?.radius || 1;
    const t = typeof target.hitTest === 'function'
      ? target.hitTest(origin, direction)
      : raySphere(origin, direction, position, radius);

    if (t == null) continue;
    if (best && t >= best.distance) continue;

    best = {
      target,
      distance: t,
      point: [
        origin[0] + direction[0] * t,
        origin[1] + direction[1] * t,
        origin[2] + direction[2] * t
      ]
    };
  }

  return best;
}

export default {
  init(ctx) {
    ctx.api.claim('mining');

    ctx.state.progress = 0;
    ctx.state.resources = 0;
    ctx.state.cycles = 0;
    ctx.state.active = false;
    ctx.state.inside = false;
    ctx.state.sparkTimer = 0;
    ctx.state.spark = 0;

    ctx.api.hud?.setText?.('mining-caption', 'ДОБЫЧА');
    ctx.api.hud?.setText?.('mining-count', '0 ед.');
    ctx.api.hud?.setStyle?.('mining-fill', 'width', '0%');
  },

  update(ctx, dt) {
    const state = ctx.state;
    const step = Math.min(0.1, Math.max(0, dt));
    const targets = ctx.api.miningTargets?.() || [];
    const body = ctx.api.find(ctx.params.body) || ctx.api.player;
    const player = body ? worldPosition(body) : [0, 0, 0];

    const inside = targets.some((target) => distance(player, worldPosition(target)) <= zoneRadius(target));
    state.inside = inside;

    const blocked = Boolean(ctx.api.hud?.isVisible?.('hud-menu'));
    const requested = Boolean(ctx.api.input?.keys?.f) && !blocked;
    const ray = ctx.api.input?.cursorRay?.() || null;

    const originEntity = ctx.api.find(ctx.params.origin);
    const origin = originEntity ? worldPosition(originEntity) : player;

    let beamEnd = null;
    let hit = null;

    if (ray) {
      hit = inside ? nearestHit(ray.origin, ray.direction, targets) : null;
      beamEnd = hit
        ? hit.point
        : [
          ray.origin[0] + ray.direction[0] * number(ctx.params.range, 60, 5, 500),
          ray.origin[1] + ray.direction[1] * number(ctx.params.range, 60, 5, 500),
          ray.origin[2] + ray.direction[2] * number(ctx.params.range, 60, 5, 500)
        ];
    }

    const active = Boolean(inside && requested && ray);
    state.active = active;

    if (active) {
      ctx.api.effects.beam('mining-beam', {
        from: origin,
        to: beamEnd,
        color: [1.0, 0.45, 0.15],
        width: 7,
        intensity: 2.4,
        ttl: 0.06
      });

      ctx.state.sparkTimer += step;
      const sparkInterval = number(ctx.params.sparkInterval, 0.05, 0.01, 1);

      if (hit && ctx.state.sparkTimer >= sparkInterval) {
        ctx.state.sparkTimer = 0;
        ctx.api.effects.spark(`mining-spark-${++ctx.state.spark}`, {
          position: hit.point,
          color: [1.0, 0.75, 0.35],
          size: 0.8,
          intensity: 2.0,
          ttl: 0.16
        });
      }

      state.progress += step / number(ctx.params.cycleTime, 2.6, 0.2, 30);

      while (state.progress >= 1) {
        state.progress -= 1;
        state.resources += 1;
        state.cycles += 1;
      }
    } else {
      state.progress = Math.max(0, state.progress - step * number(ctx.params.decay, 0.7, 0, 10));
    }

    this.updateHud(ctx);
  },

  updateHud(ctx) {
    const state = ctx.state;
    const show = state.inside || state.progress > 0.001 || state.resources > 0;

    ctx.api.hud?.setClass?.('resource-prompt', 'visible', state.inside);
    ctx.api.hud?.setClass?.('mining-hud', 'visible', show);
    ctx.api.hud?.setClass?.('mining-hud', 'mining', state.active);

    if (!show) return;

    const caption = state.inside
      ? (state.active ? 'ДОБЫЧА' : 'F — ДОБЫЧА')
      : 'РЕСУРСЫ';

    ctx.api.hud?.setText?.('mining-caption', caption);
    ctx.api.hud?.setText?.('mining-count', `${state.resources} ед.`);
    ctx.api.hud?.setStyle?.('mining-fill', 'width', `${(state.progress * 100).toFixed(1)}%`);
  }
};
