import test from 'node:test';
import assert from 'node:assert/strict';

import { M4 } from '../public/js/math.js';
import bot, { params } from '../public/scripts/bots/aim-attack.js';
import { angleBetween, forwardOf, inVisionCone, predictAimPoint, turnToward } from '../public/scripts/bots/vision.js';

function makeBus() {
  const handlers = new Map();
  return {
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
      return () => handlers.get(type).delete(handler);
    },
    emit(event) {
      for (const [type, set] of handlers) {
        if (type !== event.type && type !== '*') continue;
        for (const handler of set) handler(event);
      }
    }
  };
}

function makeActor({ id, position = [0, 0, 0], quaternion = [0, 0, 0, 1], bus }) {
  const entity = {
    id,
    position: position.slice(),
    quaternion: quaternion.slice(),
    raw: { tags: ['bot'] },
    children: []
  };
  entity.matrix = M4.translation(position[0], position[1], position[2]);

  const shots = [];
  const sparks = [];
  const state = {};
  const ctx = {
    entity,
    state,
    params: {},
    api: {
      player: null,
      entities: [],
      getVelocity: (target) => target?.body?.velocity?.slice?.() || [0, 0, 0],
      setQuaternion: (target, value) => { target.quaternion = value; },
      projectiles: { fire: (options) => { shots.push(options); return { active: true }; } },
      effects: { spark: (effectId, data) => { sparks.push({ id: effectId, ...data }); return effectId; } },
      emit: (event) => bus.emit(event),
      on: (type, handler) => bus.on(type, handler)
    }
  };

  bot.init(ctx);
  return { entity, ctx, shots, sparks };
}

function makePlayer(position, velocity = [0, 0, 0]) {
  const entity = { id: 'player', position: position.slice(), body: { velocity: velocity.slice() }, raw: { tags: ['player'] } };
  entity.matrix = M4.translation(position[0], position[1], position[2]);
  return entity;
}

test('бот объявляет параметры наведения и огня', () => {
  assert.equal(params.projectile.default, 'rocket');
  assert.equal(params.projectile.type, 'text');
  assert.ok(params.range.default >= 100);
  assert.ok(params.fireInterval.default > 0);
});

test('зрение: конус, угол и упреждение', () => {
  const cone = { position: [0, 0, 0], forward: [0, 0, -1], range: 100, halfAngle: Math.PI / 3 };

  assert.equal(inVisionCone({ ...cone, target: [0, 0, -50] }), true);
  assert.equal(inVisionCone({ ...cone, target: [0, 0, -150] }), false, 'дальность');
  assert.equal(inVisionCone({ ...cone, target: [0, 0, 50] }), false, 'сзади');
  assert.equal(inVisionCone({ ...cone, target: [90, 0, 0] }), false, 'сбоку за конусом');

  assert.ok(Math.abs(angleBetween([0, 0, -1], [0, 0, -1])) < 1e-9);
  assert.ok(Math.abs(angleBetween([0, 0, -1], [0, 0, 1]) - Math.PI) < 1e-6);

  const lead = predictAimPoint([0, 0, 0], [0, 0, -60], [30, 0, 0], 120, 1);
  assert.ok(Math.abs(lead[0] - 15) < 0.5, `упреждение ${lead[0]}`);
  assert.equal(lead[2], -60);
});

test('доворот: шаг ограничен, 180° не проскакивает мгновенно', () => {
  const turned = turnToward([0, 0, 0, 1], [0, 0, 1], 0.2);
  const forward = forwardOf(turned);
  assert.ok(Math.abs(angleBetween(forward, [0, 0, 1]) - (Math.PI - 0.2)) < 0.02, 'шаг доворота');

  const half = turnToward([0, 0, 0, 1], [1, 0, 0], 0.3);
  assert.ok(forwardOf(half)[0] > 0.25);
  assert.ok(Math.abs(forwardOf(half)[2] + Math.cos(0.3)) < 0.05);
});

