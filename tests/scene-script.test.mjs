import test from 'node:test';
import assert from 'node:assert/strict';

import sceneScript from '../public/scripts/first-screen.js';

test('first-screen вызывает api.scene.build с настройками кадра', () => {
  const built = [];
  const params = {
    background: '#102030',
    hudStyle: 'hud/style.css',
    loadingFile: 'hud/loading.html',
    loadingScript: 'scripts/loading.js',
    cursor: 'reticle-cursor-1'
  };

  sceneScript.init({
    params,
    api: {
      claim() {},
      scene: { build: (options) => built.push(options) }
    }
  });

  assert.equal(built.length, 1);
  assert.deepEqual(built[0], params);
});
