// Общая логика точек вылета и прицела для всех скриптов оружия.
//
// Главное правило: мировые координаты ствола не запоминаются. Ствол — ребёнок
// корабля, поэтому позиция читается из его матрицы в тот момент, когда нужна:
// каждый кадр для луча и на каждый выстрел для трассера/ракеты. Иначе при
// повороте корабля точка остаётся там, где её сняли, и эффект «отстаёт».

import { quatRotate } from '../../js/math.js';

/** Мировая позиция сущности по её матрице. */
export function worldPosition(entity) {
  const matrix = entity?.matrix;
  if (matrix) return [matrix[12], matrix[13], matrix[14]];
  return (entity?.position || [0, 0, 0]).slice(0, 3);
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a, k) {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function normalize(a) {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

/** muzzle1…muzzle4 → массив непустых id, порядок сохраняется. */
export function collectMuzzles(params = {}) {
  return [params.muzzle1, params.muzzle2, params.muzzle3, params.muzzle4]
    .filter((id) => typeof id === 'string' && id.length > 0);
}

/** Следующий ствол по кругу: 1-й, 2-й, … затем снова 1-й. */
export function pickMuzzle(state) {
  const ids = state.muzzles || [];
  if (!ids.length) return null;

  const id = ids[state.side % ids.length];
  state.side += 1;
  return id;
}

/**
 * Мировая позиция ствола прямо сейчас.
 * Если точки нет — точка в пяти единицах перед носом корабля.
 */
export function muzzlePosition(ctx, id) {
  const entity = id ? ctx.api.find?.(id) : null;
  if (entity) return worldPosition(entity);

  const body = ctx.api.find?.(ctx.params.body) || ctx.api.player;
  if (!body) return [0, 0, 0];

  const forward = quatRotate(body.quaternion || [0, 0, 0, 1], [0, 0, -1]);
  return add(worldPosition(body), scale(forward, 5));
}

/**
 * Точка прицела: движок отдаёт мировую точку, иначе нос + дальность.
 * Возвращает свежий массив на каждый вызов.
 */
export function targetPoint(ctx, distance = 500) {
  const aim = ctx.api.aimTarget?.();
  if (Array.isArray(aim) && aim.length >= 3) return aim.slice(0, 3);

  const body = ctx.api.find?.(ctx.params.body) || ctx.api.player;
  if (!body) return null;

  const forward = quatRotate(body.quaternion || [0, 0, 0, 1], [0, 0, -1]);
  return add(worldPosition(body), scale(forward, distance));
}