test('бот видит игрока, наводится и стреляет', () => {
  const bus = makeBus();
  const actor = makeActor({ id: 'bot-1', bus });
  const player = makePlayer([0, 0, -60]);
  actor.ctx.api.player = player;

  bot.update(actor.ctx, 1 / 60);

  assert.equal(actor.ctx.state.engaged, true);
  assert.equal(actor.shots.length, 1, 'выстрела не было');
  assert.equal(actor.shots[0].prefab, 'rocket');
  assert.ok(actor.shots[0].from[2] < 0, 'дуло не впереди корпуса');
  assert.ok(Math.abs(actor.shots[0].direction[2] + 1) < 0.1);
  assert.equal(actor.sparks.length, 1, 'нет вспышки выстрела');
});

test('игрок вне конуса: бот не стреляет и теряет цель по таймеру', () => {
  const bus = makeBus();
  const actor = makeActor({ id: 'bot-1', bus });
  actor.ctx.api.player = makePlayer([0, 0, 60]);

  bot.update(actor.ctx, 1 / 60);
  assert.equal(actor.ctx.state.engaged, false);
  assert.equal(actor.shots.length, 0);

  for (let i = 0; i < 40; i++) bot.update(actor.ctx, 0.1);
  assert.equal(actor.ctx.state.engaged, false);
  assert.equal(actor.shots.length, 0);
});

test('цель в конусе сбоку: бот доворачивается и открывает огонь', () => {
  const bus = makeBus();
  const actor = makeActor({ id: 'bot-1', bus });
  actor.ctx.params.fovDeg = 240;
  actor.ctx.api.player = makePlayer([-60, 0, 0]);

  bot.update(actor.ctx, 1 / 60);
  assert.equal(actor.ctx.state.engaged, true);
  assert.equal(actor.shots.length, 0, 'стрельба без наведения');

  for (let i = 0; i < 120; i++) bot.update(actor.ctx, 1 / 60);
  assert.ok(actor.shots.length >= 1, 'бот не открыл огонь после доворота');
  assert.ok(actor.shots[0].direction[0] < -0.9, 'стреляет не в сторону игрока');
});

test('упреждение: стреляет с опережением по движущейся цели', () => {
  const bus = makeBus();
  const actor = makeActor({ id: 'bot-1', bus });
  const player = makePlayer([0, 0, -50], [40, 0, 0]);
  actor.ctx.api.player = player;

  for (let i = 0; i < 120 && !actor.shots.length; i++) bot.update(actor.ctx, 1 / 60);

  assert.ok(actor.shots.length >= 1);
  assert.ok(actor.shots[0].direction[0] > 0.05, 'нет упреждения по X');
});

test('контакт соседа: бот доворачивается к точке, но сам не стреляет', () => {
  const bus = makeBus();
  const scout = makeActor({ id: 'scout', bus });
  const wingman = makeActor({ id: 'wingman', position: [0, 0, 300], quaternion: [0, 1, 0, 0], bus });

  const player = makePlayer([0, 0, -50]);
  scout.ctx.api.player = player;
  wingman.ctx.api.player = player; // слишком далеко: 350 > range

  bot.update(scout.ctx, 1 / 60);
  assert.equal(scout.ctx.state.engaged, true);

  assert.equal(wingman.ctx.state.contacts, 1, 'сосед не получил контакт');
  assert.ok(wingman.ctx.state.suspicion > 0);

  const before = wingman.entity.quaternion.slice();
  bot.update(wingman.ctx, 0.1);
  assert.notDeepEqual(wingman.entity.quaternion, before, 'бот не довернулся к контакту');
  assert.equal(wingman.shots.length, 0, 'стрельба без собственного контакта');
});

test('без игрока бот сканирует и не падает', () => {
  const bus = makeBus();
  const actor = makeActor({ id: 'bot-1', bus });
  const before = actor.entity.quaternion.slice();

  bot.update(actor.ctx, 0.1);

  assert.notDeepEqual(actor.entity.quaternion, before);
  assert.equal(actor.shots.length, 0);
});
