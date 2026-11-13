import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngineBridge } from '../public/js/app/engine-bridge.js';

test('bridge publishes scene lifecycle and resolves readiness once', async () => {
  const bridge = createEngineBridge();
  const events = [];
  bridge.api.subscribe('scene:loading', (event) => events.push(event));
  bridge.api.subscribe('scene:ready', (event) => events.push(event));

  bridge.publish('scene:loading', { sceneId: 'hangar' });
  assert.deepEqual(bridge.api.getSnapshot(), { status: 'loading', sceneId: 'hangar', error: null });

  const ready = bridge.api.waitUntilReady();
  const detail = { id: 'hangar', entities: 12, player: null };
  bridge.publish('scene:ready', detail);
  bridge.publish('scene:ready', { id: 'next-scene' });

  assert.equal(await ready, detail);
  assert.deepEqual(bridge.api.getSnapshot(), { status: 'ready', sceneId: 'next-scene', error: null });
  assert.deepEqual(events.map((event) => event.type), ['scene:loading', 'scene:ready', 'scene:ready']);
});

test('bridge rejects readiness with the scene error', async () => {
  const bridge = createEngineBridge();
  const ready = bridge.api.ready;
  bridge.publish('scene:error', { message: 'scene load failed' });

  await assert.rejects(ready, /scene load failed/);
  assert.deepEqual(bridge.api.getSnapshot(), { status: 'error', sceneId: null, error: 'scene load failed' });
});

test('bridge subscriptions can be removed and validate handlers', () => {
  const bridge = createEngineBridge();
  let calls = 0;
  const unsubscribe = bridge.api.subscribe('scene:ready', () => { calls += 1; });

  bridge.publish('scene:ready', { id: 'first' });
  unsubscribe();
  bridge.publish('scene:ready', { id: 'second' });

  assert.equal(calls, 1);
  assert.throws(() => bridge.api.subscribe('scene:ready', null), TypeError);
});
