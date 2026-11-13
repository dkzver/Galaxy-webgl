import test from 'node:test';
import assert from 'node:assert/strict';

import shield from '../public/scripts/ship/shield.js';

function makeCtx(entity) {
  const handlers = new Map();

  return {
    entity,
    state: {},
    params: {},
    api: {
      on(type, handler) {
        if (!handlers.has(type)) handlers.set(type, new Set());
        handlers.get(type).add(handler);
        return () => handlers.get(type).delete(handler);
      },
      emit(event) {
        for (const handler of handlers.get(event.type) || []) handler(event);
      }
    }
  };
}

test('без материала щит скрывает меш, оставляя тело', () => {
  const body = { isStatic: true, shape: { type: 'sphere', radius: 3.55 } };
  const entity = {
    id: 'shield-1',
    type: 'model',
    visible: true,
    raw: { visible: true },
    model: { parts: [{ name: 'shield' }] },
    body,
    children: []
  };

  const ctx = makeCtx(entity);
  shield.init(ctx);

  assert.equal(entity.visible, false, 'меш должен быть скрыт');
  assert.equal(entity.raw.visible, true, 'raw.visible трогать нельзя — иначе не построится тело');
  assert.equal(entity.body, body, 'тело должно остаться');
  assert.equal(ctx.state.hidden, true);
});

test('без материала скрываются модели-дети, но не пустые узлы', () => {
  const mesh = { id: 'mesh', model: { parts: [] }, visible: true };
  const anchor = { id: 'anchor', visible: true };
  const root = { id: 'root', visible: true, children: [mesh, anchor] };

  shield.init(makeCtx(root));

  assert.equal(mesh.visible, false);
  assert.equal(anchor.visible, true);
});

test('с материалом меш не скрывается, а попадания копятся', () => {
  const entity = {
    id: 'shield-1',
    type: 'model',
    visible: true,
    raw: { materialId: 'shield' },
    model: { parts: [{ name: 'shield' }] },
    children: []
  };

  const ctx = makeCtx(entity);
  shield.init(ctx);

  assert.equal(entity.visible, true, 'оболочку рисует материал');
  assert.equal(ctx.state.hidden, false);
  assert.ok(Array.isArray(entity.shieldHits), 'рендер читает entity.shieldHits');

  ctx.api.emit({ type: 'projectile.hit', entity: { id: 'other' }, point: [0, 0, 0] });
  assert.equal(entity.shieldHits.length, 0, 'чужие попадания игнорируются');

  ctx.api.emit({ type: 'projectile.hit', entity, point: [1, 2, 3] });
  assert.equal(entity.shieldHits.length, 1);
  assert.deepEqual(entity.shieldHits[0].position, [1, 2, 3]);
  assert.equal(entity.shieldHits[0].age, 0);

  shield.update(ctx, 0.1);
  assert.equal(entity.shieldHits[0].age, 0.1);

  for (let i = 0; i < 30; i++) shield.update(ctx, 0.1);
  assert.equal(entity.shieldHits.length, 0, 'старые попадания удаляются');
});

test('одновременно хранится не больше четырёх попаданий', () => {
  const entity = { id: 'shield', visible: true, raw: { materialId: 'shield' }, model: { parts: [] }, children: [] };
  const ctx = makeCtx(entity);
  shield.init(ctx);

  for (let i = 0; i < 7; i++) {
    ctx.api.emit({ type: 'projectile.hit', entity, point: [i, 0, 0] });
  }

  assert.equal(entity.shieldHits.length, 4);
  assert.deepEqual(entity.shieldHits[0].position, [6, 0, 0], 'последнее попадание первым');
});
