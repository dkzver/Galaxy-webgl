import test from 'node:test';
import assert from 'node:assert/strict';

import panel from '../public/scripts/weapons.js';

function makeContext(status = null, withSlots = true) {
  const shared = new Map();
  if (withSlots) {
    shared.set('weapons.slots', [
      { id: 'pointer', key: '1', name: 'УКАЗАТЕЛЬ', mode: 'hold', statusKey: 'laser.status' },
      { id: 'machinegun', key: '2', name: 'ПУЛЕМЁТ', mode: 'burst', statusKey: 'machinegun.status' },
      { id: 'rocket', key: '3', name: 'РАКЕТА', mode: 'single', statusKey: 'rocket.status' }
    ]);
  }

  if (status) shared.set('weapons.status', status);

  const hud = { text: {}, classes: [], clicks: 0, visible: false };

  const ctx = {
    params: {},
    state: {},
    api: {
      claim: () => {},
      shared: {
        get: (key) => shared.get(key) ?? null,
        set: (key, value) => { shared.set(key, value); return value; },
        delete: (key) => shared.delete(key)
      },
      hud: {
        isVisible: () => hud.visible,
        setText: (id, text) => { hud.text[id] = text; return true; },
        setClass: (id, name, on) => { hud.classes.push([id, name, on]); return true; },
        onClick: () => { hud.clicks += 1; return () => {}; }
      }
    }
  };

  return { ctx, shared, hud };
}

test('панель рисует активный слот и очередь пулемёта', () => {
  const { ctx, hud } = makeContext({ index: 1, mode: 'burst', burstRemaining: 20, burstTotal: 25 });

  panel.init(ctx);
  panel.update(ctx);

  assert.ok(hud.classes.some(([id, name, on]) => id === 'weapon-slot-1' && name === 'active' && on));
  assert.ok(hud.classes.some(([id, name, on]) => id === 'weapon-slot-0' && name === 'active' && !on));
  assert.equal(hud.text['weapon-status'], 'ОЧЕРЕДЬ 5/25');
});

test('панель показывает перезарядку ракеты', () => {
  const { ctx, hud } = makeContext({ index: 2, mode: 'single', cooldown: 1.4 });

  panel.init(ctx);
  panel.update(ctx);

  assert.equal(hud.text['weapon-status'], 'ПЕРЕЗАРЯДКА 1.4 С');
});

test('панель показывает активный луч', () => {
  const { ctx, hud } = makeContext({ index: 0, mode: 'hold', active: true });

  panel.init(ctx);
  panel.update(ctx);

  assert.equal(hud.text['weapon-status'], 'ЛУЧ АКТИВЕН');
});

test('без weapons.status панель пишет ГОТОВ и не падает', () => {
  const { ctx, hud } = makeContext(null, false);

  panel.init(ctx);
  panel.update(ctx);

  assert.equal(hud.text['weapon-status'], 'ГОТОВ');
});

test('панель не читает ввод и не публикует статусы', () => {
  const { ctx, shared, hud } = makeContext({ index: 0, mode: 'hold', active: false });
  const before = JSON.stringify([...shared.entries()]);

  panel.init(ctx);
  panel.update(ctx);

  assert.equal(hud.clicks, 0, 'клики HUD обрабатывает контроллер');
  assert.equal(JSON.stringify([...shared.entries()]), before, 'панель ничего не пишет в shared');
});
