import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Body,
  PhysicsWorld,
  boxShape,
  compoundShape,
  getWorldSpheres,
  sphereShape
} from '../public/js/physics.js';
import { quatFromAxisAngle } from '../public/js/math.js';

const STEP = 1 / 120;

function makeWorld(options = {}) {
  return new PhysicsWorld({
    fixedStep: STEP,
    maxSubSteps: 1,
    iterations: 10,
    positionIterations: 4,
    restitutionThreshold: 1,
    impactThreshold: 1,
    ...options
  });
}

function run(world, seconds, step = world.fixedStep) {
  const count = Math.round(seconds / step);
  for (let i = 0; i < count; i++) world.step(step);
}

test('сфера отскакивает от статической сферы и не проходит сквозь неё', () => {
  const world = makeWorld({ fixedStep: 1 / 240 });
  const ball = world.addBody({
    mass: 1,
    position: [-3, 0, 0],
    velocity: [20, 0, 0],
    restitution: 0.5,
    friction: 0,
    shape: sphereShape(1)
  });
  const wall = world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0.5,
    friction: 0,
    shape: sphereShape(2)
  });

  let minDistance = Infinity;
  for (let i = 0; i < 480; i++) {
    world.step(world.fixedStep);
    minDistance = Math.min(
      minDistance,
      Math.hypot(
        ball.position[0] - wall.position[0],
        ball.position[1] - wall.position[1],
        ball.position[2] - wall.position[2]
      )
    );
  }

  assert.ok(ball.velocity[0] < -9.9, `скорость после удара: ${ball.velocity[0]}`);
  assert.ok(Math.hypot(ball.velocity[0], ball.velocity[1], ball.velocity[2]) <= 20.01);
  assert.ok(ball.position[0] < -3, `кораблю не удалось отойти: ${ball.position[0]}`);
  assert.ok(minDistance > 2.9, `проникновение в статическую сферу: ${minDistance}`);
  assert.deepEqual(wall.position, [0, 0, 0]);
});

test('два одинаковых тела обмениваются скоростями при упругом ударе', () => {
  const world = makeWorld({ fixedStep: 1 / 240 });
  const a = world.addBody({
    mass: 1,
    position: [-2, 0, 0],
    velocity: [6, 0, 0],
    restitution: 1,
    friction: 0,
    shape: sphereShape(0.5)
  });
  const b = world.addBody({
    mass: 1,
    position: [2, 0, 0],
    velocity: [-6, 0, 0],
    restitution: 1,
    friction: 0,
    shape: sphereShape(0.5)
  });

  run(world, 1);

  assert.ok(Math.abs(a.velocity[0] + 6) < 0.05, `A: ${a.velocity[0]}`);
  assert.ok(Math.abs(b.velocity[0] - 6) < 0.05, `B: ${b.velocity[0]}`);
  assert.ok(a.position[0] < -2 && b.position[0] > 2);
});

test('составной корпус корабля не проникает в астероид и отскакивает', () => {
  const world = makeWorld({ fixedStep: 1 / 240 });
  const asteroid = world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0.55,
    friction: 0.2,
    shape: sphereShape(5)
  });
  const ship = world.addBody({
    mass: 12,
    position: [-20, 0, 0],
    velocity: [60, 0, 0],
    lockRotation: true,
    restitution: 0.55,
    friction: 0.2,
    shape: compoundShape([
      { offset: [0, 0, -2], radius: 1.5 },
      { offset: [0, 0, 0], radius: 1.5 },
      { offset: [0, 0, 2], radius: 1.5 }
    ])
  });

  const impacts = [];
  world.on('impact', (event) => impacts.push(event));

  let minClearance = Infinity;
  for (let i = 0; i < 240; i++) {
    world.step(world.fixedStep);
    for (const sphere of getWorldSpheres(ship)) {
      const distance = Math.hypot(sphere.center[0], sphere.center[1], sphere.center[2]);
      minClearance = Math.min(minClearance, distance - sphere.radius - 5);
    }
  }

  assert.ok(impacts.length >= 1, 'событие удара не пришло');
  assert.ok(impacts[0].speed > 50, `скорость сближения: ${impacts[0].speed}`);
  assert.ok(ship.velocity[0] < -30, `корабль не отскочил: ${ship.velocity[0]}`);
  assert.ok(minClearance > -0.3, `проникновение: ${minClearance}`);
  assert.deepEqual(asteroid.position, [0, 0, 0]);
  assert.ok(Number.isFinite(ship.position[0]) && Number.isFinite(ship.velocity[0]));
});

