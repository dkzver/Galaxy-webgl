import test from 'node:test';
import assert from 'node:assert/strict';

import input from '../public/scripts/input.js';
import movement from '../public/scripts/movement.js';
import rotation from '../public/scripts/rotation.js';
import { quatFromAxisAngle, quatRotate } from '../public/js/math.js';

function makeInputContext(keys = {}, menuVisible = false, cursor = { x: 0, y: 0 }) {
  const ctx = {
    entity: { controls: {} },
    state: {},
    api: {
      claim: () => {},
      input: { keys, mouse: { down: false }, cursor, keysDown: new Set() },
      hud: { exists: () => true, isVisible: () => menuVisible, toggle: () => {} }
    }
  };

  input.init(ctx);
  return ctx;
}

test('input.js: A/D дают снос, а не поворот', () => {
  const right = makeInputContext({ d: true });
  input.update(right);

  assert.equal(right.entity.controls.strafe, 1);
  assert.equal(right.entity.controls.roll, 0);
  assert.equal('yaw' in right.entity.controls, false, 'поворот с A/D больше не выдаётся');

  const left = makeInputContext({ a: true });
  input.update(left);
  assert.equal(left.entity.controls.strafe, -1);
});

test('input.js: Q/E дают крен влево и вправо', () => {
  const left = makeInputContext({ q: true });
  input.update(left);
  assert.equal(left.entity.controls.roll, -1);

  const right = makeInputContext({ e: true });
  input.update(right);
  assert.equal(right.entity.controls.roll, 1);
});

test('input.js: мышь отдаётся как смещение от центра экрана', () => {
  const ctx = makeInputContext({}, false, { x: -0.6, y: 0.8 });
  input.update(ctx);

  assert.equal(ctx.entity.controls.aimX, -0.6);
  assert.equal(ctx.entity.controls.aimY, 0.8);
  assert.ok(Math.abs(ctx.entity.controls.aimDistance - 1) < 1e-9, 'у края экрана — единица');

  const center = makeInputContext({}, false, { x: 0, y: 0 });
  input.update(center);
  assert.equal(center.entity.controls.aimDistance, 0);
});

test('input.js: в меню снос, крен и курс выключены', () => {
  const ctx = makeInputContext({ d: true, q: true }, true, { x: 1, y: 1 });
  input.update(ctx);

  assert.equal(ctx.entity.controls.strafe, 0);
  assert.equal(ctx.entity.controls.roll, 0);
  assert.equal(ctx.entity.controls.aimX, 0);
  assert.equal(ctx.entity.controls.aimY, 0);
});

function makeMovementContext(controls) {
  const entity = { quaternion: [0, 0, 0, 1], controls };
  let velocity = [0, 0, 0];

  const ctx = {
    entity,
    state: {},
    api: {
      claim: () => {},
      getVelocity: () => velocity.slice(),
      setVelocity: (target, next) => { velocity = next.slice(); }
    }
  };

  movement.init(ctx);
  return { ctx, entity, velocity: () => velocity.slice() };
}

function runMovement(ctx, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) movement.update(ctx, dt);
}

test('movement.js: снос идёт вдоль правого вектора корпуса', () => {
  const { ctx, velocity } = makeMovementContext({ strafe: 1 });
  runMovement(ctx, 1);

  const [x, y, z] = velocity();
  assert.ok(x > 5, `скорость по правому вектору ${x}`);
  assert.ok(Math.abs(y) < 1e-6, `бокового сноса по Y быть не должно: ${y}`);
  assert.ok(Math.abs(z) < 1e-6, `снос не должен менять курс: ${z}`);
});

test('movement.js: после крена правый вектор поворачивается вместе с корпусом', () => {
  const { ctx, entity, velocity } = makeMovementContext({ strafe: 1 });
  entity.quaternion = quatFromAxisAngle([0, 0, -1], Math.PI / 2);
  runMovement(ctx, 1);

  const [x, y, z] = velocity();
  assert.ok(y < -5, `после крена на 90° правый борт смотрит вниз: ${y}`);
  assert.ok(Math.abs(x) < 1e-6, `старая ось X больше не правый борт: ${x}`);
  assert.ok(Math.abs(z) < 1e-6, `${z}`);
});

test('movement.js: тяга по-прежнему идёт по носу', () => {
  const { ctx, velocity } = makeMovementContext({ thrust: 1 });
  runMovement(ctx, 1);

  const [x, y, z] = velocity();
  assert.ok(z < -5, `нос смотрит в −Z: ${z}`);
  assert.ok(Math.abs(x) < 1e-6, `${x}`);
  assert.ok(Math.abs(y) < 1e-6, `${y}`);
});

function makeRotationContext(controls = {}) {
  const entity = { id: 'ship', quaternion: [0, 0, 0, 1], controls: { ...controls } };

  const ctx = {
    entity,
    state: {},
    api: {
      claim: () => {},
      setQuaternion: (target, next) => { target.quaternion = next; }
    }
  };

  rotation.init(ctx);
  return { ctx, entity };
}

