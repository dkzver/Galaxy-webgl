/**
 * Масштабирование модели на месте: тот же id, те же файлы.
 *
 *   node tools/model-scale.mjs <id> <factor>
 *
 * Пересобирает public/models/<id>.json + <id>.mesh.bin: позиции умножаются
 * на factor, габариты, длина и радиус пересчитываются. Новых моделей не
 * появляется — сцены и префабы продолжают ссылаться на тот же id.
 */

import fs from 'node:fs';
import path from 'node:path';

import { extractModel } from '../public/js/model-split.js';

const [id, factorText] = process.argv.slice(2);
const factor = Number(factorText);

if (!id || !Number.isFinite(factor) || factor <= 0) {
  console.error('использование: node tools/model-scale.mjs <id> <factor>');
  process.exit(1);
}

const dir = path.join('public', 'models');
const jsonPath = path.join(dir, `${id}.json`);
const binPath = path.join(dir, `${id}.mesh.bin`);

const manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const bin = fs.readFileSync(binPath);
const buffer = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);

const indices = (manifest.groups || []).map((_, index) => index);
const length = Number(manifest.length) || 0;

const result = extractModel(manifest, buffer, {
  id,
  name: manifest.name || id,
  indices,
  recenter: false,
  scaleToLength: length > 0 ? length * factor : null
});

result.manifest.id = id;

fs.writeFileSync(jsonPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(binPath, result.bin);

console.log(`ok ${id}: ×${factor}`);
console.log(`  длина ${length.toFixed(3)} → ${result.manifest.length.toFixed(3)}`);
console.log(`  радиус ${Number(manifest.radius).toFixed(3)} → ${result.manifest.radius.toFixed(3)}`);
console.log(`  габариты ${result.manifest.bounds.min.map((v) => v.toFixed(2)).join(', ')} … ${result.manifest.bounds.max.map((v) => v.toFixed(2)).join(', ')}`);
console.log('  рекомендованный коллайдер:', (result.manifest.radius * 1.02).toFixed(2));
