import test from 'node:test';
import assert from 'node:assert/strict';

import mining, { params } from '../public/scripts/mining.js';
import { M4 } from '../public/js/math.js';

function makeContext(overrides = {}) {
  const ship = { id: 'ship', matrix: M4.translation(0, 0, 0) };
  const origin = { id: 'mining-origin', matrix: M4.translation(0, -2, 0) };
  const rock = {
    id: 'rock',
    matrix: M4.translation(0, 0, -20),
    mining: { zoneScale: 2, zoneRadius: 25 },
    radius: 4,
    scaleUniform: 1,
    hitTest: () => 10
  };
  const entities = new Map([[ship.id, ship], [origin.id, origin], [rock.id, rock]]);

  const effects = { beam: [], spark: [] };
  const hud = { text: {}, classes: [], styles: [] };

  const ctx = {
    params: {
      origin: 'mining-origin', body: 'ship', range: 60, cycleTime: 2.6, decay: 0.7, sparkInterval: 0.05,
      ...overrides
    },
    entity: { id: 'player-ship' },
    state: {},
    api: {
      claim: () => {},
      find: (id) => entities.get(id) || null,
      player: ship,
      miningTargets: () => [rock],
      input: {
        keys: { f: true },
        cursorRay: () => ({ origin: [0, 0, 0], direction: [0, 0, -1] })
      },
      effects: {
        beam: (id, data) => { effects.beam.push({ id, ...data }); return id; },
        spark: (id, data) => { effects.spark.push({ id, ...data }); return id; }
      },
      hud: {
        isVisible: () => false,
        setText: (id, value) => { hud.text[id] = value; return true; },
        setClass: (id, name, on) => { hud.classes.push([id, name, on]); return true; },
        setStyle: (id, property, value) => { hud.styles.push([id, property, value]); return true; }
      }
    }
  };

  return { ctx, effects, hud, rock, ship };
}

test('mining.js объявляет точку луча и цикл добычи', () => {
  assert.equal(params.origin.type, 'entity');
  assert.equal(params.cycleTime.default, 2.6);
  assert.equal(params.range.default, 60);
});

test('добыча копит прогресс и выдаёт ресурс', () => {
  const { ctx, effects, hud } = makeContext();
  mining.init(ctx);

  for (let i = 0; i < 160; i++) mining.update(ctx, 1 / 60);

  assert.equal(ctx.state.resources, 1);
  assert.ok(ctx.state.progress > 0);
  assert.ok(effects.beam.length > 0);
  assert.ok(effects.spark.length > 0);
  assert.equal(hud.text['mining-count'], '1 ед.');
  assert.ok(hud.styles.some(([id, prop]) => id === 'mining-fill' && prop === 'width'));
});

test('вне зоны прогресс не растёт и луча нет', () => {
  const { ctx, effects, ship } = makeContext();
  mining.init(ctx);
  ship.matrix[14] = -200;

  for (let i = 0; i < 30; i++) mining.update(ctx, 1 / 60);

  assert.equal(ctx.state.progress, 0);
  assert.equal(effects.beam.length, 0);
  assert.equal(ctx.state.inside, false);
});

test('без F прогресс остывает', () => {
  const { ctx } = makeContext();
  mining.init(ctx);
  ctx.state.progress = 0.5;
  ctx.api.input.keys.f = false;

  for (let i = 0; i < 30; i++) mining.update(ctx, 1 / 60);
  assert.ok(ctx.state.progress < 0.5);
});
