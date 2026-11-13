import test from 'node:test';
import assert from 'node:assert/strict';

import { M4 } from '../public/js/math.js';
import target from '../public/scripts/target.js';

const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };

function model(id, matrix, parent = null) {
  return {
    id,
    type: 'model',
    matrix,
    parent,
    visible: true,
    model: { bounds }
  };
}

function makeContext({
  entities = [],
  player = model('player-1', M4.identity()),
  aim = { visible: true, point: [0, 0, -50] }
} = {}) {
  const shared = new Map();
  const ctx = {
    params: { player: 'player-1', reticle: 'reticle-1' },
    api: {
      claim() {},
      entities,
      find: (id) => (id === 'player-1' ? player : null),
      target: { aim: () => aim },
      shared: {
        set: (key, value) => shared.set(key, value),
        get: (key) => shared.get(key),
        delete: (key) => shared.delete(key)
      }
    }
  };

  return { ctx, shared };
}

test('контроллер публикует ссылку на прицел и попадание линии', () => {
  const station = model('station', M4.translation(0, 0, -20));
  const { ctx, shared } = makeContext({ entities: [station] });

  target.update(ctx);

  assert.equal(shared.get('target.reticle'), 'reticle-1');
  assert.deepEqual(shared.get('target.state'), { visible: true, aimed: true });
  assert.deepEqual(shared.get('target.point'), [0, 0, -50]);
});

test('модель вне линии — aimed false', () => {
  const station = model('station', M4.translation(10, 0, -20));
  const { ctx, shared } = makeContext({ entities: [station] });

  target.update(ctx);

  assert.equal(shared.get('target.state').aimed, false);
});

test('свой корабль не считается попаданием', () => {
  const player = model('player-1', M4.identity());
  const hull = model('hull', M4.translation(0, 0, -10), player);
  const { ctx, shared } = makeContext({ entities: [hull], player });

  target.update(ctx);

  assert.equal(shared.get('target.state').aimed, false);
});

test('без ссылки на игрока линия не строится', () => {
  const station = model('station', M4.translation(0, 0, -20));
  const { ctx, shared } = makeContext({ entities: [station], player: null });

  target.update(ctx);

  assert.deepEqual(shared.get('target.state'), { visible: false, aimed: false });
  assert.equal(shared.get('target.point'), null);
});

test('точка за кадром — visible false', () => {
  const station = model('station', M4.translation(0, 0, -20));
  const { ctx, shared } = makeContext({
    entities: [station],
    aim: { visible: false, point: [0, 0, -50] }
  });

  target.update(ctx);

  assert.deepEqual(shared.get('target.state'), { visible: false, aimed: false });
  assert.equal(shared.get('target.point'), null);
});
