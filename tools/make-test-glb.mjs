// Генерирует тестовую GLB-модель для проверки импорта в редакторе.
//   node tools/make-test-glb.mjs
// Результат: assets/import/sample-crate.glb — ящик с двумя материалами
// и вложенным узлом (проверяем запекание иерархии).

import fs from 'node:fs';
import path from 'node:path';

const OUT = 'assets/import/sample-crate.glb';

function box(size = [1, 1, 1], offset = [0, 0, 0]) {
  const [sx, sy, sz] = size.map((value) => value / 2);
  const [ox, oy, oz] = offset;

  const faces = [
    { n: [0, 0, 1], v: [[-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]] },
    { n: [0, 0, -1], v: [[sx, -sy, -sz], [-sx, -sy, -sz], [-sx, sy, -sz], [sx, sy, -sz]] },
    { n: [1, 0, 0], v: [[sx, -sy, sz], [sx, -sy, -sz], [sx, sy, -sz], [sx, sy, sz]] },
    { n: [-1, 0, 0], v: [[-sx, -sy, -sz], [-sx, -sy, sz], [-sx, sy, sz], [-sx, sy, -sz]] },
    { n: [0, 1, 0], v: [[-sx, sy, sz], [sx, sy, sz], [sx, sy, -sz], [-sx, sy, -sz]] },
    { n: [0, -1, 0], v: [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], [-sx, -sy, sz]] }
  ];

  const positions = [];
  const normals = [];
  const indices = [];

  faces.forEach((face, faceIndex) => {
    for (const vertex of face.v) {
      positions.push(vertex[0] + ox, vertex[1] + oy, vertex[2] + oz);
      normals.push(face.n[0], face.n[1], face.n[2]);
    }

    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });

  return { positions, normals, indices };
}

const binChunks = [];
let binOffset = 0;

function addBuffer(array, target) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const padding = (4 - (bytes.length % 4)) % 4;
  const start = binOffset;

  binChunks.push(bytes);
  if (padding) binChunks.push(Buffer.alloc(padding));
  binOffset += bytes.length + padding;

  bufferViews.push({ buffer: 0, byteOffset: start, byteLength: bytes.length, target });
  return bufferViews.length - 1;
}

const bufferViews = [];
const accessors = [];

function addAccessor(array, componentType, type, count, min, max) {
  const viewIndex = addBuffer(array, 34962);
  accessors.push({
    bufferView: viewIndex,
    componentType,
    count,
    type,
    ...(min ? { min } : {}),
    ...(max ? { max } : {})
  });
  return accessors.length - 1;
}

function addMesh(name, parts) {
  return {
    name,
    primitives: parts.map((part) => {
      const flat = part.geometry.positions;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];

      for (let i = 0; i < flat.length; i += 3) {
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], flat[i + axis]);
          max[axis] = Math.max(max[axis], flat[i + axis]);
        }
      }

      const position = addAccessor(
        new Float32Array(flat),
        5126, 'VEC3', flat.length / 3,
        min, max
      );

      const normal = addAccessor(
        new Float32Array(part.geometry.normals),
        5126, 'VEC3', part.geometry.positions.length / 3
      );

      const indices = new Uint16Array(part.geometry.indices);
      const index = addAccessor(indices, 5123, 'SCALAR', indices.length);

      return {
        attributes: { POSITION: position, NORMAL: normal },
        indices: index,
        material: part.material,
        mode: 4
      };
    })
  };
}

// Две геометрии: корпус и маленький блок сверху
const hull = box([2, 1.4, 2]);
const cap = box([0.8, 0.5, 0.8], [0, 1.0, 0]);

const meshes = [
  addMesh('Crate', [
    { geometry: hull, material: 0 },
    { geometry: cap, material: 1 }
  ])
];

const materials = [
  {
    name: 'Hull',
    pbrMetallicRoughness: {
      baseColorFactor: [0.42, 0.45, 0.5, 1],
      metallicFactor: 0.65,
      roughnessFactor: 0.45
    }
  },
  {
    name: 'Glow',
    pbrMetallicRoughness: {
      baseColorFactor: [0.15, 0.6, 0.8, 1],
      metallicFactor: 0.1,
      roughnessFactor: 0.3
    },
    emissiveFactor: [0.1, 0.55, 0.75]
  }
];

// Иерархия: корень со сдвигом, ребёнок с поворотом — проверим запекание
const half = Math.SQRT1_2;
const gltf = {
  asset: { version: '2.0', generator: 'GalaxyDemo test' },
  scene: 0,
  scenes: [{ name: 'SampleCrate', nodes: [0] }],
  nodes: [
    { name: 'root', translation: [0, 0.7, 0], children: [1] },
    { name: 'crate', mesh: 0, rotation: [0, half, 0, half] }
  ],
  meshes,
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength: binOffset }]
};

const bin = Buffer.concat(binChunks);
const jsonText = JSON.stringify(gltf);
const jsonPadded = jsonText + ' '.repeat((4 - (Buffer.byteLength(jsonText) % 4)) % 4);
const binPadded = bin.length % 4 === 0 ? bin : Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);

const jsonBytes = Buffer.from(jsonPadded, 'utf8');
const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBytes.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);

const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binPadded.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([header, jsonHeader, jsonBytes, binHeader, binPadded]));
console.log(`Готово: ${OUT} (${total} байт, узлов ${gltf.nodes.length}, мешей ${meshes.length})`);