test('событие impact приходит один раз на пару за удар', () => {
  const world = makeWorld();
  world.addBody({
    mass: 1,
    position: [-4, 0, 0],
    velocity: [30, 0, 0],
    restitution: 0.5,
    friction: 0,
    shape: sphereShape(1)
  });
  world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0.5,
    friction: 0,
    shape: sphereShape(2)
  });

  let impacts = 0;
  world.on('impact', () => impacts++);
  run(world, 1);

  assert.equal(impacts, 1);
  assert.equal(world.stats.impacts, 1);
});

test('фиксированный шаг не зависит от частоты вызовов step', () => {
  const build = () => {
    const world = new PhysicsWorld({
      fixedStep: 1 / 120,
      maxSubSteps: 8,
      iterations: 10,
      positionIterations: 4
    });
    world.addBody({
      mass: 1,
      position: [-3, 0, 0],
      velocity: [20, 0, 0],
      restitution: 0.5,
      friction: 0.1,
      shape: sphereShape(1)
    });
    world.addBody({
      type: 'static',
      position: [0, 0, 0],
      restitution: 0.5,
      friction: 0.1,
      shape: sphereShape(2)
    });
    return world;
  };

  const fastCalls = build();
  const slowCalls = build();

  for (let i = 0; i < 60; i++) fastCalls.step(1 / 60);
  for (let i = 0; i < 120; i++) slowCalls.step(1 / 120);

  const a = fastCalls.bodies[0];
  const b = slowCalls.bodies[0];
  assert.ok(Math.abs(a.position[0] - b.position[0]) < 1e-9);
  assert.ok(Math.abs(a.velocity[0] - b.velocity[0]) < 1e-9);
});

test('трение гасит касательную скорость при скользящем ударе', () => {
  const shoot = (friction) => {
    const world = makeWorld({ fixedStep: 1 / 480 });
    const ball = world.addBody({
      mass: 1,
      position: [-6, 2.2, 0],
      velocity: [30, 0, 0],
      restitution: 0.5,
      friction,
      shape: sphereShape(1)
    });
    world.addBody({
      type: 'static',
      position: [0, 0, 0],
      restitution: 0.5,
      friction,
      shape: sphereShape(3)
    });

    run(world, 1.2, 1 / 480);
    return Math.hypot(ball.velocity[0], ball.velocity[1], ball.velocity[2]);
  };

  const frictionless = shoot(0);
  const rough = shoot(0.8);

  assert.ok(rough < frictionless - 0.05, `без трения ${frictionless}, с трением ${rough}`);
});

test('угловая скорость поворачивает тело', () => {
  const world = makeWorld();
  const body = world.addBody({
    mass: 1,
    shape: sphereShape(1),
    angularVelocity: [0, 0, 2]
  });

  world.stepFixed(1 / 120);

  assert.ok(Math.abs(body.quaternion[2]) > 0.001, 'кватернион не изменился');
  assert.ok(Math.abs(body.quaternion[3]) < 1);
});

test('applyImpulse меняет скорость и не крутит тело с lockRotation', () => {
  const free = new Body({ mass: 2, shape: sphereShape(1) });
  free.applyImpulse([4, 0, 0]);
  assert.equal(free.velocity[0], 2);

  free.applyImpulse([0, 1, 0], [1, 0, 0]);
  assert.ok(free.angularVelocity[2] > 0, 'свободное тело должно раскрутиться');

  const locked = new Body({ mass: 2, lockRotation: true, shape: sphereShape(1) });
  locked.applyImpulse([0, 1, 0], [1, 0, 0]);
  assert.deepEqual(locked.angularVelocity, [0, 0, 0]);
});

test('статическое тело не реагирует на импульсы', () => {
  const world = makeWorld();
  const rock = world.addBody({
    type: 'static',
    position: [10, 0, 0],
    shape: sphereShape(3)
  });

  rock.applyImpulse([1000, 0, 0]);
  run(world, 0.2);

  assert.equal(rock.isStatic, true);
  assert.deepEqual(rock.velocity, [0, 0, 0]);
  assert.deepEqual(rock.position, [10, 0, 0]);
});

test('syncBody переносит позицию и скорость в физическое тело', () => {
  const world = makeWorld();
  const body = world.addBody({ mass: 1, shape: sphereShape(1) });

  world.syncBody(body, { position: [10, 0, 0], velocity: [12, 0, 0] });
  world.step(world.fixedStep);

  assert.ok(body.position[0] > 10);
  assert.equal(body.velocity[0], 12);
});

