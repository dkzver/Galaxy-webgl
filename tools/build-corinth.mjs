// Сборка игрового ассета из исходного OBJ Corinth Cargo Transporter.
//   node tools/build-corinth.mjs
// Результат: public/models/corinth.json + corinth.mesh.bin
// Бинарный формат на каждую группу: [позиции][нормали][UV][индексы], всё выровнено по 4 байта.

import fs from 'node:fs';
import path from 'node:path';

const SOURCE = 'assets/corinth/Corinth_Cargo_Transporter.obj';
const OUT_DIR = 'public/models';
const TARGET_LENGTH = 15; // длина корабля в игровых единицах

// Группы персонажа (пилот внутри кабины) в игру не берём
const SKIP = /^(Body|group2 Eyes|group2 Eyelashes|group2 Hair|group2 Bottoms|group2 Shoes|group2 Tops)\b/i;

const text = fs.readFileSync(SOURCE, 'utf8');
const lines = text.split(/\r?\n/);

const positions = [];
const normals = [];
const uvs = [];
const groups = new Map();

let current = null;
let material = '';

for (const line of lines) {
  if (line.startsWith('v ')) {
    positions.push(line.split(/\s+/).slice(1, 4).map(Number));
  } else if (line.startsWith('vn ')) {
    normals.push(line.split(/\s+/).slice(1, 4).map(Number));
  } else if (line.startsWith('vt ')) {
    uvs.push(line.split(/\s+/).slice(1, 3).map(Number));
  } else if (line.startsWith('g ')) {
    const name = line.slice(2).trim();
    if (SKIP.test(name)) {
      current = null;
    } else {
      if (!groups.has(name)) groups.set(name, { name, faces: [] });
      current = groups.get(name);
    }
  } else if (line.startsWith('usemtl ')) {
    material = line.slice(7).trim();
  } else if (line.startsWith('f ')) {
    if (!current) continue;
    const face = line.split(/\s+/).slice(1).map((token) => {
      const [v, vt, vn] = token.split('/');
      return {
        v: parseInt(v, 10),
        vt: vt ? parseInt(vt, 10) : 0,
        vn: vn ? parseInt(vn, 10) : 0
      };
    }).filter((f) => Number.isFinite(f.v) && f.v !== 0);

    for (let i = 1; i + 1 < face.length; i++) {
      current.faces.push({ tri: [face[0], face[i], face[i + 1]], material });
    }
  }
}

const resolve = (index, list) => (index < 0 ? list.length + index : index - 1);

// --- нормализация: центр, поворот носом в -Z, масштаб ---
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (const [, g] of groups) {
  for (const { tri } of g.faces) {
    for (const { v } of tri) {
      const p = positions[resolve(v, positions)];
      if (!p) continue;
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
    }
  }
}

const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
const scale = TARGET_LENGTH / size[2];

const transform = (p) => [
  -(p[0] - center[0]) * scale,
  (p[1] - center[1]) * scale,
  -(p[2] - center[2]) * scale
];

// --- какой набор текстур назначить группе ---
function textureFor(name) {
  if (/Cockpit/i.test(name)) return 'cockpit';
  if (/polySurface1096/i.test(name)) return 'container';
  if (/polySurface1206/i.test(name)) return 'thrusters';
  return 'hull';
}

// Базовый цвет детали: текстура даёт рельеф, цвет задаём палитрой
function colorFor(name) {
  if (/Cockpit/i.test(name)) return '#7a8fa0';
  if (/polySurface1096/i.test(name)) return '#2e3540';
  if (/polySurface1053|polySurface1212/i.test(name)) return '#4c5562';
  if (/polySurface1172|pCube120/i.test(name)) return '#555d6a';
  if (/polySurface1206|Line008/i.test(name)) return '#37404b';
  if (/pCube130|polySurface1046/i.test(name)) return '#7a838f';
  return '#5f6874';
}

const chunks = [];
const manifestGroups = [];
let vertexTotal = 0;
let triangleTotal = 0;
let groupIndex = 0;

