import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bestGreedyCover,
  boxCorners,
  buildBoxCollider,
  buildCompoundCollider,
  buildSphereCollider,
  coverSolid,
  meshBounds,
  pickPart,
  raycastMesh,
  simplifyBoxes,
  voxelize
} from '../public/js/editor/collider-fit.js';
import { sphereGeometry } from '../public/js/geometry.js';
import { sealGapVoxels } from '../public/js/editor/collider/voxelizer.js';

/** Двенадцать треугольников прямоугольного параллелепипеда. */
function boxMesh(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;

  const corners = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];

  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7]
  ];

  const triangles = [];
  for (const face of faces) {
    for (const index of face) triangles.push(...corners[index]);
  }

  return triangles;
}

test('габариты плоского списка треугольников', () => {
  const bounds = meshBounds(boxMesh([-2, 0, -3], [4, 6, 5]));
  assert.deepEqual(bounds.min, [-2, 0, -3]);
  assert.deepEqual(bounds.max, [4, 6, 5]);
  assert.deepEqual(bounds.size, [6, 6, 8]);
  assert.deepEqual(bounds.center, [1, 3, 1]);
  assert.equal(meshBounds([]), null);
});

test('куб раскладывается на бокс, который не выходит за габариты', () => {
  const min = [-5, -5, -5];
  const max = [5, 5, 5];
  const result = buildBoxCollider(boxMesh(min, max), { detail: 8, maxBoxes: 8, margin: 0 });

  assert.equal(result.boxes.length, 1);
  assert.deepEqual(result.stats.grid.length, 3);

  const box = result.boxes[0];
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(box.offset[axis] - box.halfExtents[axis] >= min[axis] - 1e-6);
    assert.ok(box.offset[axis] + box.halfExtents[axis] <= max[axis] + 1e-6);
  }

  assert.ok(result.stats.fill > 0.8, `заполнение ${result.stats.fill}`);
});

test('замкнутый куб не протекает на высокой детализации', () => {
  const result = buildBoxCollider(boxMesh([-5, -5, -5], [5, 5, 5]), { detail: 32, maxBoxes: 4, margin: 0 });
  assert.equal(result.boxes.length, 1);

  const volume = result.boxes[0].halfExtents.reduce((product, half) => product * half * 2, 1);
  assert.ok(volume > 900, `объём коллайдера ${volume.toFixed(0)} м³ вместо ~1000`);
});

test('тонкая плита не теряется при разбиении', () => {
  const result = buildBoxCollider(boxMesh([-5, -0.2, -5], [5, 0.2, 5]), { detail: 12, maxBoxes: 8, margin: 0 });

  assert.ok(result.boxes.length >= 1);
  const totalHalfY = result.boxes.reduce((max, box) => Math.max(max, box.halfExtents[1]), 0);
  assert.ok(totalHalfY > 0.1, `полуразмер по Y ${totalHalfY}`);
});

test('число боксов не превышает лимит', () => {
  const result = buildBoxCollider(boxMesh([-5, -5, -5], [5, 5, 5]), { detail: 24, maxBoxes: 1, margin: 0 });
  assert.equal(result.boxes.length, 1);
});

test('раздельные детали не соединяются боксом через пустоту', () => {
  const mesh = [
    ...boxMesh([-3, -1, -1], [-1, 1, 1]),
    ...boxMesh([1, -1, -1], [3, 1, 1])
  ];

  const result = buildBoxCollider(mesh, { detail: 8, maxBoxes: 8, margin: 0 });
  assert.ok(result.boxes.length >= 2);

  const left = result.boxes.some((box) => box.offset[0] < 0);
  const right = result.boxes.some((box) => box.offset[0] > 0);
  assert.ok(left && right, 'боксы должны покрывать обе детали');

  for (const box of result.boxes) {
    const crossesGap = box.offset[0] - box.halfExtents[0] < -1e-6
      && box.offset[0] + box.halfExtents[0] > 1e-6;
    assert.ok(!crossesGap, `бокс перекрыл зазор: ${JSON.stringify(box)}`);
  }
});

test('без треугольников коллайдер пустой', () => {
  const result = buildBoxCollider([], { detail: 16, maxBoxes: 32 });
  assert.deepEqual(result.boxes, []);
  assert.equal(result.stats.boxes, 0);
});

test('simplifyBoxes сливает выровненные соседние боксы', () => {
  const boxes = [
    { offset: [-1.5, 0, 0], halfExtents: [0.5, 1, 1] },
    { offset: [-0.5, 0, 0], halfExtents: [0.5, 1, 1] },
    { offset: [0.5, 0, 0], halfExtents: [0.5, 1, 1] },
    { offset: [1.5, 0, 0], halfExtents: [0.5, 1, 1] }
  ];

  const merged = simplifyBoxes(boxes, 2);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].offset, [0, 0, 0]);
  assert.deepEqual(merged[0].halfExtents, [2, 1, 1]);
});

test('луч попадает в меш и в ближайшую часть коллайдера', () => {
  const mesh = boxMesh([-1, -1, -1], [1, 1, 1]);
  const hit = raycastMesh([-5, 0, 0], [1, 0, 0], mesh);
  assert.ok(hit != null);
  assert.ok(Math.abs(hit - 4) < 1e-6);

  assert.equal(raycastMesh([-5, 3, 0], [1, 0, 0], mesh), null);

  const parts = [
    { kind: 'box', offset: [0, 0, 0], halfExtents: [1, 1, 1] },
    { kind: 'sphere', offset: [4, 0, 0], radius: 1 }
  ];

  assert.equal(pickPart([-5, 0, 0], [1, 0, 0], parts), 0);
  assert.equal(pickPart([-5, 0, 0], [1, 0, 0], [parts[1]]), 0);
});

