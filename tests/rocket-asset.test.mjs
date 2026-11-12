import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MODEL = JSON.parse(fs.readFileSync('public/models/rocket.json', 'utf8'));
const BIN = fs.readFileSync('public/models/rocket.mesh.bin');
const BYTES = BIN.buffer.slice(BIN.byteOffset, BIN.byteOffset + BIN.byteLength);
const PHYSICS = JSON.parse(fs.readFileSync('public/models/rocket.physics.json', 'utf8'));
const PREFAB = JSON.parse(fs.readFileSync('public/prefabs/rocket.json', 'utf8'));

test('ассет ракеты: группы лежат внутри .mesh.bin и индексы валидны', () => {
  assert.ok(MODEL.groups.length >= 4);
  assert.equal(BIN.length % 4, 0);

  for (const group of MODEL.groups) {
    assert.ok(group.vertexCount > 0, group.name);
    assert.ok(group.indexCount > 0 && group.indexCount % 3 === 0, group.name);

    assert.equal(group.positionByteOffset % 4, 0, group.name);
    assert.equal(group.normalByteOffset % 4, 0, group.name);
    assert.equal(group.uvByteOffset % 4, 0, group.name);
    assert.equal(group.indexByteOffset % 4, 0, group.name);

    assert.ok(group.positionByteOffset + group.vertexCount * 12 <= BIN.length, group.name);
    assert.ok(group.normalByteOffset + group.vertexCount * 12 <= BIN.length, group.name);
    assert.ok(group.uvByteOffset + group.vertexCount * 8 <= BIN.length, group.name);
    assert.ok(group.indexByteOffset + group.indexCount * 2 <= BIN.length, group.name);

    const indices = new Uint16Array(BYTES, group.indexByteOffset, group.indexCount);
    for (const index of indices) {
      assert.ok(index < group.vertexCount, `${group.name}: индекс ${index} вне группы`);
    }
  }
});

test('ассет ракеты: габариты и радиус сходятся с вершинами', () => {
  const points = [];

  for (const group of MODEL.groups) {
    const positions = new Float32Array(BYTES, group.positionByteOffset, group.vertexCount * 3);
    for (let i = 0; i < positions.length; i += 3) points.push([positions[i], positions[i + 1], positions[i + 2]]);
  }

  for (let axis = 0; axis < 3; axis++) {
    const values = points.map((point) => point[axis]);
    assert.ok(Math.abs(Math.min(...values) - MODEL.bounds.min[axis]) < 1e-3, `min[${axis}]`);
    assert.ok(Math.abs(Math.max(...values) - MODEL.bounds.max[axis]) < 1e-3, `max[${axis}]`);
  }

  const radius = Math.max(...points.map((point) => Math.hypot(point[0], point[1], point[2])));
  assert.ok(Math.abs(radius - MODEL.radius) < 1e-2, `радиус ${radius} против ${MODEL.radius}`);
});

test('коллайдер ракеты: боксы положительные и не выходят за габариты', () => {
  assert.equal(PHYSICS.collider.shape, 'compound');
  assert.ok(PHYSICS.collider.boxes.length > 0);

  for (const box of PHYSICS.collider.boxes) {
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(box.halfExtents[axis] > 0);
      assert.ok(box.offset[axis] - box.halfExtents[axis] >= MODEL.bounds.min[axis] - 0.02);
      assert.ok(box.offset[axis] + box.halfExtents[axis] <= MODEL.bounds.max[axis] + 0.02);
    }
  }
});

test('префаб ракеты ссылается на меш и несёт тот же коллайдер', () => {
  const [root] = PREFAB.entities;
  assert.equal(PREFAB.id, 'rocket');
  assert.equal(root.type, 'empty');
  assert.equal(root.body.collider.shape, 'compound');
  assert.equal(root.body.collider.boxes.length, PHYSICS.collider.boxes.length);

  const mesh = root.children.find((child) => child.type === 'model');
  assert.ok(mesh);
  assert.equal(mesh.asset, 'rocket');
});
