import test from 'node:test';
import assert from 'node:assert/strict';

import weapons, { params } from '../public/scripts/weapons.js';
import { M4 } from '../public/js/math.js';

function makeContext(overrides = {}) {
  const ship = { id: 'ship', matrix: M4.translation(0, 0, 0) };
  const gunL = { id: 'gun-left', matrix: M4.translation(-10, 3, -6) };
  const gunR = { id: 'gun-right', matrix: M4.translation(10, 3, -6) };
  const entities = new Map([[ship.id, ship], [gunL.id, gunL], [gunR.id, gunR]]);

  const effects = { beam: [], tracer: [], smoke: [], spark: [] };
  const hud = { text: {}, classes: [], visible: false };

  const ctx = {
    params: {
      body: 'ship', muzzleLeft: 'gun-left', muzzleRight: 'gun-right', targetDistance: 500,
      laserDuration: 0.45, pointerWidth: 8,
      mgCount: 25, mgInterval: 0.2, mgCooldown: 0.8, mgSpeed: 650, mgLife: 1.2,
      rocketCooldown: 1.4, rocketSpeed: 95, rocketLife: 6,
      ...overrides
    },
    entity: { id: 'player-ship' },
    state: {},
    api: {
      claim: () => {},
      find: (id) => entities.get(id) || null,
      player: ship,
      aimTarget: () => [0, 0, -100],
      input: { mouse: { down: false }, keysDown: new Set() },
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

  return { ctx, effects, hud };
}

test('weapons.js объявляет точки выстрела и параметры', () => {
  assert.equal(params.muzzleLeft.type, 'entity');
  assert.equal(params.muzzleRight.type, 'entity');
  assert.equal(params.mgCount.default, 25);
  assert.equal(params.rocketCooldown.default, 1.4);
  assert.equal(params.rocketPrefab.default, 'rocket');
  assert.equal(params.rocketPrefab.type, 'text');
});

test('лазер рисует луч из левой точки выстрела', () => {
  const { ctx, effects, hud } = makeContext();
  weapons.init(ctx);
  ctx.api.input.mouse.down = true;
  weapons.update(ctx, 1 / 60);

  assert.equal(effects.beam.length, 1);
  assert.equal(effects.beam[0].from[0], -10);
  assert.equal(ctx.state.beamPulse > 0, true);
  assert.equal(hud.text['weapon-status'], 'ГОТОВ');
});

test('пулемёт стреляет очередью и обновляет HUD', () => {
  const { ctx, effects, hud } = makeContext();
  weapons.init(ctx);
  ctx.state.index = 2;
  ctx.api.input.mouse.down = true;
  weapons.update(ctx, 1 / 60);

  assert.equal(ctx.state.burstRemaining, 24);
  assert.equal(ctx.state.burstTotal, 25);
  assert.ok(effects.tracer.length >= 1);
  assert.match(hud.text['weapon-status'], /ОЧЕРЕДЬ 1\/25/);

  for (let i = 0; i < 70; i++) weapons.update(ctx, 1 / 60);
  assert.ok(ctx.state.burstRemaining < 24, 'очередь не продвинулась');
});

test('без системы снарядов ракета не рисуется движком', () => {
  const { ctx, effects, hud } = makeContext();
  weapons.init(ctx);
  ctx.state.index = 3;
  ctx.api.input.mouse.down = true;
  weapons.update(ctx, 1 / 60);

  // Процедурного запасного пути больше нет: только перезарядка и статус
  assert.equal(ctx.state.rockets, undefined);
  assert.ok(ctx.state.cooldowns.rocket > 0);
  assert.match(hud.text['weapon-status'], /ПЕРЕЗАРЯДКА/);
  assert.equal(
    effects.beam.length + effects.tracer.length + effects.smoke.length + effects.spark.length,
    0,
    'без снарядов движок не должен рисовать ракету'
  );
});

test('выбор оружия клавишей переключает активный слот', () => {
  const { ctx, hud } = makeContext();
  weapons.init(ctx);
  ctx.api.input.keysDown.add('Digit3');
  weapons.update(ctx, 1 / 60);

  assert.equal(ctx.state.index, 2);
  assert.ok(hud.classes.some(([id, name, on]) => id === 'weapon-slot-2' && name === 'active' && on));
});

test('ракета уходит в префаб, когда есть система снарядов', () => {
  const { ctx, effects } = makeContext();
  const fired = [];

  // Появился api.projectiles — процедурный эффект больше не создаётся
  ctx.api.projectiles = {
    fire: (options) => {
      fired.push(options);
      return { active: true };
    },
    stats: () => ({})
  };

  weapons.init(ctx);
  ctx.state.index = 3;
  ctx.api.input.mouse.down = true;
  weapons.update(ctx, 1 / 60);

  assert.equal(fired.length, 1);
  assert.equal(fired[0].prefab, 'rocket');
  assert.deepEqual(fired[0].from, [-10, 3, -6]);
  assert.equal(fired[0].speed, 95);
  assert.equal(fired[0].life, 6);
  assert.equal(fired[0].owner.id, 'ship');

  assert.equal(effects.beam.length + effects.tracer.length + effects.smoke.length + effects.spark.length, 0);
  assert.equal(ctx.state.rockets, undefined);
  assert.ok(ctx.state.cooldowns.rocket > 0);
});