test('углы бокса строятся вокруг центра', () => {
  const corners = boxCorners({ offset: [1, 2, 3], halfExtents: [1, 1, 1] });
  assert.equal(corners.length, 8);
  assert.deepEqual(corners[0], [0, 1, 2]);
  assert.deepEqual(corners[7], [2, 3, 4]);
});

function triangleSoup(geometry) {
  return Array.from(geometry.positions);
}

function voxelGrid(dims, fill) {
  const [nx, ny, nz] = dims;
  const solid = new Uint8Array(nx * ny * nz);
  fill((x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    solid[x + nx * (y + ny * z)] = 1;
  });
  return { solid, dims, origin: [0, 0, 0], cell: 1, solidCount: solid.reduce((sum, value) => sum + value, 0) };
}

test('bestGreedyCover перебирает оси и не проигрывает фиксированному порядку', () => {
  const grid = voxelGrid([8, 8, 24], (set) => {
    for (let z = 2; z < 21; z++) {
      for (let x = 3; x < 5; x++) {
        for (let y = 3; y < 5; y++) set(x, y, z);
      }
    }
    for (let z = 18; z < 21; z++) {
      for (let x = 1; x < 7; x++) {
        for (let y = 3; y < 5; y++) set(x, y, z);
      }
    }
  });

  const fixed = coverSolid(grid, [0, 1, 2]);
  const best = bestGreedyCover(grid);
  assert.ok(best.boxes.length <= fixed.length, `${best.boxes.length} > ${fixed.length}`);
});

test('закрытый куб: sealGaps не добавляет лишних вокселей', () => {
  const mesh = boxMesh([-5, -5, -5], [5, 5, 5]);
  const bounds = meshBounds(mesh);
  const open = voxelize(mesh, bounds, 0.5, { sealGaps: false });
  const sealed = voxelize(mesh, bounds, 0.5, { sealGaps: true });
  assert.equal(open.solidCount, sealed.solidCount);
  assert.equal(sealed.sealedCount, 0);
});

test('sealGapVoxels закрывает замкнутую полость и не трогает открытый коридор', () => {
  const dims = [9, 9, 9];
  const [nx, ny, nz] = dims;
  const index = (x, y, z) => x + nx * (y + ny * z);

  const closedSurface = new Uint8Array(nx * ny * nz);
  for (let z = 1; z < nz - 1; z++) {
    for (let y = 1; y < ny - 1; y++) {
      for (let x = 1; x < nx - 1; x++) {
        if (x === 1 || y === 1 || z === 1 || x === 7 || y === 7 || z === 7) {
          closedSurface[index(x, y, z)] = 1;
        }
      }
    }
  }

  const closedOutside = new Uint8Array(nx * ny * nz).fill(1);
  const sealed = sealGapVoxels(closedSurface, closedOutside, dims, 3);
  assert.ok(sealed > 0);
  assert.equal(closedOutside[index(4, 4, 4)], 0);

  const openSurface = new Uint8Array(nx * ny * nz);
  for (let x = 1; x < 8; x++) {
    for (let z = 1; z < 8; z++) {
      openSurface[index(x, 1, z)] = 1;
      openSurface[index(x, 7, z)] = 1;
    }
  }

  const openOutside = new Uint8Array(nx * ny * nz).fill(1);
  sealGapVoxels(openSurface, openOutside, dims, 3);
  assert.equal(openOutside[index(4, 4, 4)], 1);
});

test('buildSphereCollider: сферы не выходят за габариты и уважают лимит', () => {
  const meshes = [
    boxMesh([-5, -5, -5], [5, 5, 5]),
    triangleSoup(sphereGeometry(4, 4, 4, 20, 14))
  ];

  for (const mesh of meshes) {
    const bounds = meshBounds(mesh);
    const result = buildSphereCollider(mesh, { detail: 24, maxSpheres: 8, margin: 0.2 });

    assert.ok(result.spheres.length > 0 && result.spheres.length <= 8);
    for (const sphere of result.spheres) {
      assert.ok(sphere.radius > 0);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(sphere.offset[axis] - sphere.radius >= bounds.min[axis] - 0.02);
        assert.ok(sphere.offset[axis] + sphere.radius <= bounds.max[axis] + 0.02);
      }
    }
  }
});

test('buildCompoundCollider: hybrid не превышает maxParts', () => {
  const cube = boxMesh([-5, -5, -5], [5, 5, 5]);
  const result = buildCompoundCollider(cube, { mode: 'hybrid', maxParts: 6, detail: 20, margin: 0.2 });

  assert.equal(result.stats.mode, 'hybrid');
  assert.ok(result.boxes.length + result.spheres.length <= 6);
  assert.equal(result.stats.parts, result.boxes.length + result.spheres.length);
});

test('buildCompoundCollider: режимы boxes и spheres совместимы по контракту', () => {
  const cube = boxMesh([-5, -5, -5], [5, 5, 5]);
  const boxes = buildCompoundCollider(cube, { mode: 'boxes', maxParts: 4, detail: 20 });
  const spheres = buildCompoundCollider(cube, { mode: 'spheres', maxParts: 4, detail: 20 });

  assert.ok(boxes.boxes.length > 0);
  assert.equal(boxes.spheres.length, 0);
  assert.ok(spheres.spheres.length > 0);
  assert.equal(spheres.boxes.length, 0);
});
