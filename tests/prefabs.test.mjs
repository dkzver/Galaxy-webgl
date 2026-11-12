import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { isProjectile, normalizeProjectile, preparePrefab, resetSpawnCounter } from '../public/js/prefabs.js';
import { normalizeScene } from '../public/js/scene.js';

const PREFAB = JSON.parse(fs.readFileSync('public/prefabs/rocket.json', 'utf8'));

test('префаб ракеты объявляет снаряд и дымный след', () => {
  const [root] = PREFAB.entities;
  assert.ok(isProjectile(root));
  assert.ok(root.tags.includes('projectile'));

  const projectile = normalizeProjectile(root.projectile);
  assert.equal(projectile.speed, 95);
  assert.equal(projectile.life, 6);
  assert.equal(projectile.radius, 0.42);
  assert.equal(projectile.impulse, 40);
  assert.equal(projectile.impact, 'impact-spark');
  assert.equal(projectile.trail, 'smoke-trail');

  const trail = root.effects.find((slot) => slot.id === 'trail');
  assert.ok(trail, 'у префаба нет слота trail');
  assert.equal(trail.effect, 'smoke-trail');
  assert.equal(trail.trigger, 'manual');
  assert.equal(trail.loop, true);
});

test('normalizeProjectile: дефолты, клампы и мусор', () => {
  const defaults = normalizeProjectile({});
  assert.equal(defaults.speed, 95);
  assert.equal(defaults.life, 6);
  assert.equal(defaults.radius, 0.4);
  assert.equal(defaults.turnRate, 0);
  assert.equal(defaults.damage, 0);
  assert.equal(defaults.impulse, 0);
  assert.equal(defaults.impact, null);
  assert.equal(defaults.trail, null);

  assert.equal(normalizeProjectile(null), null);
  assert.equal(normalizeProjectile('rocket'), null);

  const clamped = normalizeProjectile({
    speed: -50,
    life: 1000,
    radius: 0.0001,
    turnRate: 100,
    damage: -3,
    impulse: 'abc',
    impact: '  ',
    trail: 42
  });
  assert.equal(clamped.speed, 10);
  assert.equal(clamped.life, 30);
  assert.equal(clamped.radius, 0.05);
  assert.equal(clamped.turnRate, 20);
  assert.equal(clamped.damage, 0);
  assert.equal(clamped.impulse, 0);
  assert.equal(clamped.impact, null);
  assert.equal(clamped.trail, null);
});

test('preparePrefab не мутирует документ и выдаёт разные id', () => {
  resetSpawnCounter();
  const before = JSON.stringify(PREFAB);

  const first = preparePrefab(PREFAB);
  const second = preparePrefab(PREFAB);

  assert.equal(JSON.stringify(PREFAB), before, 'исходный документ изменился');
  assert.notEqual(first.root.id, PREFAB.entities[0].id);
  assert.notEqual(first.root.id, second.root.id);
  assert.equal(first.entities.length, 1, 'на верхнем уровне только корень');
  assert.equal(first.root.children.length, 1, 'меш — ребёнок корня');
  assert.notEqual(first.root.children[0].id, first.root.id);
  assert.notEqual(second.root.children[0].id, first.root.children[0].id);
});

test('preparePrefab применяет трансформ и сохраняет снаряд', () => {
  const prepared = preparePrefab(PREFAB, {
    position: [10, 2, -3],
    rotation: [0, 90, 0],
    scale: 2,
    visible: false,
    idPrefix: 'rocket-7'
  });

  assert.deepEqual(prepared.root.position, [10, 2, -3]);
  assert.deepEqual(prepared.root.rotation, [0, 90, 0]);
  assert.deepEqual(prepared.root.scale, [2, 2, 2]);
  assert.equal(prepared.root.visible, false);
  assert.match(prepared.root.id, /^rocket-7-/);
  assert.equal(prepared.projectile.speed, 95);
  assert.ok(prepared.projectile.impact);
  assert.deepEqual(prepared.root.children[0].children, [], 'buildScene ждёт массив детей');
});

test('normalizeScene сохраняет projectile у сущности', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'test',
    entities: [
      { id: 'scene', type: 'scene', children: [JSON.parse(JSON.stringify(PREFAB.entities[0]))] }
    ]
  });

  const rocket = scene.entities[0];
  assert.equal(rocket.id, PREFAB.entities[0].id);
  assert.ok(rocket.projectile, 'projectile потерялся при нормализации');
  assert.equal(rocket.projectile.radius, 0.42);
  assert.equal(rocket.projectile.trail, 'smoke-trail');
});
