import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGlb, packAsset } from '../public/js/glb.js';

const GLB_MAGIC = 0x46546c67;

function buildGlb(gltf, bin) {
  const jsonText = JSON.stringify(gltf);
  const jsonPadded = jsonText + ' '.repeat((4 - (Buffer.byteLength(jsonText) % 4)) % 4);
  const jsonBytes = Buffer.from(jsonPadded, 'utf8');
  const padded = bin.length % 4 === 0 ? bin : Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);

  const total = 12 + 8 + jsonBytes.length + 8 + padded.length;
  const out = Buffer.alloc(total);

  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);

  out.writeUInt32LE(jsonBytes.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(out, 20);

  const binStart = 20 + jsonBytes.length;
  out.writeUInt32LE(padded.length, binStart);
  out.writeUInt32LE(0x004e4942, binStart + 4);
  padded.copy(out, binStart + 8);

  return out;
}

function triangleGlb() {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0
  ]);
  const normals = new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1
  ]);
  const indices = new Uint16Array([0, 1, 2]);

  const bin = Buffer.concat([
    Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength),
    Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength)
  ]);

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'root', translation: [0, 1, 0], mesh: 0 }],
    meshes: [{
      name: 'Tri',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0
      }]
    }],
    materials: [{
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
        metallicFactor: 0.5,
        roughnessFactor: 0.5
      }
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: indices.byteLength }
    ],
    buffers: [{ byteLength: bin.length }]
  };

  return buildGlb(gltf, bin);
}

test('parseGlb запекает трансформ узла в вершины', () => {
  const parsed = parseGlb(triangleGlb());

  assert.equal(parsed.parts.length, 1);
  const positions = parsed.parts[0].positions;

  // Узел сдвинут на +1 по Y — это должно быть в координатах вершин
  assert.deepEqual([...positions.slice(0, 6)], [0, 1, 0, 1, 1, 0]);
  assert.equal(parsed.parts[0].indices.length, 3);
});

test('parseGlb переносит материал в наши поля', () => {
  const parsed = parseGlb(triangleGlb());
  const part = parsed.parts[0];

  assert.deepEqual(part.color, [1, 0, 0]);
  assert.equal(part.metal, 0.5);
  assert.ok(part.specular > 0);
});

test('packAsset даёт манифест, совместимый с loadBinaryModel', () => {
  const parsed = parseGlb(triangleGlb());
  const { manifest, bin } = packAsset(parsed, { name: 'Test' });

  assert.equal(manifest.groups.length, 1);
  const group = manifest.groups[0];

  assert.equal(group.vertexCount, 3);
  assert.equal(group.indexCount, 3);
  assert.match(group.color, /^#[0-9a-f]{6}$/);

  // Импорт берёт цвет из текстуры и не просит отсутствующие rough/metal
  assert.equal(manifest.textureColor, true);
  assert.deepEqual(manifest.textureMaps, ['base']);

  // Все секции выровнены по 4 байта — иначе Float32Array(buffer, offset) упадёт
  for (const key of ['positionByteOffset', 'normalByteOffset', 'uvByteOffset', 'indexByteOffset']) {
    assert.equal(group[key] % 4, 0, `${key} не выровнен`);
  }

  const positions = new Float32Array(bin.buffer, bin.byteOffset + group.positionByteOffset, group.vertexCount * 3);
  assert.deepEqual([...positions.slice(0, 3)], [0, 1, 0]);

  const indices = new Uint16Array(bin.buffer, bin.byteOffset + group.indexByteOffset, group.indexCount);
  assert.deepEqual([...indices], [0, 1, 2]);
});

test('parseGlb отвергает не-GLB', () => {
  const garbage = new Uint8Array(16);
  assert.throws(() => parseGlb(garbage.buffer), /не GLB/);
});
