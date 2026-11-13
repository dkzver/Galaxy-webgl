import test from 'node:test';
import assert from 'node:assert/strict';

import reticle from '../public/scripts/reticle.js';

function makeContext({
  binding = 'reticle-1',
  state = { visible: true, aimed: true },
  point = [0, 0, -50]
} = {}) {
  const shown = [];
  let hidden = 0;

  const ctx = {
    entity: {
      id: 'reticle-1',
      raw: { reticle: { size: 34, color: '#68daff', aimColor: '#ffc857' } },
      reticleDesign: { id: 'crosshair' }
    },
    api: {
      claim() {},
      shared: {
        get: (key) => {
          if (key === 'target.reticle') return binding;
          if (key === 'target.state') return state;
          if (key === 'target.point') return point;
          return null;
        }
      },
      target: {
        show: (options) => shown.push(options),
        hide: () => { hidden += 1; }
      }
    }
  };

  return { ctx, shown, hidden: () => hidden };
}

test('перекрестие рисуется по ссылке и состоянию контроллера', () => {
  const { ctx, shown } = makeContext({ state: { visible: true, aimed: true } });

  reticle.update(ctx);

  assert.equal(shown.length, 1);
  assert.equal(shown[0].state.aimed, true);
  assert.deepEqual(shown[0].point, [0, 0, -50]);
});

test('цвет покоя, когда контроллер не нашёл модель на линии', () => {
  const { ctx, shown } = makeContext({ state: { visible: true, aimed: false } });

  reticle.update(ctx);

  assert.equal(shown[0].state.aimed, false);
});

test('без ссылки или при чужой ссылке прицел скрыт', () => {
  for (const binding of ['', 'other-reticle']) {
    const { ctx, shown, hidden } = makeContext({ binding });
    reticle.update(ctx);

    assert.equal(shown.length, 0, `ссылка «${binding || 'пусто'}»`);
    assert.equal(hidden(), 1);
  }
});

test('прицел скрыт, если точка за кадром', () => {
  const { ctx, shown, hidden } = makeContext({ state: { visible: false, aimed: false }, point: null });

  reticle.update(ctx);

  assert.equal(shown.length, 0);
  assert.equal(hidden(), 1);
});
