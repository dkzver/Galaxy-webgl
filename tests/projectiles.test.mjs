import test from 'node:test';
import assert from 'node:assert/strict';

import { PhysicsWorld, boxShape, sphereShape } from '../public/js/physics.js';
import {
  createProjectileSystem,
  distancePointToSegment,
  quatFromDirection,
  segmentBox,
  segmentSphere
} from '../public/js/projectiles.js';
import { quatRotate } from '../public/js/math.js';

function makeInstance(projectile = {}) {
  return {
    root: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], visible: false, raw: { visible: false } },
    entities: [],
    prefab: 'rocket',
    projectile: {
      speed: 100,
      life: 5,
      radius: 0.4,
      impulse: 10,
      impact: 'impact-spark',
      trail: null,
      ...projectile
    },
    active: false
  };
}

function makePool(count = 3) {
  const free = Array.from({ length: count }, () => makeInstance());
  const pool = {
    mounted: 0,
    released: 0,
    acquire() {
      return free.pop() || null;
    },
    release(instance) {
      pool.released += 1;
      free.push(instance);
    },
    mount() {
      pool.mounted += 1;
    },
    stats: () => ({ free: free.length })
  };
  return { pool, free };
}

function makeEffects() {
  return {
    spawned: [],
    spawn(id, options) {
      this.spawned.push({ id, options });
      return id;
    }
  };
}

test('свип сферы: попадание по центру и промах', () => {
  const hit = segmentSphere([0, 0, 0], [0, 0, -100], 0.5, [0, 0, -10], 1);
  assert.ok(hit);
  assert.ok(Math.abs(hit.t - 0.085) < 1e-6, `t=${hit.t}`);
  assert.ok(Math.abs(hit.point[2] + 8.5) < 1e-6);
  assert.deepEqual(hit.normal.map((v) => Math.round(v)), [0, 0, 1]);

  assert.equal(segmentSphere([0, 0, 0], [0, 0, -100], 0.5, [50, 0, -10], 1), null);
  assert.equal(segmentSphere([0, 0, 0], [0, 0, -5], 0.5, [0, 0, -10], 1), null);
});

test('свип бокса: осевой и повёрнутый', () => {
  const axis = segmentBox([0, 0, 0], [0, 0, -20], 0.5, [0, 0, -10], [1, 1, 1], [0, 0, 0, 1]);
  assert.ok(axis);
  assert.ok(Math.abs(axis.t - 0.425) < 1e-6, `t=${axis.t}`);
  assert.deepEqual(axis.normal.map((v) => Math.round(v)), [0, 0, 1]);

  const rotated = segmentBox(
    [0, 0, 0],
    [0, 0, -20],
    0.5,
    [0, 0, -10],
    [1, 1, 1],
    quatFromDirection([0, 0, -1])
  );
  assert.ok(rotated, 'повёрнутый бокс не поймал отрезок');

  const turned = segmentBox(
    [0, 0, 0],
    [0, 0, -20],
    0.5,
    [3, 0, -10],
    [1, 1, 1],
    quatFromDirection([0, 0, -1])
  );
  assert.equal(turned, null, 'бокс в стороне не должен ловить отрезок');
});

test('кватернион из направления разворачивает нос ракеты (−Z)', () => {
  const down = quatFromDirection([0, 0, -1]);
  const back = quatFromDirection([0, 0, 1]);
  const side = quatFromDirection([1, 0, 0]);

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(dot(quatRotate(down, [0, 0, -1]), [0, 0, -1]) > 0.999);
  assert.ok(dot(quatRotate(back, [0, 0, -1]), [0, 0, 1]) > 0.999);
  assert.ok(dot(quatRotate(side, [0, 0, -1]), [1, 0, 0]) > 0.999);
});

test('расстояние до отрезка считает ближайшую точку', () => {
  assert.equal(distancePointToSegment([0, 0, -5], [0, 0, 0], [0, 0, -10]), 0);
  assert.ok(Math.abs(distancePointToSegment([3, 0, -5], [0, 0, 0], [0, 0, -10]) - 3) < 1e-9);
  assert.ok(Math.abs(distancePointToSegment([0, 0, 5], [0, 0, 0], [0, 0, -10]) - 5) < 1e-9);
});

test('снаряд летит, попадает в сферу и отдаёт эффект с импульсом', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  const target = world.addBody({
    mass: 10,
    position: [0, 0, -50],
    shape: sphereShape(2),
    userData: { entity: { id: 'target', visible: true } }
  });

  const { pool } = makePool(3);
  const effects = makeEffects();
  const system = createProjectileSystem({ physics: world, effects, entities: [], pool });

  const instance = system.fire({ from: [0, 0, 0], direction: [0, 0, -1], speed: 100 });
  assert.ok(instance, 'снаряд не занял экземпляр из пула');
  assert.equal(instance.active, true);
  assert.equal(instance.root.visible, true);

  for (let frame = 0; frame < 120 && !instance.dead; frame++) system.update(1 / 60);

  assert.equal(instance.dead, true, 'снаряд не завершился');
  assert.equal(effects.spawned.length, 1);
  assert.equal(effects.spawned[0].id, 'impact-spark');
  assert.ok(effects.spawned[0].options.position[2] < -47);

  assert.ok(Math.abs(target.velocity[2]) > 0.5, 'импульс не приложен к телу');
  assert.equal(system.stats().hits, 1);
  assert.equal(pool.released, 1);
});

