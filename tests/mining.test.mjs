import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMeshHitTest,
  cursorRayDirection,
  nearestRockHit,
  raySphere,
  rayTriangles
} from '../public/js/mining.js';
import { M4 } from '../public/js/math.js';

const rock = { pos: [0, 0, -20], radius: 4 };
const start = [0, -2, 0];
const rayOrigin = [0, 0, 0];
const rayDirection = [0, 0, -1];

test('raySphere: попадание в ближнюю поверхность', () => {
  const distance = raySphere([0, 0, 0], [0, 0, -1], [0, 0, -20], 4);
  assert.equal(distance, 16);
});

test('raySphere: промах даёт null', () => {
  assert.equal(raySphere([0, 0, 0], [0, 0, -1], [10, 0, -20], 4), null);
});

test('raySphere: луч позади сферы не считается попаданием', () => {
  assert.equal(raySphere([0, 0, 0], [0, 0, 1], [0, 0, -20], 4), null);
});

test('nearestRockHit: выбирает ближайший камень', () => {
  const near = { pos: [0, 0, -12], radius: 3 };
  const far = { pos: [0, 0, -40], radius: 5 };
  const hit = nearestRockHit(rayOrigin, rayDirection, [far, near]);

  assert.equal(hit.rock, near);
  assert.equal(hit.distance, 9);
  assert.deepEqual(hit.point, [0, 0, -9]);
});

test('rayTriangles: попадание в треугольник', () => {
  const triangle = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ]);

  assert.equal(rayTriangles([0.2, 0.2, 2], [0, 0, -1], triangle), 2);
  assert.equal(rayTriangles([0.9, 0.9, 2], [0, 0, -1], triangle), null);
  assert.equal(rayTriangles([0.2, 0.2, -2], [0, 0, -1], triangle), null);
});

test('createMeshHitTest: учитывает поворот, масштаб и позицию камня', () => {
  const triangle = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ]);
  const rock = { pos: [5, 0, 0], angle: Math.PI / 2, scale: 2 };
  const hitTest = createMeshHitTest(rock, triangle);

  // Камень повёрнут на 90° и увеличен вдвое: плоскость треугольника
  // становится плоскостью x = 5. Луч летит по -X и входит в него в точке
  // (5, 0.4, -1) — это t = 7 от начала [12, 0.4, -1].
  const t = hitTest([12, 0.4, -1], [-1, 0, 0]);
  assert.ok(Math.abs(t - 7) < 1e-6, `t = ${t}`);

  assert.equal(hitTest([12, 3, -1], [-1, 0, 0]), null);
});

test('nearestRockHit: использует точный hitTest камня, если он есть', () => {
  const rock = { pos: [0, 0, -20], radius: 4, hitTest: () => 7 };
  const hit = nearestRockHit([0, 0, 0], [0, 0, -1], [rock]);

  assert.equal(hit.distance, 7);
  assert.deepEqual(hit.point, [0, 0, -7]);
});

test('cursorRayDirection: луч проходит ровно через точку курсора', () => {
  const fov = (50 * Math.PI) / 180;
  const aspect = 16 / 9;
  const eye = [0, 7, 16];
  const view = M4.lookAt(eye, [0, 0, -10], [0, 1, 0]);
  const proj = M4.perspective(fov, aspect, 0.1, 4000);
  const viewProj = M4.mul(proj, view);

  // Как в main.js: cursor.y растёт вниз, поэтому в NDC передаём -cursor.y.
  const cursor = [0.45, 0.3];
  const ndc = [cursor[0], -cursor[1]];
  const dir = cursorRayDirection(view, ndc[0], ndc[1], aspect, fov);
  const point = [
    eye[0] + dir[0] * 40,
    eye[1] + dir[1] * 40,
    eye[2] + dir[2] * 40
  ];

  const x = viewProj[0] * point[0] + viewProj[4] * point[1] + viewProj[8] * point[2] + viewProj[12];
  const y = viewProj[1] * point[0] + viewProj[5] * point[1] + viewProj[9] * point[2] + viewProj[13];
  const w = viewProj[3] * point[0] + viewProj[7] * point[1] + viewProj[11] * point[2] + viewProj[15];

  assert.ok(Math.abs(x / w - ndc[0]) < 1e-6, `ndc x = ${x / w}`);
  assert.ok(Math.abs(y / w - ndc[1]) < 1e-6, `ndc y = ${y / w}`);
});