/* ------------------------------- Куб (OBB) ------------------------------- */

test('куб останавливает сферу гранью и сам не двигается', () => {
  const world = makeWorld();
  const box = world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0,
    friction: 0,
    shape: boxShape([2, 2, 2])
  });
  const ball = world.addBody({
    mass: 1,
    position: [-6, 0, 0],
    velocity: [20, 0, 0],
    restitution: 0,
    friction: 0,
    shape: sphereShape(1)
  });

  run(world, 0.8);

  // Грань куба на x = -2, радиус сферы 1 — центр должен остаться около -3
  assert.ok(ball.position[0] <= -2.95, `сфера прошла сквозь грань: x=${ball.position[0]}`);
  assert.ok(ball.position[0] >= -3.25, `сфера отскочила слишком далеко: x=${ball.position[0]}`);
  assert.ok(ball.velocity[0] <= 0.001, `остаточная скорость вперёд: ${ball.velocity[0]}`);
  assert.deepEqual(box.position, [0, 0, 0]);
});

test('повёрнутый куб ловит сферу углом раньше, чем гранью', () => {
  const world = makeWorld();
  world.addBody({
    type: 'static',
    position: [0, 0, 0],
    quaternion: quatFromAxisAngle([0, 1, 0], Math.PI / 4),
    restitution: 0,
    friction: 0,
    shape: boxShape([2, 2, 2])
  });
  const ball = world.addBody({
    mass: 1,
    position: [-8, 0, 0],
    velocity: [20, 0, 0],
    restitution: 0,
    friction: 0,
    shape: sphereShape(1)
  });

  run(world, 0.8);

  // При повороте на 45° выступ по X равен 2√2 ≈ 2.83, центр остановится у −3.83
  assert.ok(ball.position[0] >= -4.0, `сфера прошла сквозь угол: x=${ball.position[0]}`);
  assert.ok(ball.position[0] <= -3.6, `контакт посчитан без учёта поворота: x=${ball.position[0]}`);
});

test('сферу внутри куба выталкивает через ближайшую грань', () => {
  const world = makeWorld();
  world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0,
    friction: 0,
    shape: boxShape([2, 2, 2])
  });
  const ball = world.addBody({
    mass: 1,
    position: [0.5, 0, 0],
    restitution: 0,
    friction: 0,
    shape: sphereShape(0.4)
  });

  run(world, 0.6);

  assert.ok(ball.position[0] >= 2.2, `сфера осталась внутри: x=${ball.position[0]}`);
  assert.ok(Math.abs(ball.position[1]) < 0.2 && Math.abs(ball.position[2]) < 0.2);
});

test('корпус корабля отскакивает от куба и даёт событие impact', () => {
  const world = makeWorld({ fixedStep: 1 / 240 });
  world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0.55,
    friction: 0.2,
    shape: boxShape([3, 3, 3])
  });
  const ship = world.addBody({
    mass: 12,
    position: [0, 0, -14],
    velocity: [0, 0, 18],
    lockRotation: true,
    restitution: 0.55,
    friction: 0.18,
    shape: compoundShape([
      { offset: [0, 0, -4.1], radius: 3.7 },
      { offset: [0, 0, 0], radius: 3.7 },
      { offset: [0, 0, 4.1], radius: 3.7 }
    ])
  });

  const impacts = [];
  world.on('impact', (event) => impacts.push(event));

  // Следим за самой глубокой точкой за весь полёт: после отскока корабль уходит назад
  let maxFront = -Infinity;
  for (let i = 0; i < 120; i++) {
    world.step(world.fixedStep);
    maxFront = Math.max(maxFront, ship.position[2] + 4.1);
  }

  assert.ok(impacts.length >= 1, 'событие impact не пришло');
  assert.ok(ship.velocity[2] <= 0, `корабль не отскочил: vz=${ship.velocity[2]}`);
  // Носовая сфера должна упереться в грань z=−3: центр не дальше −6.7
  assert.ok(maxFront <= -6.4, `корпус вошёл в куб: передний край z=${maxFront.toFixed(2)}`);
  assert.ok(maxFront >= -7.1, `корабли не долетел до куба: передний край z=${maxFront.toFixed(2)}`);
});

