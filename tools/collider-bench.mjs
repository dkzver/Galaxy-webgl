// Прогон автоколлайдера по реальному ассету: сколько боксов, время, заполнение.
// Запуск: node tools/collider-bench.mjs [model-id] [detail] [maxBoxes]

import fs from 'node:fs';
import path from 'node:path';
import { buildBoxCollider, meshBounds } from '../public/js/editor/collider-fit.js';

const id = process.argv[2] || 'corinth-cargo-ship';
const detail = Number(process.argv[3]) || 16;
const maxBoxes = Number(process.argv[4]) || 32;

const dir = path.join(process.cwd(), 'public', 'models');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
const file = fs.readFileSync(path.join(dir, `${id}.mesh.bin`));
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

const chunks = [];
let triangles = 0;

for (const group of manifest.groups || []) {
  const positions = new Float32Array(buffer, group.positionByteOffset, group.vertexCount * 3);
  const indices = new Uint16Array(buffer, group.indexByteOffset, group.indexCount);
  const soup = new Float32Array(indices.length * 3);

  for (let i = 0; i < indices.length; i++) {
    const vertex = indices[i];
    soup[i * 3] = positions[vertex * 3];
    soup[i * 3 + 1] = positions[vertex * 3 + 1];
    soup[i * 3 + 2] = positions[vertex * 3 + 2];
  }

  chunks.push(soup);
  triangles += indices.length / 3;
}

const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
const mesh = new Float32Array(total);
let offset = 0;
for (const chunk of chunks) {
  mesh.set(chunk, offset);
  offset += chunk.length;
}

const bounds = meshBounds(mesh);
console.log(`модель ${id}: ${triangles} треугольников, ${manifest.groups.length} групп`);
console.log('габариты', bounds.size.map((v) => v.toFixed(2)).join(' × '));

for (const max of [Number(process.argv[4]) || 32]) {
  const started = performance.now();
  const result = buildBoxCollider(mesh, { detail, maxBoxes: max });
  const elapsed = performance.now() - started;

  const stats = result.stats;
  const volume = result.boxes.reduce((sum, box) => sum
    + box.halfExtents[0] * 2 * box.halfExtents[1] * 2 * box.halfExtents[2] * 2, 0);

  console.log(`detail ${detail} → сетка ${stats.grid.join('×')}, ячейка ${stats.cell.toFixed(2)} м, `
    + `боксов ${result.boxes.length}, заполнение ${(stats.fill * 100).toFixed(0)}%, `
    + `объём ${volume.toFixed(0)} м³, ${elapsed.toFixed(0)} мс, проходов ${stats.passes}`);

  const largest = result.boxes
    .map((box) => ({ box, size: box.halfExtents.map((v) => v * 2) }))
    .sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])
    .slice(0, 5);

  for (const item of largest) {
    console.log('  ', item.size.map((v) => v.toFixed(1)).join(' × '), 'центр',
      item.box.offset.map((v) => v.toFixed(1)).join(', '));
  }
}