const overallMin = [Infinity, Infinity, Infinity];
const overallMax = [-Infinity, -Infinity, -Infinity];

const align4 = (buf) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]));

for (const [name, g] of groups) {
  const map = new Map();
  const localPos = [];
  const localNrm = [];
  const localUv = [];
  const indices = [];

  for (const { tri } of g.faces) {
    for (const { v, vt, vn } of tri) {
      const p = positions[resolve(v, positions)];
      if (!p) continue;

      let normal = vn ? normals[resolve(vn, normals)] : null;
      if (!normal) {
        const a = positions[resolve(tri[0].v, positions)];
        const b = positions[resolve(tri[1].v, positions)];
        const c = positions[resolve(tri[2].v, positions)];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        normal = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0]
        ];
        const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
        normal = [normal[0] / len, normal[1] / len, normal[2] / len];
      }

      const uv = vt ? uvs[resolve(vt, uvs)] || [0, 0] : [0, 0];
      const wp = transform(p);
      const key = `${wp[0].toFixed(4)},${wp[1].toFixed(4)},${wp[2].toFixed(4)}|${uv[0].toFixed(5)},${uv[1].toFixed(5)}|${normal[0].toFixed(3)},${normal[1].toFixed(3)},${normal[2].toFixed(3)}`;

      let idx = map.get(key);
      if (idx === undefined) {
        idx = localPos.length / 3;
        map.set(key, idx);
        localPos.push(wp[0], wp[1], wp[2]);
        localNrm.push(normal[0], normal[1], normal[2]);
        localUv.push(uv[0], uv[1]);
      }
      indices.push(idx);
    }
  }

  if (!indices.length) continue;

  const byteOffset = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const posBytes = align4(Buffer.from(new Float32Array(localPos).buffer));
  const nrmBytes = align4(Buffer.from(new Float32Array(localNrm).buffer));
  const uvBytes = align4(Buffer.from(new Float32Array(localUv).buffer));
  const idxBytes = align4(Buffer.from(new Uint16Array(indices).buffer));

  chunks.push(posBytes, nrmBytes, uvBytes, idxBytes);

  manifestGroups.push({
    name,
    texture: textureFor(name),
    color: colorFor(name),
    vertexCount: localPos.length / 3,
    indexCount: indices.length,
    positionByteOffset: byteOffset,
    normalByteOffset: byteOffset + posBytes.length,
    uvByteOffset: byteOffset + posBytes.length + nrmBytes.length,
    indexByteOffset: byteOffset + posBytes.length + nrmBytes.length + uvBytes.length
  });

  for (let i = 0; i < localPos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      overallMin[k] = Math.min(overallMin[k], localPos[i + k]);
      overallMax[k] = Math.max(overallMax[k], localPos[i + k]);
    }
  }

  vertexTotal += localPos.length / 3;
  triangleTotal += indices.length / 3;
  groupIndex++;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'corinth.mesh.bin'), Buffer.concat(chunks));

const manifest = {
  name: 'Corinth Cargo Transporter',
  length: TARGET_LENGTH,
  bounds: {
    min: overallMin.map((n) => +n.toFixed(3)),
    max: overallMax.map((n) => +n.toFixed(3))
  },
  groups: manifestGroups,
  thrusters: [
    { pos: [1.3, -1.55, 6.95], size: 1.0 },
    { pos: [-1.3, -1.55, 6.95], size: 1.0 }
  ]
};
fs.writeFileSync(path.join(OUT_DIR, 'corinth.json'), JSON.stringify(manifest, null, 2));

console.log(`групп: ${manifestGroups.length}, вершин: ${vertexTotal}, треугольников: ${triangleTotal}`);
console.log('габарит:', overallMin.map((n) => n.toFixed(2)).join(', '), '→', overallMax.map((n) => n.toFixed(2)).join(', '));
console.log('файл:', (fs.statSync(path.join(OUT_DIR, 'corinth.mesh.bin')).size / 1024 / 1024).toFixed(2), 'МБ');
