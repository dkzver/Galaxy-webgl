// Сборка ассета ракеты из процедурных примитивов.
// Повторяет модель, которая раньше собиралась в main.js (createRocketModel):
// корпус-цилиндр, клиновидный нос, три стабилизатора и сопло.
//
// Запуск: node tools/build-rocket.mjs
// Пишет public/models/rocket.json, rocket.mesh.bin и rocket.physics.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { M4 } from '../public/js/math.js';
import { boxGeometry, cylinderGeometry, wedgeGeometry } from '../public/js/geometry.js';
import { buildBoxCollider } from '../public/js/editor/collider-fit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'public', 'models');
const ID = 'rocket';

function align4(buffer) {
  const rest = buffer.length % 4;
  return rest ? Buffer.concat([buffer, Buffer.alloc(4 - rest)]) : buffer;
}

function transformGeometry(geometry, matrix) {
  const positions = new Float32Array(geometry.positions.length);
  const normals = new Float32Array(geometry.normals.length);

  for (let i = 0; i < geometry.positions.length; i += 3) {
    const point = M4.transformPoint(matrix, [
      geometry.positions[i], geometry.positions[i + 1], geometry.positions[i + 2]
    ]);
    positions[i] = point[0];
    positions[i + 1] = point[1];
    positions[i + 2] = point[2];

    const nx = geometry.normals[i], ny = geometry.normals[i + 1], nz = geometry.normals[i + 2];
    const tx = matrix[0] * nx + matrix[4] * ny + matrix[8] * nz;
    const ty = matrix[1] * nx + matrix[5] * ny + matrix[9] * nz;
    const tz = matrix[2] * nx + matrix[6] * ny + matrix[10] * nz;
    const length = Math.hypot(tx, ty, tz) || 1;
    normals[i] = tx / length;
    normals[i + 1] = ty / length;
    normals[i + 2] = tz / length;
  }

  return { positions, normals };
}

const finMatrices = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((angle) => M4.mul(
  M4.translation(0, 0, 1.0),
  M4.mul(M4.rotZ(angle), M4.translation(0, 0.44, 0))
));

const finGeometry = finMatrices.reduce((merged, matrix) => {
  const fin = transformGeometry(boxGeometry([0.06, 0.8, 0.55]), matrix);
  return {
    positions: [...merged.positions, ...fin.positions],
    normals: [...merged.normals, ...fin.normals]
  };
}, { positions: [], normals: [] });

const parts = [
  {
    name: 'rocket-body',
    geometry: transformGeometry(cylinderGeometry(0.28, 2.2, 14), M4.identity()),
    color: '#949aa3',
    metal: 0.7,
    specular: 1.1
  },
  {
    name: 'rocket-nose',
    geometry: transformGeometry(wedgeGeometry([0.56, 0.56, 0.9], 0.14), M4.translation(0, 0, -1.42)),
    color: '#cc3d29',
    metal: 0.4,
    specular: 1.2
  },
  {
    name: 'rocket-fins',
    geometry: finGeometry,
    color: '#4d525c',
    metal: 0.8,
    specular: 0.8
  },
  {
    name: 'rocket-nozzle',
    geometry: transformGeometry(cylinderGeometry(0.17, 0.32, 12), M4.translation(0, 0, 1.15)),
    color: '#292b30',
    metal: 0.9,
    specular: 0.6
  }
];

const chunks = [];
const groups = [];
const allPositions = [];
let byteOffset = 0;

for (const part of parts) {
  const positions = new Float32Array(part.geometry.positions);
  const normals = new Float32Array(part.geometry.normals);
  const vertexCount = positions.length / 3;
  const indices = new Uint16Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;
  const uvs = new Float32Array(vertexCount * 2);

  const posBytes = align4(Buffer.from(positions.buffer.slice(0)));
  const nrmBytes = align4(Buffer.from(normals.buffer.slice(0)));
  const uvBytes = align4(Buffer.from(uvs.buffer.slice(0)));
  const idxBytes = align4(Buffer.from(indices.buffer.slice(0)));

  const group = {
    name: part.name,
    texture: null,
    color: part.color,
    metal: part.metal,
    specular: part.specular,
    vertexCount,
    indexCount: indices.length,
    positionByteOffset: byteOffset,
    normalByteOffset: byteOffset + posBytes.length,
    uvByteOffset: byteOffset + posBytes.length + nrmBytes.length,
    indexByteOffset: byteOffset + posBytes.length + nrmBytes.length + uvBytes.length
  };

  for (let i = 0; i < positions.length; i += 3) allPositions.push(positions[i], positions[i + 1], positions[i + 2]);

  chunks.push(posBytes, nrmBytes, uvBytes, idxBytes);
  groups.push(group);
  byteOffset += posBytes.length + nrmBytes.length + uvBytes.length + idxBytes.length;
}

const bin = Buffer.concat(chunks);
const bounds = {
  min: [0, 1, 2].map((axis) => +Math.min(...allPositions.filter((_, index) => index % 3 === axis)).toFixed(4)),
  max: [0, 1, 2].map((axis) => +Math.max(...allPositions.filter((_, index) => index % 3 === axis)).toFixed(4))
};

let radius = 0;
for (let i = 0; i < allPositions.length; i += 3) {
  radius = Math.max(radius, Math.hypot(allPositions[i], allPositions[i + 1], allPositions[i + 2]));
}

const manifest = {
  name: ID,
  length: +(bounds.max[2] - bounds.min[2]).toFixed(3),
  bounds,
  radius: +radius.toFixed(3),
  groups
};

fs.writeFileSync(path.join(MODELS, `${ID}.mesh.bin`), bin);
fs.writeFileSync(path.join(MODELS, `${ID}.json`), `${JSON.stringify(manifest, null, 2)}\n`);

// Коллайдер строится по тем же треугольникам, что и меш: набор компактных боксов.
const triangles = [];
const binBuffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
for (const group of groups) {
  const positions = new Float32Array(binBuffer, group.positionByteOffset, group.vertexCount * 3);
  const indices = new Uint16Array(binBuffer, group.indexByteOffset, group.indexCount);
  for (const index of indices) {
    triangles.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
  }
}

const fit = buildBoxCollider(triangles, { detail: 20, maxBoxes: 8, margin: 0.2 });
const physics = {
  kind: 'dynamic',
  mass: 2,
  restitution: 0.3,
  friction: 0.25,
  collider: {
    shape: 'compound',
    spheres: [],
    boxes: fit.boxes
  }
};

fs.writeFileSync(path.join(MODELS, `${ID}.physics.json`), `${JSON.stringify(physics, null, 2)}\n`);

console.log(`${ID}: ${groups.length} групп, ${triangles.length / 9} треугольников`);
console.log('габариты', bounds.min.join(' × '), '→', bounds.max.join(' × '), `радиус ${radius.toFixed(2)}`);
console.log(`коллайдер: ${fit.boxes.length} боксов, заполнение ${(fit.stats.fill * 100).toFixed(0)}%, сетка ${fit.stats.grid.join('×')}`);
