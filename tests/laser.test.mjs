import test from 'node:test';
import assert from 'node:assert/strict';

import laser, { params } from '../public/scripts/weapons/laser.js';
import { M4 } from '../public/js/math.js';

function makeContext(overrides = {}, options = {}) {
  const ship = { id: 'player-ship', matrix: M4.translation(0, 0, 0), quaternion: [0, 0, 0, 1] };
  const nose = { id: 'laser-1', matrix: M4.translation(0, 0.25, 3.3) };
  const gunL = { id: 'gun-left', matrix: M4.translation(-10, 3, -6) };
  const entities = [ship, nose, gunL];

  if (options.withPanel) entities.push({ id: 'panel', scripts: [{ file: 'weapons.js' }] });

  const beams = [];
  const hud = { text: {}, visible: false };
  const shared = new Map();

  const ctx = {
    params: {
      body: 'player-ship',
      muzzle1: 'laser-1',
      muzzle2: '',
      muzzle3: '',
      muzzle4: '',
      targetDistance: 500,
      width: 8,
      intensity: 2.4,
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
      effects: {
        beam: (id, data) => { beams.push({ id, ...data }); return id; },
        tracer: () => null,
        smoke: () => null,
        spark: () => null,
        clear: () => {}
      },
      hud: {
        isVisible: () => hud.visible,
        setText: (id, text) => { hud.text[id] = text; return true; },
        setClass: () => true,
        onClick: () => () => {}
      }
    }
  };

  return { ctx, beams, hud, shared };
}

/** Команда от панели оружия. */
function trigger(ctx, down, weapon = 'pointer') {
  laser.onEvent(ctx, { type: 'weapon.trigger', weapon, down });
}

test('laser.js объявляет массив точек вылета', () => {
  assert.equal(params.muzzle1.type, 'entity');
  assert.equal(params.muzzle2.type, 'entity');
  assert.equal(params.width.default, 8);
  assert.equal(params.intensity.default, 2.4);
});

test('точки вылета собираются в массив, пустые отбрасываются', () => {
  const { ctx } = makeContext({ muzzle2: 'gun-left', muzzle3: '' });
  laser.init(ctx);
  assert.deepEqual(ctx.state.muzzles, ['laser-1', 'gun-left']);
});

test('по команде press луч горит и идёт из первой точки', () => {
  const { ctx, beams, shared } = makeContext();
  laser.init(ctx);

  trigger(ctx, true);
  laser.update(ctx, 1 / 60);

  assert.equal(beams.length, 1);
  assert.ok(Math.abs(beams[0].from[2] - 3.3) < 1e-3, 'луч из объекта «Лазер»');
  assert.ok(Math.abs(beams[0].from[1] - 0.25) < 1e-3);
  assert.deepEqual(beams[0].to, [0, 0, -100]);
  assert.equal(beams[0].color[0], 1.0);
  assert.equal(shared.get('laser.status').active, true);

  laser.update(ctx, 1 / 60);
  assert.equal(beams.length, 2, 'луч перерисовывается каждый кадр');
});

test('по команде release луч гаснет', () => {
  const { ctx, shared } = makeContext();
  laser.init(ctx);

  trigger(ctx, true);
  laser.update(ctx, 1 / 60);
  trigger(ctx, false);
  laser.update(ctx, 1 / 60);

  assert.equal(shared.get('laser.status').active, false);
});

test('новое нажатие берёт следующую точку массива', () => {
  const { ctx, beams } = makeContext({ muzzle2: 'gun-left' });
  laser.init(ctx);

  trigger(ctx, true);
  laser.update(ctx, 1 / 60);
  trigger(ctx, false);
  laser.update(ctx, 1 / 60);

  trigger(ctx, true);
  laser.update(ctx, 1 / 60);

  assert.ok(Math.abs(beams[beams.length - 1].from[0] + 10) < 1e-3, 'вторая точка — gun-left');
});

test('точка вылета едет за кораблём, пока удерживается ЛКМ', () => {
  const { ctx, beams } = makeContext();
  laser.init(ctx);

  trigger(ctx, true);
  laser.update(ctx, 1 / 60);
  assert.ok(Math.abs(beams[0].from[0]) < 1e-3);

  // Корабль повернулся: мировая матрица ствола изменилась.
  ctx.api.find('laser-1').matrix = M4.translation(12, 0.25, -3.3);
  laser.update(ctx, 1 / 60);

  assert.ok(Math.abs(beams[1].from[0] - 12) < 1e-3, 'луч идёт из новой позиции ствола');
  assert.ok(Math.abs(beams[1].from[2] + 3.3) < 1e-3);
});

test('команда другому оружию не включает луч', () => {
  const { ctx, beams, shared } = makeContext();
  laser.init(ctx);

  trigger(ctx, true, 'machinegun');
  laser.update(ctx, 1 / 60);

  assert.equal(beams.length, 0);
  assert.equal(shared.get('laser.status').active, false);
});
