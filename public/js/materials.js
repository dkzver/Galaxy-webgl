/**
 * @fileoverview Материалы как данные.
 *
 * Материал — JSON-ассет в public/materials: id, шейдер, режим смешивания и
 * схема параметров, из которой редактор строит поля. Движок берёт значения
 * из `uniforms`, редактор пишет их в тот же файл.
 *
 * Модуль не знает про DOM и WebGL: нормализация проверяется в node --test.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const TYPES = new Set(['color', 'number', 'text']);
const BLENDS = new Set(['opaque', 'additive', 'alpha']);

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeParam(meta, fallback) {
  if (!meta || typeof meta !== 'object' || !TYPES.has(meta.type)) return null;

  const param = {
    type: meta.type,
    label: typeof meta.label === 'string' && meta.label ? meta.label : ''
  };

  if (meta.type === 'number') {
    const min = Number.isFinite(Number(meta.min)) ? Number(meta.min) : -Infinity;
    const max = Number.isFinite(Number(meta.max)) ? Number(meta.max) : Infinity;
    param.min = min;
    param.max = max;
    param.step = Math.max(1e-6, numberOr(meta.step, 0.1));
    param.default = clamp(numberOr(meta.default, fallback), min, max);
    return param;
  }

  if (meta.type === 'color') {
    param.default = typeof meta.default === 'string' && HEX_PATTERN.test(meta.default)
      ? meta.default
      : (HEX_PATTERN.test(fallback) ? fallback : '#ffffff');
    return param;
  }

  param.default = typeof meta.default === 'string' ? meta.default : String(fallback ?? '');
  return param;
}

/**
 * Нормализовать определение материала.
 * @param {object} raw
 * @param {string} [fallbackId]
 * @returns {{id:string,title:string,shader:string,blend:string,depthWrite:boolean,params:object,uniforms:object}}
 */
export function normalizeMaterial(raw, fallbackId = 'material') {
  if (!raw || typeof raw !== 'object') throw new Error('материал: ожидался объект');

  const id = typeof raw.id === 'string' && ID_PATTERN.test(raw.id) ? raw.id : fallbackId;
  if (!ID_PATTERN.test(id)) throw new Error('материал: id — латиница, цифры и дефис');

  const params = {};
  const uniforms = {};

  for (const [key, meta] of Object.entries(raw.params && typeof raw.params === 'object' ? raw.params : {})) {
    if (!ID_PATTERN.test(key)) continue;

    const param = normalizeParam(meta, raw.uniforms?.[key]);
    if (!param) continue;

    params[key] = param;
    uniforms[key] = param.default;
  }

  const source = raw.uniforms && typeof raw.uniforms === 'object' ? raw.uniforms : {};

  for (const [key, value] of Object.entries(source)) {
    const param = params[key];
    if (!param) continue;

    if (param.type === 'number') {
      uniforms[key] = clamp(numberOr(value, param.default), param.min, param.max);
    } else if (param.type === 'color') {
      uniforms[key] = typeof value === 'string' && HEX_PATTERN.test(value) ? value : param.default;
    } else {
      uniforms[key] = typeof value === 'string' ? value : param.default;
    }
  }

  return {
    id,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : id,
    shader: typeof raw.shader === 'string' && ID_PATTERN.test(raw.shader) ? raw.shader : 'mesh',
    blend: BLENDS.has(raw.blend) ? raw.blend : 'opaque',
    depthWrite: raw.depthWrite !== false,
    params,
    uniforms
  };
}
