import test from 'node:test';
import assert from 'node:assert/strict';

import machinegun, { params } from '../public/scripts/weapons/machinegun.js';
import { M4 } from '../public/js/math.js';

function makeContext(overrides = {}, options = {}) {
  const ship = { id: 'player-ship', matrix: M4.translation(0, 0, 0), quaternion: [0, 0, 0, 1] };
  const gunL = { id: 'gun-left', matrix: M4.translation(-10, 3, -6) };
  const gunR = { id: 'gun-right', matrix: M4.translation(10, 3, -6) };
  const entities = [ship, gunL, gunR];
  const weaponsEntity = { id: 'weapon-1', scripts: [{ file: 'machinegun.js' }] };
  if (options.withPanel) entities.push({ id: 'panel', scripts: [{ file: 'weapons.js' }] });
  if (options.withGunScript) entities.push(weaponsEntity);

  const effects = { beam: [], tracer: [], smoke: [], spark: [] };
  const hud = { text: {}, classes: [], visible: false };
  const shared = new Map();

  const ctx = {
    params: {
      body: 'player-ship',
      muzzle1: 'gun-left',
      muzzle2: 'gun-right',
      muzzle3: '',
      muzzle4: '',
      targetDistance: 500,
      count: 25,
      interval: 0.2,
      cooldown: 0.8,
      speed: 650,
      life: 1.2,
      width: 7,
      ...overrides
    },
    entity: weaponsEntity,
    state: {},
    api: {
      claim: () => {},
      entities,
      find: (id) => entities.find((entity) => entity.id === id) || null,
      player: ship,
      aimTarget: () => [0, 0, -200],
      emit: () => {},
      shared: {
        get: (key) => shared.get(key) ?? null,
        set: (key, value) => { shared.set(key, value); return value; },
        delete: (key) => shared.delete(key)
      },
      effects: {
        beam: (id, data) => { effects.beam.push({ id, ...data }); return id; },
        tracer: (id, data) => { effects.tracer.push({ id, ...data }); return id; },
        smoke: (id, data) => { effects.smoke.push({ id, ...data }); return id; },
        spark: (id, data) => { effects.spark.push({ id, ...data }); return id; },
        clear: () => {}
      },
      hud: {
        isVisible: () => hud.visible,
        setText: (id, text) => { hud.text[id] = text; return true; },
        setClass: (id, name, on) => { hud.classes.push([id, name, on]); return true; },
        onClick: () => () => {}
      }
    }
  };

  return { ctx, effects, hud, shared };
}

/** Команда от панели оружия. */
function trigger(ctx, down, weapon = 'machinegun') {
  machinegun.onEvent(ctx, { type: 'weapon.trigger', weapon, down });
}

test('machinegun.js объявляет массив точек вылета', () => {
  assert.equal(params.muzzle1.type, 'entity');
  assert.equal(params.muzzle2.type, 'entity');
  assert.equal(params.muzzle1.default, 'gun-left');
  assert.equal(params.muzzle2.default, 'gun-right');
  assert.equal(params.count.default, 25);
  assert.equal(params.interval.default, 0.2);
  assert.equal(params.cooldown.default, 0.8);
});

test('точки вылета собираются в массив, пустые отбрасываются', () => {
  const { ctx } = makeContext({ muzzle3: 'gun-left', muzzle4: '' });
  machinegun.init(ctx);
  assert.deepEqual(ctx.state.muzzles, ['gun-left', 'gun-right', 'gun-left']);
});

test('по команде press очередь стартует и чередует стволы', () => {
  const { ctx, effects, shared } = makeContext();
  machinegun.init(ctx);

  trigger(ctx, true);
  machinegun.update(ctx, 1 / 60);

  assert.equal(ctx.state.burstRemaining, 24);
  assert.equal(ctx.state.burstTotal, 25);
  assert.equal(effects.tracer[0].from[0], -10, 'первый выстрел из gun-left');
  assert.equal(shared.get('machinegun.status').burstTotal, 25);

  for (let i = 0; i < 15; i++) machinegun.update(ctx, 1 / 60);
  assert.ok(effects.tracer.some((entry) => entry.from[0] === 10), 'второй ствол тоже стреляет');
});

test('после очереди включается перезарядка', () => {
  const { ctx, shared } = makeContext({ count: 3, interval: 0.02, cooldown: 0.5 });
  machinegun.init(ctx);

  trigger(ctx, true);
  machinegun.update(ctx, 1 / 60);
  for (let i = 0; i < 20; i++) machinegun.update(ctx, 1 / 60);

  assert.equal(ctx.state.burstRemaining, 0);
  assert.ok(ctx.state.cooldown > 0);
  assert.ok(shared.get('machinegun.status').cooldown > 0);
});

test('команда release не останавливает уже начатую очередь', () => {
  const { ctx } = makeContext({ count: 5, interval: 0.1 });
  machinegun.init(ctx);

  trigger(ctx, true);
  machinegun.update(ctx, 1 / 60);
  const afterPress = ctx.state.burstRemaining;

  trigger(ctx, false);
  for (let i = 0; i < 6; i++) machinegun.update(ctx, 1 / 60);

  assert.ok(ctx.state.burstRemaining < afterPress, 'очередь достреливает');
});

test('команда другому оружию не запускает очередь', () => {
  const { ctx, effects } = makeContext();
  machinegun.init(ctx);

  trigger(ctx, true, 'laser');
  machinegun.update(ctx, 1 / 60);

  assert.equal(ctx.state.burstRemaining, 0);
  assert.equal(effects.tracer.length, 0);
});

test('точка вылета читается заново на каждый выстрел', () => {
  const { ctx, effects } = makeContext({ muzzle2: '', interval: 0.05 });
  machinegun.init(ctx);

  const spawns = () => effects.tracer.filter((entry) => entry.from[0] === entry.to[0]
    && entry.from[2] === entry.to[2]);

  trigger(ctx, true);
  machinegun.update(ctx, 1 / 60);
  assert.equal(spawns()[0].from[0], -10);

  // Корабль повернулся — ствол уехал вместе с ним.
  ctx.api.find('gun-left').matrix = M4.translation(-12, 3, -6);
  for (let i = 0; i < 4; i++) machinegun.update(ctx, 1 / 60);

  assert.ok(spawns().some((entry) => entry.from[0] === -12), 'следующий выстрел из новой позиции');
});
