import test from 'node:test';
import assert from 'node:assert/strict';

import { M4 } from '../public/js/math.js';
import { pickClosest, pickModel, rayBox, transformDirection } from '../public/js/picking.js';

const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };

function model(matrix, box = bounds) {
  return { model: { bounds: box }, matrix, visible: true };
}

test('rayBox: попадание и промах', () => {
  const hit = rayBox([0, 0, -5], [0, 0, 1], bounds.min, bounds.max);
  assert.equal(hit, 4, 'вход в куб с z=-5');

  assert.equal(rayBox([0, 0, -5], [0, 1, 0], bounds.min, bounds.max), null);
  assert.equal(rayBox([0, 0, 5], [0, 0, 1], bounds.min, bounds.max), null, 'луч уходит от куба');
});

test('transformDirection не применяет перенос', () => {
  const matrix = M4.translation(10, 20, 30);
  assert.deepEqual(transformDirection(matrix, [1, 2, 3]), [1, 2, 3]);
});

test('pickModel: луч попадает в модель со сдвигом и масштабом', () => {
  const entity = model(M4.mul(M4.translation(0, 0, -10), M4.scaling(2, 2, 2)));
  const hit = pickModel({ origin: [0, 0, 0], direction: [0, 0, -1] }, entity);

  assert.ok(hit, 'попадание есть');
  assert.equal(hit.entity, entity);
  // Локальный куб ±1 при масштабе 2 — это ±2 вокруг z=-10: вход на z=-8
  assert.ok(Math.abs(hit.t - 8) < 1e-6, `t=${hit.t}`);
  assert.ok(Math.abs(hit.point[2] + 8) < 1e-6);
});

test('pickModel: луч мимо модели и отключённая сущность', () => {
  const entity = model(M4.translation(10, 0, 0));
  assert.equal(pickModel({ origin: [0, 0, 0], direction: [0, 0, -1] }, entity), null);

  const hidden = { ...entity, visible: false };
  assert.equal(pickModel({ origin: [10, 0, -5], direction: [0, 0, 1] }, hidden), null);
});

test('pickClosest выбирает ближайшую модель', () => {
  const near = model(M4.translation(0, 0, -5));
  const far = model(M4.translation(0, 0, -20));
  const behind = model(M4.translation(0, 0, 5));

  const hit = pickClosest({ origin: [0, 0, 0], direction: [0, 0, -1] }, [far, behind, near]);
  assert.equal(hit.entity, near);
  assert.ok(hit.t < 5);
});

test('pickModel без bounds не участвует', () => {
  const entity = { model: {}, matrix: M4.identity(), visible: true };
  assert.equal(pickModel({ origin: [0, 0, -5], direction: [0, 0, 1] }, entity), null);
});
