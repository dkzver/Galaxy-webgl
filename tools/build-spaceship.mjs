// Сборка второго корабля из space-ship.zip (FBX) в игровой формат.
//   node tools/build-spaceship.mjs
// Результат: public/models/spaceship.json + spaceship.mesh.bin

import fs from 'node:fs';
import path from 'node:path';
import { parseFBX } from './fbx-lib.mjs';

const SOURCE = 'assets/spaceship/space-ship.fbx';
const OUT_DIR = 'public/models';
const TARGET_LENGTH = 9; // длина корабля в игровых единицах
const YAW_FIX = 0; // разворот носом в -Z (подбирается по внешнему виду)

const { root } = parseFBX(fs.readFileSync(SOURCE));

const find = (node, name, out = []) => {
  if (node.name === name) out.push(node);
  for (const c of node.children) find(c, name, out);
  return out;
};

const geometry = find(root, 'Geometry')[0];
if (!geometry) throw new Error('в FBX нет Geometry');

const vertsNode = geometry.children.find((c) => c.name === 'Vertices');
const indexNode = geometry.children.find((c) => c.name === 'PolygonVertexIndex');
const uvLayer = find(geometry, 'LayerElementUV')[0];

const flat = vertsNode.props[0];              // Float64Array
const polyIndex = indexNode.props[0];         // Int32Array
const uvData = uvLayer?.children.find((c) => c.name === 'UV')?.props[0];
const uvIndex = uvLayer?.children.find((c) => c.name === 'UVIndex')?.props[0];

const positions = [];
for (let i = 0; i < flat.length; i += 3) positions.push([flat[i], flat[i + 1], flat[i + 2]]);

// Разворачиваем полигоны в треугольники (fan), последний индекс полигона закодирован отрицательным
const polys = [];
let current = [];
for (let i = 0; i < polyIndex.length; i++) {
  const raw = polyIndex[i];
  const last = raw < 0;
  current.push({ v: last ? -raw - 1 : raw, uv: i });
  if (last) {
    polys.push(current);
    current = [];
  }
}

let triangles = 0;
for (const poly of polys) triangles += Math.max(0, poly.length - 2);
console.log('вершин:', positions.length, 'полигонов:', polys.length, 'треугольников:', triangles);

// --- трансформации: PreRotation модели (-90 по X), разворот, центр, масштаб ---
const preRotate = ([x, y, z]) => [x, z, -y];

let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
const rotated = positions.map((p) => {
  const q = preRotate(p);
  for (let i = 0; i < 3; i++) {
    if (q[i] < min[i]) min[i] = q[i];
    if (q[i] > max[i]) max[i] = q[i];
  }
  return q;
});

const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
const scale = TARGET_LENGTH / Math.max(size[0], size[1], size[2]);
console.log('габарит FBX:', size.map((n) => n.toFixed(2)).join(' x '), '→ масштаб', scale.toFixed(3));

const cosY = Math.cos(YAW_FIX), sinY = Math.sin(YAW_FIX);
const transform = (p) => {
  const x = (p[0] - center[0]) * scale;
  const y = (p[1] - center[1]) * scale;
  const z = (p[2] - center[2]) * scale;
  // поворот вокруг Y
  return [x * cosY + z * sinY, y, -x * sinY + z * cosY];
};

const world = rotated.map(transform);

// --- сборка меша: позиции/нормали/UV, индексы Uint16 (вершины дедуплицируются по (v, uv)) ---
const map = new Map();
const outPos = [];
const outNrm = [];
const outUv = [];
const outIdx = [];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

for (const poly of polys) {
  for (let i = 1; i + 1 < poly.length; i++) {
    const tri = [poly[0], poly[i], poly[i + 1]];
    const p0 = world[tri[0].v], p1 = world[tri[1].v], p2 = world[tri[2].v];
    const n = normalize(cross(sub(p1, p0), sub(p2, p0)));

    for (const corner of tri) {
      const u = uvData && uvIndex ? uvData[uvIndex[corner.uv] * 2] : 0;
      const v = uvData && uvIndex ? uvData[uvIndex[corner.uv] * 2 + 1] : 0;
      const p = world[corner.v];
      const key = `${corner.v}|${u.toFixed(4)},${v.toFixed(4)}|${n[0].toFixed(2)},${n[1].toFixed(2)},${n[2].toFixed(2)}`;
      let idx = map.get(key);
      if (idx === undefined) {
        idx = outPos.length / 3;
        map.set(key, idx);
        outPos.push(p[0], p[1], p[2]);
        outNrm.push(n[0], n[1], n[2]);
        outUv.push(u, v);
      }
      outIdx.push(idx);
    }
  }
}

console.log('вершин в меше:', outPos.length / 3, 'индексов:', outIdx.length);

// --- упаковка в один бинарный файл: [позиции][нормали][UV][индексы] ---
const align4 = (buf) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]));
const posBytes = align4(Buffer.from(new Float32Array(outPos).buffer));
const nrmBytes = align4(Buffer.from(new Float32Array(outNrm).buffer));
const uvBytes = align4(Buffer.from(new Float32Array(outUv).buffer));
const idxBytes = align4(Buffer.from(new Uint16Array(outIdx).buffer));

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(OUT_DIR, 'spaceship.mesh.bin'),
  Buffer.concat([posBytes, nrmBytes, uvBytes, idxBytes])
);

const manifest = {
  name: 'Space Cruiser',
  length: TARGET_LENGTH,
  bounds: {
    min: [0, 1, 2].map((i) => +Math.min(...world.map((p) => p[i])).toFixed(3)),
    max: [0, 1, 2].map((i) => +Math.max(...world.map((p) => p[i])).toFixed(3))
  },
  groups: [{
    name: 'hull',
    texture: 'spaceship',
    color: '#c9d2e0',
    vertexCount: outPos.length / 3,
    indexCount: outIdx.length,
    positionByteOffset: 0,
    normalByteOffset: posBytes.length,
    uvByteOffset: posBytes.length + nrmBytes.length,
    indexByteOffset: posBytes.length + nrmBytes.length + uvBytes.length
  }],
  thrusters: [
    { pos: [-0.45, 0.35, 4.32], size: 0.45 },
    { pos: [0.45, 0.35, 4.32], size: 0.45 }
  ]
};
fs.writeFileSync(path.join(OUT_DIR, 'spaceship.json'), JSON.stringify(manifest, null, 2));

console.log('габарит игры:', manifest.bounds.min.join(', '), '→', manifest.bounds.max.join(', '));
console.log('файл:', (fs.statSync(path.join(OUT_DIR, 'spaceship.mesh.bin')).size / 1024 / 1024).toFixed(2), 'МБ');
