import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeScene } from '../public/js/scene.js';

const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/** Размер JPEG без внешних зависимостей: ищем маркер SOF. */
function jpegSize(file) {
  const buffer = fs.readFileSync(file);
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error(`не найден SOF в ${file}`);
}

test('skybox — сущность сцены без тела и коллизии', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'skybox-test',
    entities: [{
      id: 'scene',
      type: 'scene',
      children: [{
        id: 'skybox-1',
        type: 'skybox',
        skybox: 'alien-nebula-1',
        body: { kind: 'dynamic', mass: 10 },
        children: []
      }]
    }]
  });

  const entity = scene.entities[0];
  assert.equal(entity.type, 'skybox');
  assert.equal(entity.skybox, 'alien-nebula-1');
  assert.equal(entity.body, null, 'тело у skybox отбрасывается');
});

test('в public/skyboxes лежат пять панорам, превью и шесть граней кубемапы', () => {
  const index = JSON.parse(fs.readFileSync('public/skyboxes/index.json', 'utf8'));
  assert.equal(index.skyboxes.length, 5);

  for (const skybox of index.skyboxes) {
    assert.match(skybox.id, /^[a-z0-9-]+$/);
    assert.ok(skybox.title);
    assert.ok(fs.statSync(`public/${skybox.file}`).size > 0, `${skybox.file} существует`);
    assert.ok(fs.statSync(`public/${skybox.thumb}`).size > 0, `${skybox.thumb} существует`);
    assert.equal(skybox.cube, `skyboxes/cube/${skybox.id}`, 'кубемапа лежит рядом с панорамой');

    for (const face of FACES) {
      const file = `public/${skybox.cube}-${face}.jpg`;
      const size = jpegSize(file);
      assert.equal(size.width, size.height, `грань ${face} квадратная`);
      assert.equal(size.width, skybox.faceSize, `грань ${face} нужного размера`);
      assert.equal(size.width & (size.width - 1), 0, `грань ${face} степень двойки`);
    }
  }
});

test('движок рисует небо кубемапой, а не equirect-панорамой', () => {
  const code = fs.readFileSync('public/js/main.js', 'utf8');
  assert.match(code, /uniform samplerCube uSky/, 'шейдер берёт кубемапу');
  assert.match(code, /textureCube\(uSky, dir\)/, 'выборка по направлению луча');
  assert.match(code, /skyboxes\/cube\/\$\{id\}/, 'грани грузятся из папки cube');

  const shader = code.match(/const skyboxFS = `([\s\S]*?)`;/)[1];
  assert.doesNotMatch(shader, /fract\(/, 'нет разрыва производных на азимуте склейки');
  assert.doesNotMatch(shader, /acos\(/, 'нет сингулярности на полюсах');
});
