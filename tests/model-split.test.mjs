import test from 'node:test';
import assert from 'node:assert/strict';

import { baseNameOf, extractModel, listObjects, partHidden } from '../public/js/model-split.js';
import { normalizeScene } from '../public/js/scene.js';

/** Собрать тестовую модель: манифест + бинарник из групп. */
function makeAsset(parts) {
  const chunks = [];
  let offset = 0;

  const push = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes);
    const padding = (4 - (bytes.byteLength % 4)) % 4;
    if (padding) chunks.push(new Uint8Array(padding));
    const at = offset;
    offset += bytes.byteLength + padding;
    return at;
  };

  const groups = parts.map((part) => {
    const positions = new Float32Array(part.positions.flat());
    const normals = new Float32Array(part.normals.flat());
    const uvs = new Float32Array(part.uvs.flat());
    const indices = new Uint16Array(part.indices);

    return {
      name: part.name,
      texture: part.texture ?? null,
      color: '#99a1b3',
      metal: 0.2,
      specular: 0.7,
      vertexCount: positions.length / 3,
      indexCount: indices.length,
      positionByteOffset: push(positions),
      normalByteOffset: push(normals),
      uvByteOffset: push(uvs),
      indexByteOffset: push(indices)
    };
  });

  const bin = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bin.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  return {
    manifest: {
      name: 'test-ship',
      length: 10,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      radius: 3,
      bytes: bin.byteLength,
      textureColor: true,
      textureMaps: ['base'],
      groups
    },
    bin
  };
}

const TRI_A = {
  name: 'Cockpit_Mesh',
  positions: [[0, 0, 0], [2, 0, 0], [0, 2, 0]],
  normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
  uvs: [[0, 0], [1, 0], [0, 1]],
  indices: [0, 1, 2]
};

const TRI_B = {
  name: 'Engine_Mesh 3',
  positions: [[0, 0, 10], [4, 0, 10], [0, 4, 10]],
  normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
  uvs: [[0, 0], [1, 0], [0, 1]],
  indices: [0, 1, 2]
};

test('имена объектов: суффикс материала отбрасывается', () => {
  assert.equal(baseNameOf('Cockpit_Mesh 9'), 'Cockpit_Mesh');
  assert.equal(baseNameOf('Cargo_Container_Left_Mesh 7'), 'Cargo_Container_Left_Mesh');
  assert.equal(baseNameOf('Куб.007 24'), 'Куб.007');
  assert.equal(baseNameOf('без-суффикса'), 'без-суффикса');
});

test('listObjects группирует группы по объектам', () => {
  const { manifest } = makeAsset([
    { ...TRI_A, name: 'Cockpit_Mesh' },
    { ...TRI_A, name: 'Cockpit_Mesh 1' },
    TRI_B
  ]);

  const objects = listObjects(manifest);
  assert.equal(objects.length, 2);
  assert.deepEqual(objects[0].indices, [0, 1]);
  assert.equal(objects[0].triangles, 2);
  assert.equal(objects[0].vertices, 6);
  assert.equal(objects[1].name, 'Engine_Mesh');
  assert.deepEqual(objects[1].indices, [2]);
});

test('extractModel: выбранная группа копируется без искажений', () => {
  const { manifest, bin } = makeAsset([TRI_A, TRI_B]);

  const result = extractModel(manifest, bin, { id: 'engine', indices: [1], recenter: false });

  assert.equal(result.manifest.groups.length, 1);
  assert.equal(result.manifest.groups[0].name, 'Engine_Mesh 3');
  assert.equal(result.manifest.groups[0].vertexCount, 3);
  assert.equal(result.manifest.groups[0].indexCount, 3);
  assert.equal(result.manifest.name, 'engine');

  const group = result.manifest.groups[0];
  const positions = new Float32Array(result.bin.buffer, group.positionByteOffset, 9);
  assert.deepEqual([...positions].map((v) => Math.round(v * 1000) / 1000), [0, 0, 10, 4, 0, 10, 0, 4, 10]);

  const indices = new Uint16Array(result.bin.buffer, group.indexByteOffset, 3);
  assert.deepEqual([...indices], [0, 1, 2]);

  assert.ok(group.positionByteOffset % 4 === 0);
  assert.ok(group.normalByteOffset % 4 === 0);
  assert.ok(group.uvByteOffset % 4 === 0);
  assert.ok(group.indexByteOffset % 4 === 0);
  assert.ok(group.indexByteOffset + group.indexCount * 2 <= result.bin.length);
  assert.equal(result.manifest.bytes, result.bin.length);

  assert.deepEqual(result.manifest.bounds.min, [0, 0, 10]);
  assert.deepEqual(result.manifest.bounds.max, [4, 4, 10]);
  assert.equal(result.manifest.textureColor, true);
});

test('extractModel: центрирование переносит габариты в ноль', () => {
  const { manifest, bin } = makeAsset([TRI_A, TRI_B]);
  const result = extractModel(manifest, bin, { id: 'all', recenter: true });

  const { min, max } = result.manifest.bounds;
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(min[axis] + max[axis]) < 1e-3, `ось ${axis}: ${min[axis]}…${max[axis]}`);
  }

  assert.equal(result.manifest.groups.length, 2);
  assert.equal(result.stats.triangles, 2);
  assert.equal(result.stats.vertices, 6);
});

test('extractModel: масштаб до нужной длины', () => {
  const { manifest, bin } = makeAsset([TRI_A, TRI_B]);
  const result = extractModel(manifest, bin, { id: 'small', recenter: true, scaleToLength: 2 });

  assert.ok(Math.abs(result.manifest.length - 2) < 1e-3, `длина ${result.manifest.length}`);

  const { min, max } = result.manifest.bounds;
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  assert.ok(Math.abs(size - 2) < 1e-3);
});

test('extractModel: ошибки ввода', () => {
  const { manifest, bin } = makeAsset([TRI_A]);

  assert.throws(() => extractModel(manifest, bin, { id: 'плохой id' }), /id модели/);
  assert.throws(() => extractModel(manifest, bin, { id: 'ok', indices: [5] }), /вне диапазона/);
  assert.throws(() => extractModel({ groups: [] }, bin, { id: 'ok' }), /нет групп/);
});

test('пустая выборка не превращается в пустой ассет', () => {
  const { manifest, bin } = makeAsset([TRI_A]);
  const result = extractModel(manifest, bin, { id: 'all', indices: [] });
  assert.equal(result.manifest.groups.length, 1, 'пустой список = все группы');
});

test('partHidden понимает и группу, и имя объекта', () => {
  assert.equal(partHidden(['Cockpit_Mesh'], 'Cockpit_Mesh 9'), true);
  assert.equal(partHidden(['Cockpit_Mesh 9'], 'Cockpit_Mesh 9'), true);
  assert.equal(partHidden(['Cockpit_Mesh'], 'Engine_Mesh'), false);
  assert.equal(partHidden([], 'Cockpit_Mesh'), false);
  assert.equal(partHidden(null, 'Cockpit_Mesh'), false);
});

test('сцена сохраняет hiddenParts и чистит мусор', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'parts-test',
    entities: [
      {
        id: 'scene',
        type: 'scene',
        children: [
          {
            id: 'hull',
            type: 'model',
            asset: 'corinth',
            hiddenParts: ['Cockpit_Mesh', 42, '', null, 'Engine_Mesh']
          }
        ]
      }
    ]
  });

  assert.deepEqual(scene.entities[0].hiddenParts, ['Cockpit_Mesh', 'Engine_Mesh']);
});
