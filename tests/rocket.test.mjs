import test from 'node:test';
import assert from 'node:assert/strict';

import rocket, { params } from '../public/scripts/weapons/rocket.js';
import { M4 } from '../public/js/math.js';

function makeContext(overrides = {}, options = {}) {
  const ship = { id: 'player-ship', matrix: M4.translation(0, 0, 0), quaternion: [0, 0, 0, 1] };
  const gunL = { id: 'gun-left', matrix: M4.translation(-10, 3, -6) };
  const gunR = { id: 'gun-right', matrix: M4.translation(10, 3, -6) };
  const entities = [ship, gunL, gunR];
  if (options.withPanel) entities.push({ id: 'panel', scripts: [{ file: 'weapons.js' }] });
  if (options.withRocketScript) entities.push({ id: 'weapon-1', scripts: [{ file: 'rocket.js' }] });

  const hud = { text: {}, classes: [], visible: false };
  const shared = new Map();
  const fired = [];

  const ctx = {
    params: {
      body: 'player-ship',
      muzzle1: 'gun-left',
      muzzle2: 'gun-right',
      targetDistance: 500,
      cooldown: 1.4,
      prefab: 'rocket',
      speed: 95,
      life: 6,
      ...overrides
    },
    entity: { id: 'weapon-1' },
    state: {},
    api: {
      claim: () => {},
      entities,
      find: (id) => entities.find((entity) => entity.id === id) || null,
      player: ship,
      aimTarget: () => [0, 0, -100],
      emit: () => {},
      shared: {
        get: (key) => shared.get(key) ?? null,
        set: (key, value) => { shared.set(key, value); return value; },
        delete: (key) => shared.delete(key)
      },
      projectiles: {
        fire: (options) => {
          fired.push(options);
          return { active: true };
        },
        stats: () => ({})
      },
      hud: {
        isVisible: () => hud.visible,
        setText: (id, text) => { hud.text[id] = text; return true; },
        setClass: () => true,
        onClick: () => () => {}
      }
    }
  };

  return { ctx, fired, hud, shared };
}

/** Команда от панели оружия. */
function trigger(ctx, down, weapon = 'rocket') {
  rocket.onEvent(ctx, { type: 'weapon.trigger', weapon, down });
}

test('rocket.js объявляет параметры пуска', () => {
  assert.equal(params.muzzle1.type, 'entity');
  assert.equal(params.muzzle2.type, 'entity');
  assert.equal(params.prefab.default, 'rocket');
  assert.equal(params.prefab.type, 'text');
  assert.equal(params.cooldown.default, 1.4);
});

test('по команде press ракета уходит в префаб из первой точки пуска', () => {
  const { ctx, fired, shared } = makeContext();
  rocket.init(ctx);

  trigger(ctx, true);
  rocket.update(ctx, 1 / 60);

  assert.equal(fired.length, 1);
  assert.equal(fired[0].prefab, 'rocket');
  assert.deepEqual(fired[0].from, [-10, 3, -6]);
  assert.equal(fired[0].speed, 95);
  assert.equal(fired[0].life, 6);
  assert.equal(fired[0].owner.id, 'player-ship');
  assert.ok(shared.get('rocket.status').cooldown > 0);
});

test('вторая ракета ждёт перезарядку, следующая точка пуска чередуется', () => {
  const { ctx, fired } = makeContext({ cooldown: 0.5 });
  rocket.init(ctx);

  trigger(ctx, true);
  assert.equal(fired.length, 1);

  // Пока перезарядка не прошла, повторный press игнорируется.
  trigger(ctx, false);
  trigger(ctx, true);
  assert.equal(fired.length, 1, 'во время перезарядки не пускаем');

  for (let i = 0; i < 40; i++) rocket.update(ctx, 1 / 60);
  trigger(ctx, false);
  trigger(ctx, true);

  assert.equal(fired.length, 2);
  assert.deepEqual(fired[1].from, [10, 3, -6], 'второй пуск из gun-right');
});

test('без системы снарядов выстрела нет, но перезарядка идёт', () => {
  const { ctx, shared } = makeContext();
  delete ctx.api.projectiles;
  rocket.init(ctx);

  trigger(ctx, true);
  rocket.update(ctx, 1 / 60);

  assert.ok(shared.get('rocket.status').cooldown > 0);
});

test('команда другому оружию не пускает ракету', () => {
  const { ctx, fired } = makeContext();
  rocket.init(ctx);

  trigger(ctx, true, 'machinegun');
  rocket.update(ctx, 1 / 60);

  assert.equal(fired.length, 0);
});

test('точка пуска читается заново на каждый пуск', () => {
  const { ctx, fired } = makeContext({ muzzle2: '', cooldown: 0.1 });
  rocket.init(ctx);

  trigger(ctx, true);
  assert.deepEqual(fired[0].from, [-10, 3, -6]);

  trigger(ctx, false);
  for (let i = 0; i < 10; i++) rocket.update(ctx, 1 / 60);

  // Корабль повернулся — ствол уехал вместе с ним.
  ctx.api.find('gun-left').matrix = M4.translation(10, 3, -6);
  trigger(ctx, true);

  assert.deepEqual(fired[1].from, [10, 3, -6]);
});
