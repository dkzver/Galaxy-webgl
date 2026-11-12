// Поворот игрока: курсор работает как джойстик.
// Смещение курсора от центра экрана задаёт направление и силу разворота:
// чем дальше от центра, тем быстрее поворот; в центре — корпус не крутится.
// Курс считает этот скрипт, а камера просто едет за корпусом — поэтому
// картинка не «хлёсткая»: мышь не крутит камеру.
//
// Крен Q/E — отдельная ось вокруг носа; угол хранится в состоянии и не
// снимается поворотом, пока игрок не выровняет корпус обратно.

import { quatFromAxisAngle, quatMul, quatNormalize } from '../js/math.js';

const DEFAULT_TURN_RATE = 2.6; // рад/с — предел, если сцена не задала controls.maxTurn
const TURN_ACCEL = 2.8;        // 1/с — как быстро разворот выходит на заданную скорость
const TURN_ACCEL_LIMIT = 4.0;  // рад/с² — предел углового ускорения: старт без рывка
const PITCH_FACTOR = 0.7;      // вертикаль медленнее горизонтали
const DEAD_ZONE = 0.06;        // курсор в центре — мёртвая зона
const BANK_GAIN = 0.18;        // крен в вираже от угловой скорости
const BANK_MAX = 0.35;         // рад — предел визуального крена
const BANK_SMOOTH = 3.0;       // 1/с — сглаживание крена

const ROLL_RATE = 1.8;   // рад/с — предел угловой скорости крена
const ROLL_ACCEL = 3.2;  // рад/с² — разгон крена, как ACCEL у тяги
const ROLL_DRAG = 1.8;   // 1/с — сопротивление: без ввода крен плавно гаснет

const FORWARD = [0, 0, -1];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wrapAngle(angle) {
  const twoPi = Math.PI * 2;
  return angle - twoPi * Math.floor((angle + Math.PI) / twoPi);
}

// Смещение курсора → сила разворота: 0 в центре, 1 у края экрана
function stickStrength(distance) {
  if (distance <= DEAD_ZONE) return 0;
  return (distance - DEAD_ZONE) / (1 - DEAD_ZONE);
}

export default {
  init(ctx) {
    ctx.api.claim('rotation');
    ctx.state.yawRate = 0;
    ctx.state.pitchRate = 0;
    ctx.state.roll = 0;
    ctx.state.rollRate = 0;
  },

  update(ctx, dt) {
    const entity = ctx.entity;
    const controls = entity.controls || (entity.controls = {});

    // Крен: не включается рывком, а разгоняется и гаснет так же плавно, как тяга
    // (ускорение + сопротивление). Применяем сразу к кватерниону, иначе поворот
    // корпуса «съедал» бы наклон.
    const rollInput = controls.blocked ? 0 : (Number(controls.roll) || 0);
    ctx.state.rollRate += rollInput * ROLL_ACCEL * dt;
    ctx.state.rollRate *= Math.exp(-ROLL_DRAG * dt);

    const rollRate = clamp(ctx.state.rollRate, -ROLL_RATE, ROLL_RATE);
    ctx.state.rollRate = rollRate;
    controls.rollRate = rollRate;

    if (Math.abs(rollRate) > 1e-4) {
      const rollStep = rollRate * dt;
      ctx.state.roll = wrapAngle(ctx.state.roll + rollStep);
      ctx.api.setQuaternion(entity, quatNormalize(quatMul(
        entity.quaternion,
        quatFromAxisAngle(FORWARD, rollStep)
      )));
    }

    // Курс из мыши: направление — куда ушёл курсор, сила — насколько далеко
    const freeLook = Boolean(controls.blocked || controls.lookAround);
    const x = freeLook ? 0 : clamp(Number(controls.aimX) || 0, -1, 1);
    const y = freeLook ? 0 : clamp(Number(controls.aimY) || 0, -1, 1);

    const distance = Math.min(1, Math.hypot(x, y));
    const strength = stickStrength(distance);
    const nx = distance > 1e-6 ? x / distance : 0;
    const ny = distance > 1e-6 ? y / distance : 0;

    const maxTurn = Number(controls.maxTurn) || DEFAULT_TURN_RATE;
    const turnAccel = Number(controls.turnAccel) || TURN_ACCEL;

    // Курсор справа — поворот вправо (отрицательный вокруг +Y), курсор сверху — нос вверх
    const yawTarget = -nx * maxTurn * strength;
    const pitchTarget = -ny * maxTurn * PITCH_FACTOR * strength;

    const k = Math.min(1, dt * turnAccel);
    const maxDelta = TURN_ACCEL_LIMIT * dt;
    ctx.state.yawRate += clamp((yawTarget - ctx.state.yawRate) * k, -maxDelta, maxDelta);
    ctx.state.pitchRate += clamp((pitchTarget - ctx.state.pitchRate) * k, -maxDelta, maxDelta);

    const yawStep = ctx.state.yawRate * dt;
    const pitchStep = ctx.state.pitchRate * dt;

    if (Math.abs(yawStep) + Math.abs(pitchStep) > 1e-9) {
      let next = quatMul(entity.quaternion, quatFromAxisAngle([0, 1, 0], yawStep));
      next = quatMul(next, quatFromAxisAngle([1, 0, 0], pitchStep));
      ctx.api.setQuaternion(entity, quatNormalize(next));
    }

    // Крен в вираж: сглаживаем цель, чтобы при смене направления не перекидывался
    const bankTarget = clamp(ctx.state.yawRate * BANK_GAIN, -BANK_MAX, BANK_MAX);
    controls.bank = (controls.bank || 0)
      + (bankTarget - (controls.bank || 0)) * Math.min(1, dt * BANK_SMOOTH);

    controls.turnRate = ctx.state.yawRate;
    controls.turnSpeed = Math.hypot(ctx.state.yawRate, ctx.state.pitchRate);
  }
};
