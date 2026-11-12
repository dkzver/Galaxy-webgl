// Камера игрока: вся логика движения живёт здесь.
//
// Скрипт вешается на объект «камера» (или на игрока) и получает ссылку на
// корабль через параметр body. Каждый кадр он считает позицию и точку взгляда,
// сглаживает их и отдаёт движку через ctx.api.camera.setPose().
//
// Движок в этом режиме не вмешивается: scriptOwns('camera') отключает его
// встроенный облёт и показывает позу из скрипта.

import { quatFromAxisAngle, quatFromMat4, quatRotate } from '../js/math.js';

export const params = {
  body: { label: 'Корабль', default: 'ship', type: 'entity' },
  height: { label: 'высота камеры', default: 20, min: 0, max: 200, step: 1 },
  distance: { label: 'дистанция', default: 120, min: 0, max: 120, step: 1 },
  drop: { label: 'корабль ниже центра', default: 0, min: 0, max: 15, step: 0.1 },
  tilt: { label: 'наклон камеры', default: 0, min: 0, max: 360, step: 1 },
  side: { label: 'смещение вбок', default: 0, min: -20, max: 20, step: 0.1 },
  fov: { label: 'угол обзора', default: 55, min: 5, max: 120, step: 1 },
  lag: { label: 'плавность', default: 6, min: 0, max: 20, step: 0.5 }
};

const DEG = Math.PI / 180;

function number(value, fallback, min, max) {
  const result = Number(value);
  if (!Number.isFinite(result)) return fallback;
  return Math.min(max, Math.max(min, result));
}

function hudNumber(ctx, id, fallback, min, max) {
  const raw = ctx.api.hud?.value?.(id);
  if (raw == null || raw === '') return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function worldPosition(entity) {
  const matrix = entity?.matrix;
  if (matrix) return [matrix[12], matrix[13], matrix[14]];
  return (entity?.position || [0, 0, 0]).slice();
}

function worldQuaternion(entity) {
  const matrix = entity?.matrix;
  if (matrix) return quatFromMat4(matrix);
  return (entity?.quaternion || [0, 0, 0, 1]).slice();
}

function lerpVec(from, to, k) {
  return [
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k,
    from[2] + (to[2] - from[2]) * k
  ];
}

export default {
  init(ctx) {
    ctx.api.claim('camera');
    ctx.state.position = null;
    ctx.state.lookAt = null;

    // Ползунки меню сразу показывают значения из сцены
    ctx.api.hud?.setValue?.('set-cam', ctx.params.height);
    ctx.api.hud?.setValue?.('set-drop', ctx.params.drop);
    ctx.api.hud?.setValue?.('set-dist', ctx.params.distance);
    ctx.api.hud?.setValue?.('set-tilt', ctx.params.tilt);
  },

  update(ctx, dt) {
    let target = ctx.api.find(ctx.params.body);

    // Ссылка потерялась или указывает на сам скрипт: берём игрока,
    // а если скрипт висит на игроке — его модель-ребёнка
    if (!target || target === ctx.entity) {
      target = ctx.api.player && ctx.api.player !== ctx.entity
        ? ctx.api.player
        : (ctx.entity?.children || []).find((child) => child.type === 'model') || null;
    }

    if (!target) {
      ctx.api.camera?.clearPose?.();
      return;
    }

    const height = hudNumber(ctx, 'set-cam', number(ctx.params.height, 20, 0, 200), 0, 200);
    const distance = hudNumber(ctx, 'set-dist', number(ctx.params.distance, 120, 0, 120), 0, 120);
    const drop = hudNumber(ctx, 'set-drop', number(ctx.params.drop, 0, 0, 15), 0, 15);
    const tilt = hudNumber(ctx, 'set-tilt', number(ctx.params.tilt, 0, 0, 360), 0, 360);
    const side = number(ctx.params.side, 0, -20, 20);
    const fov = number(ctx.params.fov, 55, 5, 120);
    const lag = number(ctx.params.lag, 6, 0, 20);

    const position = worldPosition(target);
    const quaternion = worldQuaternion(target);
    const up = quatRotate(quaternion, [0, 1, 0]);
    const right = quatRotate(quaternion, [1, 0, 0]);

    // Смещение камеры в осях корабля + наклон вокруг его правого вектора
    const offset = quatRotate(quaternion, [side, height, distance]);
    const tiltQuat = tilt ? quatFromAxisAngle(right, tilt * DEG) : null;
    const tilted = tiltQuat ? quatRotate(tiltQuat, offset) : offset;

    const desired = [
      position[0] + tilted[0],
      position[1] + tilted[1],
      position[2] + tilted[2]
    ];

    // Смотрим выше корабля на drop — корабль оказывается ниже центра кадра
    const lookAt = [
      position[0] + up[0] * drop,
      position[1] + up[1] * drop,
      position[2] + up[2] * drop
    ];

    // Плавающее движение: экспоненциальное сглаживание позиции и взгляда
    const step = Math.min(0.1, Math.max(0, dt));
    const k = lag > 0 ? 1 - Math.exp(-lag * step) : 1;

    ctx.state.position = ctx.state.position ? lerpVec(ctx.state.position, desired, k) : desired.slice();
    ctx.state.lookAt = ctx.state.lookAt ? lerpVec(ctx.state.lookAt, lookAt, k) : lookAt.slice();

    ctx.api.camera.setPose({
      position: ctx.state.position,
      lookAt: ctx.state.lookAt,
      up,
      fov
    });
  },

  dispose(ctx) {
    ctx.api.camera?.clearPose?.();
  }
};
