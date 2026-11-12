// Проверка импорта текстур: собираем крошечный GLB с PNG внутри
// и прогоняем его через parseGlb + packAsset.
import { parseGlb, packAsset } from '../public/js/glb.js';
import assert from 'node:assert/strict';

function chunk(type, bytes) {
  const padding = (4 - (bytes.length % 4)) % 4;
  const body = new Uint8Array(bytes.length + padding);
  body.set(bytes);

  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length, true);
  view.setUint32(4, type, true);
  out.set(body, 8);
  return out;
}

// 1x1 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
const indices = new Uint16Array([0, 1, 2]);

const binParts = [positions, uvs, indices, new Uint8Array(png)];
let offset = 0;
const offsets = binParts.map((part) => {
  const at = offset;
  offset += part.byteLength;
  const padding = (4 - (offset % 4)) % 4;
  offset += padding;
  return at;
});

const bin = new Uint8Array(offset);
let cursor = 0;
for (const part of binParts) {
  bin.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), cursor);
  cursor += part.byteLength + ((4 - (cursor + part.byteLength) % 4) % 4);
}

const gltf = {
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  scene: 0,
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, indices: 2, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
  textures: [{ source: 0 }],
  images: [{ bufferView: 4, mimeType: 'image/png' }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' }
  ],
  bufferViews: [
    { buffer: 0, byteOffset: offsets[0], byteLength: positions.byteLength },
    { buffer: 0, byteOffset: offsets[1], byteLength: uvs.byteLength },
    { buffer: 0, byteOffset: offsets[2], byteLength: indices.byteLength },
    { buffer: 0, byteOffset: offsets[3], byteLength: png.length }
  ],
  buffers: [{ byteLength: bin.byteLength }]
};

// bufferView 4 в списке выше — индекс 3; поправим ссылку
gltf.images[0].bufferView = 3;

const json = new TextEncoder().encode(JSON.stringify(gltf));
const jsonChunk = chunk(0x4e4f534a, json);
const binChunk = chunk(0x004e4942, bin);
const header = new Uint8Array(12);
new DataView(header.buffer).setUint32(0, 0x46546c67, true);
new DataView(header.buffer).setUint32(4, 2, true);
new DataView(header.buffer).setUint32(8, header.length + jsonChunk.length + binChunk.length, true);

const glb = new Uint8Array(header.length + jsonChunk.length + binChunk.length);
glb.set(header, 0);
glb.set(jsonChunk, header.length);
glb.set(binChunk, header.length + jsonChunk.length);

const parsed = parseGlb(glb.buffer);
assert.equal(parsed.textures.length, 1, 'текстура должна извлекаться');
assert.equal(parsed.textures[0].mime, 'image/png');
assert.ok(parsed.textures[0].bytes.length > 50, 'байты картинки не пустые');

const { manifest, textures } = packAsset(parsed, { name: 'test-ship', textureName: 'test-ship' });
assert.equal(manifest.groups[0].texture, 'test-ship');
assert.equal(textures.length, 1);
assert.equal(textures[0].name, 'test-ship');
assert.ok(textures[0].bytes.length > 50);

console.log('ok: текстура из GLB доходит до манифеста и набора текстур');
