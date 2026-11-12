// Движение игрока: тяга по направлению носа, снос по правому вектору
// (RightVector), торможение и предел скорости. Работает через api.setVelocity,
// поэтому физику и столкновения по-прежнему считает движок.

import { quatRotate } from '../js/math.js';

const ACCEL = 34;
const REVERSE_ACCEL = 20;
const STRAFE_ACCEL = 26;
const DRAG = 0.55;
const MAX_SPEED = 85;

export default {
  init(ctx) {
    ctx.api.claim('movement');
  },

  update(ctx, dt) {
    const entity = ctx.entity;
    const controls = entity.controls || {};
    const thrust = Number(controls.thrust) || 0;
    const strafe = Number(controls.strafe) || 0;
    const velocity = ctx.api.getVelocity(entity);

    // Оси корпуса: нос (−Z) для тяги и правый бок (+X) для сноса.
    // Снос — перемещение, а не поворот: ориентацию меняет только rotation.js.
    const forward = quatRotate(entity.quaternion, [0, 0, -1]);
    const right = quatRotate(entity.quaternion, [1, 0, 0]);
    const accel = thrust >= 0 ? ACCEL : REVERSE_ACCEL;

    for (let i = 0; i < 3; i++) {
      velocity[i] += (forward[i] * thrust * accel + right[i] * strafe * STRAFE_ACCEL) * dt;
      velocity[i] *= Math.exp(-DRAG * dt);
    }

    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    const maxSpeed = Number(controls.maxSpeed) || MAX_SPEED;
    if (speed > maxSpeed) {
      const k = maxSpeed / speed;
      for (let i = 0; i < 3; i++) velocity[i] *= k;
    }

    ctx.api.setVelocity(entity, velocity);

    // Для свечения двигателей и HUD: движок читает это значение
    controls.thrust = thrust;
  }
};
