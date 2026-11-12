import test from 'node:test';
import assert from 'node:assert/strict';

import camera, { params } from '../public/scripts/camera.js';
import { M4 } from '../public/js/math.js';

function makeContext(overrides = {}) {
  const ship = { id: 'ship', matrix: M4.translation(10, 0, 0) };
  let pose = null;
  let disposed = false;

  const ctx = {
    params: {
      body: 'ship',
      height: 20,
      distance: 100,
      drop: 5,
      tilt: 0,
      side: 0,
      fov: 55,
      lag: 0,
      ...overrides
    },
    entity: { id: 'camera' },
    state: {},
    api: {
      claim: () => {},
      find: (id) => (id === 'ship' ? ship : null),
      player: ship,
      hud: { value: () => null, setValue: () => true },
      camera: {
        setPose: (value) => {
          pose = value;
          return true;
        },
        clearPose: () => {
          disposed = true;
        }
      }
    }
  };

  return { ctx, ship, getPose: () => pose, isDisposed: () => disposed };
}

test('camera.js объявляет ссылку на корабль как entity', () => {
  assert.equal(params.body.type, 'entity');
  assert.equal(params.body.default, 'ship');
  assert.equal(params.tilt.max, 360);
});

test('camera.js считает позу от объекта body', () => {
  const { ctx, getPose } = makeContext();
  camera.init(ctx);
  camera.update(ctx, 1 / 60);

  const pose = getPose();
  assert.ok(pose, 'поза не выставлена');
  assert.deepEqual(pose.position.map((v) => Math.round(v)), [10, 20, 100]);
  assert.deepEqual(pose.lookAt.map((v) => Math.round(v)), [10, 5, 0]);
  assert.equal(pose.fov, 55);
});

test('camera.js падает обратно на игрока, если body не найден', () => {
  const { ctx, getPose } = makeContext({ body: 'gone' });
  camera.init(ctx);
  camera.update(ctx, 1 / 60);

  assert.ok(getPose(), 'нет запасного объекта');
});

test('camera.js сбрасывает позу при dispose', () => {
  const { ctx, isDisposed } = makeContext();
  camera.init(ctx);
  camera.dispose(ctx);
  assert.equal(isDisposed(), true);
});
