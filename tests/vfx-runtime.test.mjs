import test from 'node:test';
import assert from 'node:assert/strict';

import { EffectSystem } from '../public/js/effects.js';
import { normalizeScene } from '../public/js/scene.js';
import { bindEffectTriggers } from '../public/js/scene-runtime.js';
import { ScriptRuntime } from '../public/js/script-runtime.js';
import { M4 } from '../public/js/math.js';

const IDENTITY = M4.identity();

function entity(id, effects, matrix = IDENTITY) {
  return { id, visible: true, matrix, effects, body: null };
}

test('normalizeScene принимает entity.effects и узел type: effect', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'vfx-scene',
    entities: [{
      id: 'ship',
      type: 'model',
      asset: 'corinth',
      effects: [{
        id: 'trail',
        effect: 'smoke-trail',
        trigger: 'auto',
        loop: true,
        duration: 2,
        offset: [0, 0, 2],
        params: { color: '#ffffff' }
      }]
    }, {
      id: 'impact',
      type: 'effect',
      effect: 'impact-spark',
      trigger: 'impact',
      duration: 0.4
    }]
  });

  const [ship, impact] = scene.entities;
  assert.equal(ship.effects.length, 1);
  assert.equal(ship.effects[0].trigger, 'auto');
  assert.deepEqual(ship.effects[0].offset, [0, 0, 2]);
  assert.equal(ship.effects[0].params.color, '#ffffff');

  assert.equal(impact.type, 'effect');
  assert.equal(impact.effects.length, 1);
  assert.equal(impact.effects[0].effect, 'impact-spark');
  assert.equal(impact.effects[0].trigger, 'impact');
});

test('auto-эффект стартует, следует за матрицей и гаснет по duration', () => {
  const system = new EffectSystem();
  system.registerDefinition('test-fade', { duration: 0.2, loop: false, layers: [] });

  const parent = entity('parent', [{
    id: 'slot',
    effect: 'test-fade',
    trigger: 'auto',
    loop: false,
    duration: 0.2,
    offset: [0, 0, 2]
  }], M4.translation(10, 0, 0));

  system.registerEntity(parent);
  assert.equal(system.isActive(parent, 'slot'), true);

  const [instanceId] = [...system.instances.keys()];
  assert.deepEqual(system.instances.get(instanceId).position, [10, 0, 2]);

  parent.matrix = M4.translation(20, 0, 0);
  system.update(0.1);
  assert.deepEqual(system.instances.get(instanceId).position, [20, 0, 2]);
  assert.equal(system.isActive(parent, 'slot'), true);

  system.update(0.15);
  assert.equal(system.isActive(parent, 'slot'), false);
  assert.equal(system.instances.size, 0);
});

test('скрытый родитель останавливает привязанный эффект', () => {
  const system = new EffectSystem();
  system.registerDefinition('loop', { duration: 10, loop: true, layers: [] });
  const parent = entity('parent', [{
    id: 'slot', effect: 'loop', trigger: 'auto', loop: true, duration: 10
  }]);

  system.registerEntity(parent);
  assert.equal(system.isActive(parent, 'slot'), true);
  parent.visible = false;
  system.update(0.016);
  assert.equal(system.isActive(parent, 'slot'), false);
});

test('spawn / setParams / stop работают с пулом инстансов', () => {
  const system = new EffectSystem();
  system.registerDefinition('inline', { duration: 1, loop: false, layers: [] });

  const instanceId = system.spawn('inline', { position: [1, 2, 3], params: { color: '#fff' } });
  assert.ok(instanceId);
  assert.equal(system.isActive(instanceId), true);

  assert.equal(system.setParams(instanceId, { color: '#000', intensity: 2 }), true);
  assert.equal(system.instances.get(instanceId).params.color, '#000');

  assert.equal(system.stop(instanceId), 1);
  assert.equal(system.isActive(instanceId), false);
  assert.equal(system.pool.length, 1);
});

test('impact-эффект запускается по событию физики', () => {
  const system = new EffectSystem();
  system.registerDefinition('impact-test', { duration: 0.3, loop: false, layers: [] });

  const body = { id: 'body' };
  const target = entity('target', [{
    id: 'hit', effect: 'impact-test', trigger: 'impact', duration: 0.3
  }]);
  target.body = body;

  let handler = null;
  const physics = {
    on(type, callback) {
      if (type === 'impact') handler = callback;
      return () => {};
    }
  };

  bindEffectTriggers([target], physics, system);
  assert.equal(typeof handler, 'function');

  handler({ a: body, b: {}, point: [1, 2, 3], normal: [0, 1, 0], speed: 4 });
  assert.equal(system.isActive(target, 'hit'), true);
  assert.deepEqual(system.instances.get([...system.instances.keys()][0]).params.hitPoint, [1, 2, 3]);
});

test('ctx.api.effects: spawn / setParams / stop / isActive', () => {
  const system = new EffectSystem();
  system.registerDefinition('api-test', { duration: 1, loop: true, layers: [] });

  const runtime = new ScriptRuntime({ entities: [], effects: system });
  const id = runtime.api.effects.spawn('api-test', { position: [1, 2, 3] });

  assert.ok(id);
  assert.equal(runtime.api.effects.isActive(id), true);
  assert.equal(runtime.api.effects.setParams(id, { intensity: 3 }), true);
  assert.equal(system.instances.get(id).params.intensity, 3);
  assert.equal(runtime.api.effects.stop(id), 1);
  assert.equal(runtime.api.effects.isActive(id), false);
});