test('свип не проскакивает тонкую стенку на большой скорости', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  world.addBody({
    type: 'static',
    position: [0, 0, -20],
    shape: boxShape([5, 5, 0.05]),
    userData: { entity: { id: 'wall', visible: true } }
  });

  const { pool } = makePool(1);
  const system = createProjectileSystem({ physics: world, effects: null, entities: [], pool });

  const instance = system.fire({ from: [0, 0, 0], direction: [0, 0, -1], speed: 1000, radius: 0.2 });
  assert.ok(instance);

  // 1000 м/с при 50 мс — это 50 м за шаг: без свипа стена была бы пройдена.
  system.update(0.05);

  assert.equal(instance.dead, true, 'стенка не поймала снаряд');
  assert.equal(system.stats().hits, 1);
});

test('промах истекает по жизни без искр', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  world.addBody({
    type: 'static',
    position: [100, 0, -50],
    shape: sphereShape(2),
    userData: { entity: { id: 'far', visible: true } }
  });

  const { pool } = makePool(1);
  const effects = makeEffects();
  const system = createProjectileSystem({ physics: world, effects, entities: [], pool });

  const instance = system.fire({ from: [0, 0, 0], direction: [0, 0, -1], speed: 50, life: 0.5 });
  for (let frame = 0; frame < 120 && !instance.dead; frame++) system.update(1 / 60);

  assert.equal(instance.dead, true);
  assert.equal(effects.spawned.length, 0);
  assert.equal(system.stats().expired, 1);
  assert.equal(pool.released, 1);
});

test('снаряд игнорирует тело стрелка и попадает в цель за ним', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });

  // owner — меш-ребёнок без тела, корпус-тело живёт на корне игрока
  const shipRoot = { id: 'ship', visible: true, children: [], parent: null };
  const shipMesh = { id: 'ship-mesh', visible: true, children: [], parent: shipRoot };
  shipRoot.children.push(shipMesh);
  shipRoot.body = world.addBody({
    mass: 12,
    position: [0, 0, 0],
    shape: sphereShape(5),
    userData: { entity: shipRoot }
  });

  const target = world.addBody({
    mass: 10,
    position: [0, 0, -30],
    shape: sphereShape(2),
    userData: { entity: { id: 'target', visible: true } }
  });

  const { pool } = makePool(1);
  const system = createProjectileSystem({ physics: world, effects: null, entities: [], pool });
  const instance = system.fire({ from: [0, 0, 0], direction: [0, 0, -1], speed: 100, owner: shipMesh });

  for (let frame = 0; frame < 120 && !instance.dead; frame++) system.update(1 / 60);

  assert.equal(instance.dead, true);
  assert.equal(instance.hit?.body, target, 'попадание ушло в корпус стрелка');
  assert.equal(shipRoot.body.velocity[2], 0, 'корпус стрелка получил импульс');
});

test('пустой пул даёт отказ, а не снаряд', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  const { pool, free } = makePool(1);
  const system = createProjectileSystem({ physics: world, effects: null, entities: [], pool });

  assert.ok(system.fire({ from: [0, 0, 0], direction: [0, 0, -1] }));
  assert.equal(system.fire({ from: [0, 0, 0], direction: [0, 0, -1] }), null);
  assert.equal(system.stats().rejected, 1);
  assert.equal(free.length, 0);
});

test('попадание отдаётся событием onHit для скриптов', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  const targetEntity = { id: 'shield', visible: true };
  const target = world.addBody({
    mass: 10,
    position: [0, 0, -30],
    shape: sphereShape(2),
    userData: { entity: targetEntity }
  });

  const { pool } = makePool(1);
  const events = [];
  const system = createProjectileSystem({
    physics: world,
    effects: null,
    entities: [],
    pool,
    onHit: (event) => events.push(event)
  });

  const instance = system.fire({ from: [0, 0, 0], direction: [0, 0, -1], speed: 100 });
  for (let frame = 0; frame < 120 && !instance.dead; frame++) system.update(1 / 60);

  assert.equal(events.length, 1, 'событие должно быть ровно одно');
  assert.equal(events[0].entity, targetEntity);
  assert.equal(events[0].body, target);
  assert.equal(events[0].projectile, 'rocket');
  assert.ok(events[0].point[2] < -27, 'точка попадания близко к цели');
});

test('промах не присылает событие onHit', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  const { pool } = makePool(1);
  const events = [];
  const system = createProjectileSystem({
    physics: world,
    effects: null,
    entities: [],
    pool,
    onHit: (event) => events.push(event)
  });

  const instance = system.fire({ from: [0, 0, 0], direction: [0, 1, 0], speed: 40, life: 0.4 });
  for (let frame = 0; frame < 120 && !instance.dead; frame++) system.update(1 / 60);

  assert.equal(instance.dead, true);
  assert.equal(events.length, 0);
});
