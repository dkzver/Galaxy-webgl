import test from 'node:test';
import assert from 'node:assert/strict';

import controller from '../public/scripts/weapons/controller.js';

function makeContext() {
  const shared = new Map();
  const hud = { visible: false, handlers: new Map() };
  const events = [];

  const ctx = {
    params: {},
    state: {},
    api: {
      claim: () => {},
      input: { mouse: { down: false }, keysDown: new Set() },
      emit: (event) => { events.push(event); return event; },
      shared: {
        get: (key) => shared.get(key) ?? null,
        set: (key, value) => { shared.set(key, value); return value; },
        delete: (key) => shared.delete(key)
      },
      hud: {
        isVisible: (id) => id === 'hud-menu' && hud.visible,
        onClick: (id, handler) => { hud.handlers.set(id, handler); return () => {}; }
      }
    }
  };

  return { ctx, shared, hud, events };
}

function mouse(ctx, down) {
  ctx.api.input.mouse.down = down;
}

function press(ctx, code) {
  ctx.api.input.keysDown.clear();
  ctx.api.input.keysDown.add(code);
}

test('контроллер публикует карту слотов и стартовый статус', () => {
  const { ctx, shared } = makeContext();
  controller.init(ctx);

  assert.deepEqual(shared.get('weapons.slots').map((slot) => slot.id), [
    'pointer', 'machinegun', 'rocket'
  ]);

  const status = shared.get('weapons.status');
  assert.equal(status.index, 0);
  assert.equal(status.id, 'pointer');
  assert.equal(status.mode, 'hold');
});

test('клавиши 2 и 3 переключают оружие', () => {
  const { ctx, shared } = makeContext();
  controller.init(ctx);

  press(ctx, 'Digit2');
  controller.update(ctx);
  assert.equal(ctx.state.index, 1);
  assert.equal(shared.get('weapons.status').id, 'machinegun');

  press(ctx, 'Digit3');
  controller.update(ctx);
  assert.equal(ctx.state.index, 2);
  assert.equal(shared.get('weapons.status').id, 'rocket');

  press(ctx, 'Digit4');
  controller.update(ctx);
  assert.equal(ctx.state.index, 2, 'клавиша без слота игнорируется');
});

test('клик по кнопке HUD выбирает оружие', () => {
  const { ctx, shared, hud } = makeContext();
  controller.init(ctx);

  hud.handlers.get('weapon-slot-2')();
  controller.update(ctx);

  assert.equal(ctx.state.index, 2);
  assert.equal(shared.get('weapons.status').id, 'rocket');
});

test('press и release выбранного оружия', () => {
  const { ctx, events } = makeContext();
  controller.init(ctx);

  mouse(ctx, true);
  controller.update(ctx);
  assert.deepEqual(events, [{ type: 'weapon.trigger', weapon: 'pointer', slot: 0, down: true }]);

  // Пока кнопка зажата, повторной команды нет.
  controller.update(ctx);
  assert.equal(events.length, 1);

  mouse(ctx, false);
  controller.update(ctx);
  assert.deepEqual(events.at(-1), { type: 'weapon.trigger', weapon: 'pointer', down: false });
});

test('пока пулемёт отрабатывает, другое оружие не стреляет', () => {
  const { ctx, shared, events } = makeContext();
  controller.init(ctx);

  ctx.state.index = 2;
  shared.set('machinegun.status', { burstRemaining: 20, burstTotal: 25, cooldown: 0, busy: true });

  mouse(ctx, true);
  controller.update(ctx);
  assert.equal(events.length, 0, 'очередь пулемёта ещё идёт');

  controller.update(ctx);
  assert.equal(events.length, 0);

  // Очередь закончилась — ракета получает команду.
  shared.set('machinegun.status', { burstRemaining: 0, burstTotal: 25, cooldown: 0.8, busy: false });
  controller.update(ctx);
  assert.deepEqual(events.at(-1), { type: 'weapon.trigger', weapon: 'rocket', slot: 2, down: true });
});

test('перезарядка выбранного оружия не даёт команду', () => {
  const { ctx, shared, events } = makeContext();
  controller.init(ctx);

  ctx.state.index = 2;
  shared.set('rocket.status', { cooldown: 1.4, cooldownTotal: 1.4, busy: false });

  mouse(ctx, true);
  controller.update(ctx);
  assert.equal(events.length, 0);

  shared.set('rocket.status', { cooldown: 0, cooldownTotal: 1.4, busy: false });
  controller.update(ctx);
  assert.deepEqual(events.at(-1), { type: 'weapon.trigger', weapon: 'rocket', slot: 2, down: true });
});

test('смена оружия при зажатой кнопке отпускает старое и нажимает новое', () => {
  const { ctx, events } = makeContext();
  controller.init(ctx);

  mouse(ctx, true);
  controller.update(ctx);

  ctx.state.index = 1;
  controller.update(ctx);

  assert.deepEqual(events.slice(-2), [
    { type: 'weapon.trigger', weapon: 'pointer', down: false },
    { type: 'weapon.trigger', weapon: 'machinegun', slot: 1, down: true }
  ]);
});

test('открытое меню не даёт команду', () => {
  const { ctx, hud, events } = makeContext();
  controller.init(ctx);

  mouse(ctx, true);
  hud.visible = true;
  controller.update(ctx);
  assert.equal(events.length, 0);

  hud.visible = false;
  controller.update(ctx);
  assert.deepEqual(events.at(-1), { type: 'weapon.trigger', weapon: 'pointer', slot: 0, down: true });
});

test('уже активная указка не получает повторный press', () => {
  const { ctx, shared, events } = makeContext();
  controller.init(ctx);

  shared.set('laser.status', { active: true, busy: true });
  mouse(ctx, true);
  controller.update(ctx);

  assert.equal(events.length, 0);
});
