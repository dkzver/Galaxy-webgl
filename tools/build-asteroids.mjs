// Сборка двух астероидов в игровой формат.
//   node tools/build-asteroids.mjs
// Результат: public/models/asteroid1|2.json + .mesh.bin

import fs from 'node:fs';
import path from 'node:path';
import { parseFBX } from './fbx-lib.mjs';

const OUT_DIR = 'public/models';
const TARGET_SIZE = 14; // максимальный габарит в игровых единицах

const align4 = (buf) => (buf.length % 4 === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4))]));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/* ------------------------------ источники ------------------------------ */

function readFBX(file) {
  const { root } = parseFBX(fs.readFileSync(file));
  const find = (node, name, out = []) => {
    if (node.name === name) out.push(node);
    for (const c of node.children) find(c, name, out);
    return out;
  };

  const geometry = find(root, 'Geometry')[0];
  const vertices = geometry.children.find((c) => c.name === 'Vertices').props[0];
  const indices = geometry.children.find((c) => c.name === 'PolygonVertexIndex').props[0];
  const uvLayer = find(geometry, 'LayerElementUV')[0];
  const uv = uvLayer?.children.find((c) => c.name === 'UV')?.props[0];
  const uvIndex = uvLayer?.children.find((c) => c.name === 'UVIndex')?.props[0];

  const positions = [];
  for (let i = 0; i < vertices.length; i += 3) {
    // FBX из Sketchfab: PreRotation -90 по X (Z-up → Y-up)
    positions.push([vertices[i], vertices[i + 2], -vertices[i + 1]]);
  }

  const polys = [];
  let current = [];
  for (let i = 0; i < indices.length; i++) {
    const raw = indices[i];
    const last = raw < 0;
    current.push({ v: last ? -raw - 1 : raw, uv: i });
    if (last) { polys.push(current); current = []; }
  }

  return { positions, polys, uv, uvIndex };
}

function readOBJ(file) {
  const text = fs.readFileSync(file, 'utf8');
  const positions = [];
  const uvs = [];
  const polys = [];

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) {
      const [x, y, z] = line.split(/\s+/).slice(1, 4).map(Number);
      positions.push([x, y, z]);
    } else if (line.startsWith('vt ')) {
      const [u, v] = line.split(/\s+/).slice(1, 3).map(Number);
      uvs.push([u, v]);
    } else if (line.startsWith('f ')) {
      const face = line.split(/\s+/).slice(1).map((token) => {
        const [v, vt] = token.split('/');
        const vi = parseInt(v, 10);
        return {
          v: vi < 0 ? positions.length + vi : vi - 1,
          uv: vt ? (vt < 0 ? uvs.length + parseInt(vt, 10) : parseInt(vt, 10) - 1) : -1
        };
      });
      if (face.length >= 3) polys.push(face);
    }
  }

  return { positions, polys, uv: null, uvIndex: null, uvList: uvs };
}

/* -------------------------------- сборка -------------------------------- */

function buildAsset({ positions, polys, uv, uvIndex, uvList }, id, texture, color) {
  // центр и масштаб по габаритам
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i];
      if (p[i] > max[i]) max[i] = p[i];
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const scale = TARGET_SIZE / Math.max(size[0], size[1], size[2]);

  const world = positions.map((p) => [
    (p[0] - center[0]) * scale,
    (p[1] - center[1]) * scale,
    (p[2] - center[2]) * scale
  ]);

  const map = new Map();
  const outPos = [];
  const outNrm = [];
  const outUv = [];
  const outIdx = [];

  const uvFor = (corner) => {
    if (uvList) return corner.uv >= 0 ? uvList[corner.uv] : [0, 0];
    if (!uv || !uvIndex) return [0, 0];
    const i = uvIndex[corner.uv];
    return [uv[i * 2], uv[i * 2 + 1]];
  };

  for (const poly of polys) {
    for (let i = 1; i + 1 < poly.length; i++) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      const p0 = world[tri[0].v], p1 = world[tri[1].v], p2 = world[tri[2].v];
      if (!p0 || !p1 || !p2) continue;
      const n = normalize(cross(sub(p1, p0), sub(p2, p0)));

      for (const corner of tri) {
        const [u, v] = uvFor(corner);
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

  const posBytes = align4(Buffer.from(new Float32Array(outPos).buffer));
  const nrmBytes = align4(Buffer.from(new Float32Array(outNrm).buffer));
  const uvBytes = align4(Buffer.from(new Float32Array(outUv).buffer));
  const idxBytes = align4(Buffer.from(new Uint16Array(outIdx).buffer));

  fs.writeFileSync(path.join(OUT_DIR, `${id}.mesh.bin`), Buffer.concat([posBytes, nrmBytes, uvBytes, idxBytes]));

  let radius = 0;
  for (let i = 0; i < outPos.length; i += 3) {
    radius = Math.max(radius, Math.hypot(outPos[i], outPos[i + 1], outPos[i + 2]));
  }

  const manifest = {
    name: id,
    bounds: {
      min: [0, 1, 2].map((k) => +Math.min(...outPos.filter((_, j) => j % 3 === k)).toFixed(3)),
      max: [0, 1, 2].map((k) => +Math.max(...outPos.filter((_, j) => j % 3 === k)).toFixed(3))
    },
    radius: +radius.toFixed(3),
    groups: [{
      name: id,
      texture,
      color,
      metal: 0.15,
      specular: 0.6,
      vertexCount: outPos.length / 3,
      indexCount: outIdx.length,
      positionByteOffset: 0,
      normalByteOffset: posBytes.length,
      uvByteOffset: posBytes.length + nrmBytes.length,
      indexByteOffset: posBytes.length + nrmBytes.length + uvBytes.length
    }]
  };

  fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(manifest, null, 2));
  console.log(`${id}: ${outIdx.length / 3} треугольников, радиус ${radius.toFixed(2)}, ${(fs.statSync(path.join(OUT_DIR, `${id}.mesh.bin`)).size / 1024).toFixed(0)} КБ`);
  return radius;
}

buildAsset(readFBX('assets/asteroids/asteroid-01.fbx'), 'asteroid1', 'asteroid1', '#77726a');
buildAsset(readOBJ('assets/asteroids/asteroid-with-minerals.obj'), 'asteroid2', 'asteroid2', '#7c828a');