test('составной корпус из боксов упирается в составной корпус', () => {
  const world = makeWorld({ gravity: [0, 0, 0] });

  const wall = world.addBody({
    type: 'static',
    position: [0, 0, 0],
    restitution: 0,
    friction: 0,
    shape: compoundShape([
      { type: 'box', offset: [0, 0, -2], halfExtents: [2, 3, 2] },
      { type: 'box', offset: [0, 0, 2], halfExtents: [2, 3, 2] }
    ])
  });

  const ship = world.addBody({
    mass: 12,
    position: [-10, 0, 0],
    velocity: [12, 0, 0],
    lockRotation: true,
    restitution: 0,
    friction: 0,
    shape: compoundShape([
      { type: 'box', offset: [0, 0, -1], halfExtents: [2, 1, 1] },
      { type: 'box', offset: [0, 0, 1], halfExtents: [2, 1, 1] }
    ])
  });

  run(world, 1.5);

  assert.ok(ship.position[0] <= -3.9, `корпус вошёл в стену: x=${ship.position[0].toFixed(2)}`);
  assert.ok(ship.position[0] >= -5.2, `корпус не долетел до стены: x=${ship.position[0].toFixed(2)}`);
  assert.ok(ship.velocity[0] <= 0.1, `остаточная скорость вперёд: ${ship.velocity[0]}`);
  assert.deepEqual(wall.position, [0, 0, 0]);
});

test('compound из бокса и сферы сталкивается обеими частями', () => {
  const world = makeWorld({ gravity: [0, 0, 0] });

  world.addBody({
    type: 'static',
    position: [0, 0, -6],
    restitution: 0,
    friction: 0,
    shape: boxShape([4, 4, 1])
  });

  const body = world.addBody({
    mass: 4,
    position: [0, 0, 4],
    velocity: [0, 0, -10],
    lockRotation: true,
    restitution: 0,
    friction: 0,
    shape: compoundShape([
      { type: 'box', offset: [0, 0, 2], halfExtents: [1, 1, 1] },
      { offset: [0, 0, -1], radius: 2 }
    ])
  });

  run(world, 1.2);

  // Сфера радиусом 2 идёт впереди: центр тела должен встать около z=−2.
  assert.ok(body.position[2] >= -2.5, `сфера прошла сквозь стену: z=${body.position[2].toFixed(2)}`);
  assert.ok(body.position[2] <= -1.6, `тело не долетело до стены: z=${body.position[2].toFixed(2)}`);
  assert.ok(body.velocity[2] >= -0.2, `остаточная скорость: ${body.velocity[2]}`);
});

test('тела родителя и ребёнка не сталкиваются друг с другом', () => {
  const world = makeWorld();
  const parent = world.addBody({ mass: 5, position: [0, 0, 0], shape: sphereShape(2) });
  const child = world.addBody({ type: 'static', position: [0, 0, 0], shape: sphereShape(2) });

  parent.ignores.add(child);
  child.ignores.add(parent);
  world.step(STEP);

  assert.equal(world.contacts.length, 0, 'контакты между родителем и ребёнком не нужны');
  assert.equal(parent.velocity[0], 0);
});

test('compound: далёкие части отсекаются до SAT и не дают контактов', () => {
  const world = makeWorld({ gravity: [0, 0, 0] });

  const ship = world.addBody({
    mass: 2,
    position: [0, 0, 0],
    shape: compoundShape([
      { type: 'box', offset: [-20, 0, 0], halfExtents: [1, 1, 1] },
      { type: 'box', offset: [20, 0, 0], halfExtents: [1, 1, 1] }
    ])
  });

  const rock = world.addBody({
    type: 'static',
    position: [0, 0, 0],
    shape: compoundShape([
      { type: 'box', offset: [0, 0, 0], halfExtents: [1, 1, 1] }
    ])
  });

  world.step(STEP);

  assert.equal(world.contacts.length, 0);
  assert.ok(world.narrowphase.culled >= 2, `отсечено пар: ${world.narrowphase.culled}`);
  assert.ok(ship.shape.boxes.every((part) => part.boundingRadius > 0));
  assert.ok(rock.shape.boxes.every((part) => part.boundingRadius > 0));
});

test('boxShape хранит boundingRadius части', () => {
  const shape = boxShape([2, 3, 6]);
  assert.equal(shape.boxes[0].boundingRadius, Math.hypot(2, 3, 6));
  assert.equal(shape.boundingRadius, Math.hypot(2, 3, 6));
});
