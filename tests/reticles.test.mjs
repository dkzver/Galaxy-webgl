import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  RETICLE_DEFAULTS,
  normalizeReticleConfig,
  reticleColor,
  reticleStateClasses
} from '../public/js/reticles.js';
import { normalizeScene } from '../public/js/scene.js';
import * as crosshair from '../public/scripts/reticles/crosshair.js';
import * as circle from '../public/scripts/reticles/circle.js';

test('normalizeReticleConfig зажимает размер и чинит цвета', () => {
  const config = normalizeReticleConfig({
    size: 500,
    color: '#abc',
    aimColor: 'red',
    hitColor: '#00ff00'
  });

  assert.equal(config.size, 120, 'размер зажат сверху');
  assert.equal(config.color, '#aabbcc', 'короткий hex развёрнут');
  assert.equal(config.aimColor, RETICLE_DEFAULTS.aimColor, 'мусор заменён значением по умолчанию');
  assert.equal('hitColor' in config, false, 'лишние цвета отброшены');
});

test('normalizeReticleConfig без данных даёт значения по умолчанию', () => {
  assert.deepEqual(normalizeReticleConfig(null), { ...RETICLE_DEFAULTS });
  assert.equal(normalizeReticleConfig({ size: 10 }).size, 16, 'слишком маленький размер поднят');
});

test('reticleStateClasses: только видимость и наведение', () => {
  assert.deepEqual(reticleStateClasses({}), ['visible']);
  assert.deepEqual(reticleStateClasses({ aimed: true }), ['visible', 'aimed']);
  assert.deepEqual(reticleStateClasses({ canHit: true }), ['visible'], 'попадание больше не отдельное состояние');
});

test('reticleColor: наведение → покой', () => {
  assert.equal(reticleColor(RETICLE_DEFAULTS, {}), RETICLE_DEFAULTS.color);
  assert.equal(reticleColor(RETICLE_DEFAULTS, { aimed: true }), RETICLE_DEFAULTS.aimColor);
});

test('осталось два дизайна: перекрестие и круг', () => {
  for (const [module, id, file] of [
    [crosshair, 'crosshair', 'hud/reticles/crosshair.svg'],
    [circle, 'circle', 'hud/reticles/circle.svg']
  ]) {
    assert.ok(module.params.file, `${id}: параметр файла`);
    const design = module.design({});

    assert.equal(design.id, id);
    assert.equal(design.kind, 'svg');
    assert.equal(design.file, file);
    assert.equal(typeof design.vars['--wr-spin'], 'string', `${id}: скорость задаётся переменной`);
  }
});

test('параметры дизайна меняют переменные', () => {
  const design = crosshair.design({ spin: 4, scan: 1.5 });

  assert.equal(design.vars['--wr-spin'], '4s');
  assert.equal(design.vars['--wr-scan'], '1.5s');
});

test('SVG-дизайны размечены общими ролями', () => {
  const dir = 'public/hud/reticles';
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.svg'));

  assert.deepEqual(files.sort(), ['circle.svg', 'crosshair.svg'], 'лишние виджеты удалены');

  for (const file of files) {
    const text = fs.readFileSync(`${dir}/${file}`, 'utf8');
    assert.match(text, /data-role="outer"/, `${file}: слой outer`);
    assert.match(text, /data-role="core"/, `${file}: ядро`);
    assert.match(text, /currentColor/, `${file}: цвет наследуется от контейнера`);
  }

  const crosshairSvg = fs.readFileSync(`${dir}/crosshair.svg`, 'utf8');
  assert.doesNotMatch(crosshairSvg, /data-role="progress"/, 'у прицела нет кольца/полосы прогресса');

  const circleSvg = fs.readFileSync(`${dir}/circle.svg`, 'utf8');
  assert.match(circleSvg, /data-role="progress"/, 'у круга остаётся кольцо для будущей логики курсора');
});

test('normalizeScene сохраняет сущность-прицел с настройками', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'reticle-test',
    entities: [{
      id: 'scene',
      type: 'scene',
      children: [{
        id: 'reticle-1',
        type: 'reticle',
        reticle: { size: 48, color: '#123456' }
      }]
    }]
  });

  const entity = scene.entities[0];
  assert.equal(entity.type, 'reticle');
  assert.equal(entity.reticle.size, 48);
  assert.equal(entity.reticle.color, '#123456');
  assert.equal(entity.reticle.aimColor, RETICLE_DEFAULTS.aimColor, 'недостающие поля дополнены');
});
