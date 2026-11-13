import test from 'node:test';
import assert from 'node:assert/strict';

import cursor from '../public/scripts/cursor.js';

function makeContext(binding = 'reticle-cursor-1') {
  const shown = [];
  let hidden = 0;

  const ctx = {
    entity: {
      id: 'reticle-cursor-1',
      raw: { reticle: { size: 24, color: '#9fe4ff', aimColor: '#ffc857' } },
      reticleDesign: { id: 'circle' }
    },
    api: {
      claim() {},
      scene: { cursor: binding },
      target: {
        cursor: (options) => shown.push(options),
        hideCursor: () => { hidden += 1; }
      }
    }
  };

  return { ctx, shown, hidden: () => hidden };
}

test('курсор рисуется, когда сцена ссылается на этот объект', () => {
  const { ctx, shown } = makeContext('reticle-cursor-1');

  cursor.update(ctx);

  assert.equal(shown.length, 1);
  assert.equal(shown[0].config.design.id, 'circle');
});

test('без ссылки сцены курсор скрывается', () => {
  const { ctx, shown, hidden } = makeContext('');

  cursor.update(ctx);

  assert.equal(shown.length, 0);
  assert.equal(hidden(), 1);
});

test('чужая ссылка сцены скрывает курсор', () => {
  const { ctx, shown, hidden } = makeContext('reticle-1');

  cursor.update(ctx);

  assert.equal(shown.length, 0);
  assert.equal(hidden(), 1);
});