function runRotation(ctx, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) rotation.update(ctx, dt);
}

function rollAngle(q) {
  return 2 * Math.atan2(Math.hypot(q[0], q[1], q[2]), Math.abs(q[3]));
}

test('rotation.js: курсор справа поворачивает корпус вправо', () => {
  const { ctx, entity } = makeRotationContext({ aimX: 1 });
  runRotation(ctx, 1);

  const forward = quatRotate(entity.quaternion, [0, 0, -1]);
  assert.ok(forward[0] > 0.3, `нос ушёл вправо: ${forward}`);
  assert.ok(Math.abs(entity.controls.turnRate) > 1, `скорость разворота ${entity.controls.turnRate}`);
});

test('rotation.js: курсор сверху поднимает нос', () => {
  const { ctx, entity } = makeRotationContext({ aimY: -1 });
  runRotation(ctx, 1);

  const forward = quatRotate(entity.quaternion, [0, 0, -1]);
  assert.ok(forward[1] > 0.2, `нос поднялся: ${forward}`);
});

test('rotation.js: курсор в центре — корпус не крутится', () => {
  const { ctx, entity } = makeRotationContext({ aimX: 0, aimY: 0 });
  runRotation(ctx, 1);

  const forward = quatRotate(entity.quaternion, [0, 0, -1]);
  assert.ok(Math.abs(forward[0]) < 1e-6 && Math.abs(forward[1]) < 1e-6, `${forward}`);
});

test('rotation.js: мёртвая зона в центре гасит мелкое дрожание', () => {
  const { ctx, entity } = makeRotationContext({ aimX: 0.03 });
  runRotation(ctx, 1);

  const forward = quatRotate(entity.quaternion, [0, 0, -1]);
  assert.ok(Math.abs(forward[0]) < 1e-6, `в зоне 0.06 не крутит: ${forward}`);
});

test('rotation.js: controls.maxTurn из панели ограничивает разворот', () => {
  const limited = makeRotationContext({ aimX: 1, maxTurn: 1.1, turnAccel: 40 });
  runRotation(limited.ctx, 2);
  assert.ok(Math.abs(limited.entity.controls.turnRate) <= 1.1 + 1e-6, `предел ${limited.entity.controls.turnRate}`);
  assert.ok(Math.abs(limited.entity.controls.turnRate) > 1.0, `до предела доходит: ${limited.entity.controls.turnRate}`);

  const plain = makeRotationContext({ aimX: 1, turnAccel: 40 });
  runRotation(plain.ctx, 2);
  assert.ok(Math.abs(plain.entity.controls.turnRate) <= 2.6 + 1e-6, `без настроек — 2.6: ${plain.entity.controls.turnRate}`);
});

test('rotation.js: Q/E катят корпус вокруг носа', () => {
  const { ctx, entity } = makeRotationContext();
  entity.controls.roll = 1;
  runRotation(ctx, 1);

  assert.ok(rollAngle(entity.quaternion) > 0.5, 'крен набрался');
  assert.ok(entity.controls.rollRate > 1, `скорость крена ${entity.controls.rollRate}`);
});

test('rotation.js: после отпускания крен гаснет плавно и остаётся', () => {
  const { ctx, entity } = makeRotationContext();
  entity.controls.roll = 1;
  runRotation(ctx, 1);

  const before = rollAngle(entity.quaternion);
  entity.controls.roll = 0;
  rotation.update(ctx, 1 / 60);

  assert.ok(rollAngle(entity.quaternion) > before, 'корпус ещё катится по инерции');

  runRotation(ctx, 3);
  assert.ok(Math.abs(entity.controls.rollRate) < 0.05, 'крен остановился');
  assert.ok(rollAngle(entity.quaternion) > 1, 'набранный угол остался');
});

test('rotation.js: при смене направления крен не перекидывается рывком', () => {
  const { ctx, entity } = makeRotationContext({ aimX: 0.6 });

  let prevBank = 0;
  let prevTurn = 0;
  let maxBankStep = 0;
  let maxTurnStep = 0;

  for (let frame = 0; frame < 240; frame++) {
    // На 60-м кадре курсор уходит в другую сторону
    if (frame === 60) entity.controls.aimX = -0.6;
    if (frame === 150) entity.controls.aimX = 0;

    rotation.update(ctx, 1 / 60);

    const bank = entity.controls.bank || 0;
    const turn = entity.controls.turnRate || 0;
    maxBankStep = Math.max(maxBankStep, Math.abs(bank - prevBank));
    maxTurnStep = Math.max(maxTurnStep, Math.abs(turn - prevTurn));
    prevBank = bank;
    prevTurn = turn;
  }

  assert.ok(maxBankStep < 0.05, `крен не скачет больше 3° за кадр: ${(maxBankStep * 180 / Math.PI).toFixed(1)}°`);
  assert.ok(maxTurnStep < 0.1, `скорость разворота меняется плавно: ${maxTurnStep.toFixed(3)} рад/с`);
});
