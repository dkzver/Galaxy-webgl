import test from 'node:test';
import assert from 'node:assert/strict';

import { createProjectilePool } from '../public/js/projectile-pool.js';

function makeEffects() {
  return {
    mounts: [],
    unmounts: [],
    plays: [],
    stops: [],
    mount(root) {
      this.mounts.push(root);
    },
    unmount(root) {
      this.unmounts.push(root);
    },
    play(root, slotId) {
      this.plays.push(slotId);
      return 'vfx-1';
    },
    stop(root) {
      this.stops.push(root);
      return 1;
    }
  };
}

function makeRuntime() {
  const runtime = {
    spawns: 0,
    async spawn(id) {
      runtime.spawns += 1;
      const root = {
        id: `${id}-${runtime.spawns}`,
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        visible: true,
        raw: { visible: true },
        children: []
      };
      const mesh = { id: `${root.id}-mesh`, visible: true, raw: { visible: true }, children: [] };
      root.children.push(mesh);

      return {
        root,
        entities: [root, mesh],
        projectile: { speed: 95, life: 6, radius: 0.42, trail: 'smoke-trail' },
        prefab: id
      };
    }
  };
  return runtime;
}

test('прогрев создаёт экземпляры и прячет их целиком', async () => {
  const runtime = makeRuntime();
  const effects = makeEffects();
  const pool = createProjectilePool({ runtime, effects, prefab: 'rocket', size: 3 });

  const count = await pool.prewarm();

  assert.equal(count, 3);
  assert.equal(runtime.spawns, 3);
  assert.deepEqual(pool.stats(), { prefab: 'rocket', size: 3, free: 3, active: 0, shots: 0, rejected: 0 });
  assert.equal(effects.mounts.length, 0, 'спящие ракеты не должны привязывать эффекты');

  for (const instance of pool.instances) {
    for (const entity of instance.entities) {
      assert.equal(entity.visible, false, 'меш спящей ракеты остался видимым');
      assert.equal(entity.raw.visible, false);
    }
  }
});

test('acquire показывает поддерево и запускает след, release гасит', async () => {
  const runtime = makeRuntime();
  const effects = makeEffects();
  const pool = createProjectilePool({ runtime, effects, prefab: 'rocket', size: 2 });
  await pool.prewarm();

  const instance = pool.acquire();
  assert.ok(instance);
  assert.equal(instance.active, true);
  assert.equal(pool.stats().free, 1);
  assert.equal(pool.stats().active, 1);

  for (const entity of instance.entities) assert.equal(entity.visible, true);
  assert.equal(effects.mounts.length, 1);
  assert.deepEqual(effects.plays, ['smoke-trail']);

  pool.release(instance);
  assert.equal(instance.active, false);
  for (const entity of instance.entities) assert.equal(entity.visible, false);
  assert.equal(effects.stops.length, 1);
  assert.equal(effects.unmounts.length, 1);
  assert.equal(pool.stats().free, 2);
});

test('повторный acquire не создаёт новых экземпляров', async () => {
  const runtime = makeRuntime();
  const effects = makeEffects();
  const pool = createProjectilePool({ runtime, effects, prefab: 'rocket', size: 2 });
  await pool.prewarm();

  const first = pool.acquire();
  pool.release(first);
  const second = pool.acquire();

  assert.equal(second, first, 'вернулся другой экземпляр');
  assert.equal(runtime.spawns, 2, 'пул создал новую сущность вместо переиспользования');
  assert.equal(pool.stats().shots, 2);
});

test('пустой пул отказывает и считает отказы', async () => {
  const runtime = makeRuntime();
  const pool = createProjectilePool({ runtime, effects: null, prefab: 'rocket', size: 2 });
  await pool.prewarm();

  assert.ok(pool.acquire());
  assert.ok(pool.acquire());
  assert.equal(pool.acquire(), null);
  assert.equal(pool.stats().rejected, 1);
});

test('двойной release не дублирует экземпляр в очереди', async () => {
  const runtime = makeRuntime();
  const pool = createProjectilePool({ runtime, effects: null, prefab: 'rocket', size: 1 });
  await pool.prewarm();

  const instance = pool.acquire();
  pool.release(instance);
  pool.release(instance);

  assert.equal(pool.stats().free, 1);
  assert.equal(pool.instances.length, 1);
});
