import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeMaterial } from '../public/js/materials.js';

const SHIELD = JSON.parse(fs.readFileSync('public/materials/shield.material.json', 'utf8'));

test('материал щита нормализуется из ассета', () => {
  const material = normalizeMaterial(SHIELD);

  assert.equal(material.id, 'shield');
  assert.equal(material.shader, 'shield');
  assert.equal(material.blend, 'additive');
  assert.equal(material.depthWrite, false);
  assert.equal(material.uniforms.color, '#59d8ff');
  assert.equal(material.uniforms.fresnel, 3);
  assert.equal(material.uniforms.hitRadius, 0.9);
});

test('uniforms заполняются из defaults схемы', () => {
  const material = normalizeMaterial({
    id: 'test',
    params: {
      color: { type: 'color', default: '#112233' },
      power: { type: 'number', default: 2, min: 0, max: 5 },
      label: { type: 'text', default: 'щит' }
    }
  });

  assert.equal(material.uniforms.color, '#112233');
  assert.equal(material.uniforms.power, 2);
  assert.equal(material.uniforms.label, 'щит');
});

test('значения клампятся по схеме, мусор заменяется дефолтом', () => {
  const material = normalizeMaterial({
    id: 'test',
    params: {
      power: { type: 'number', default: 2, min: 0, max: 5 },
      color: { type: 'color', default: '#abcdef' }
    },
    uniforms: { power: 99, color: 'не цвет' }
  });

  assert.equal(material.uniforms.power, 5);
  assert.equal(material.uniforms.color, '#abcdef');
});

test('неизвестные параметры и типы отбрасываются', () => {
  const material = normalizeMaterial({
    id: 'test',
    params: {
      good: { type: 'number', default: 1 },
      bad: { type: 'vector', default: [1, 2, 3] }
    },
    uniforms: { bad: 5, ghost: 1 }
  });

  assert.ok(material.params.good);
  assert.equal(material.params.bad, undefined);
  assert.equal(material.uniforms.bad, undefined);
  assert.equal(material.uniforms.ghost, undefined);
});

test('некорректные id, shader, blend и depthWrite заменяются безопасными', () => {
  const material = normalizeMaterial({
    id: 'плохой',
    shader: 'bad shader',
    blend: 'screen',
    depthWrite: false
  }, 'shield');

  assert.equal(material.id, 'shield');
  assert.equal(material.shader, 'mesh');
  assert.equal(material.blend, 'opaque');
  assert.equal(material.depthWrite, false);
});
