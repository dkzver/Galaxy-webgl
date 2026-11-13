/**
 * @fileoverview Извлечение вложенных моделей из ассета.
 *
 * Модель в public/models — это манифест с группами (как объекты/сабмеши в
 * Blender, Unity или Unreal) и общий бинарник. Здесь группа выбирается по
 * индексу, копируется в новый буфер и получает собственный манифест: так из
 * корабля можно достать двигатель, контейнер или орудие отдельным ассетом.
 *
 * Модуль не знает про DOM, WebGL и сервер: только данные. Проверяется
 * в node --test.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

function numberOr(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Имя объекта без суффикса материала: «Cockpit_Mesh 9» → «Cockpit_Mesh». */
export function baseNameOf(name) {
  return String(name || '').replace(/\s+\d+$/, '');
}

/**
 * Скрыта ли часть модели. В hiddenParts можно писать и полное имя группы,
 * и имя объекта без суффикса материала.
 */
export function partHidden(hiddenParts, partName) {
  if (!Array.isArray(hiddenParts) || !hiddenParts.length) return false;
  const name = String(partName || '');
  return hiddenParts.includes(name) || hiddenParts.includes(baseNameOf(name));
}

/**
 * Список объектов модели: группы сгруппированы по базовому имени.
 * @param {object} manifest
 * @returns {Array<{name: string, indices: number[], vertices: number, triangles: number}>}
 */
export function listObjects(manifest) {
  const objects = new Map();

  for (const [index, group] of (manifest?.groups || []).entries()) {
    const name = baseNameOf(group.name);
    if (!objects.has(name)) objects.set(name, { name, indices: [], vertices: 0, triangles: 0 });

    const object = objects.get(name);
    object.indices.push(index);
    object.vertices += numberOr(group.vertexCount);
    object.triangles += Math.round(numberOr(group.indexCount) / 3);
  }

  return [...objects.values()];
}

function readSection(buffer, offset, Type, count) {
  return new Type(buffer, offset, count);
}

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

/**
 * Извлечь выбранные группы в новый ассет.
 *
 * @param {object} manifest исходный манифест
 * @param {ArrayBuffer|Uint8Array} buffer содержимое <id>.mesh.bin
 * @param {object} options
 * @param {string} options.id id нового ассета (a-z, 0-9, дефис)
 * @param {number[]} [options.indices] индексы групп; по умолчанию все
 * @param {boolean} [options.recenter] сдвинуть центр габаритов в ноль
 * @param {number|null} [options.scaleToLength] масштаб до нужной длины, м
 * @param {string} [options.name] человекочитаемое имя
 * @returns {{manifest: object, bin: Uint8Array, stats: object}}
 */
export function extractModel(manifest, buffer, options = {}) {
  const id = typeof options.id === 'string' ? options.id.trim() : '';
  if (!ID_PATTERN.test(id)) {
    throw new Error('id модели: только латиница, цифры и дефис, начиная с буквы или цифры');
  }

  const groups = Array.isArray(manifest?.groups) ? manifest.groups : [];
  if (!groups.length) throw new Error('в модели нет групп');

  const indices = Array.isArray(options.indices) && options.indices.length
    ? [...new Set(options.indices.map((value) => Math.floor(Number(value))))]
    : groups.map((_, index) => index);

  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= groups.length) {
      throw new Error(`группа ${index}: вне диапазона 0…${groups.length - 1}`);
    }
  }

  const data = buffer instanceof Uint8Array
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : buffer;
  if (!(data instanceof ArrayBuffer)) throw new Error('ожидался бинарник модели');

  // 1. Копируем выбранные группы как есть
  const picked = indices.map((index) => {
    const group = groups[index];
    const vertexCount = Math.max(0, Math.floor(numberOr(group.vertexCount)));
    const indexCount = Math.max(0, Math.floor(numberOr(group.indexCount)));

    return {
      group,
      vertexCount,
      indexCount,
      positions: new Float32Array(readSection(data, group.positionByteOffset, Float32Array, vertexCount * 3)),
      normals: new Float32Array(readSection(data, group.normalByteOffset, Float32Array, vertexCount * 3)),
      uvs: new Float32Array(readSection(data, group.uvByteOffset, Float32Array, vertexCount * 2)),
      indices: new Uint16Array(readSection(data, group.indexByteOffset, Uint16Array, indexCount))
    };
  });

  // 2. Габариты по исходным позициям
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const part of picked) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = part.positions[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  if (!Number.isFinite(min[0])) {
    min[0] = min[1] = min[2] = 0;
    max[0] = max[1] = max[2] = 0;
  }

  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const maxSize = Math.max(size[0], size[1], size[2]);
  const center = options.recenter === false
    ? [0, 0, 0]
    : [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];

  const scale = Number(options.scaleToLength) > 0 && maxSize > 1e-9
    ? Number(options.scaleToLength) / maxSize
    : 1;

  // 3. Сдвиг/масштаб позиций и новые габариты
  const newMin = [Infinity, Infinity, Infinity];
  const newMax = [-Infinity, -Infinity, -Infinity];

  for (const part of picked) {
    const positions = part.positions;
    for (let i = 0; i < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = (positions[i + axis] - center[axis]) * scale;
        positions[i + axis] = value;
        if (value < newMin[axis]) newMin[axis] = value;
        if (value > newMax[axis]) newMax[axis] = value;
      }
    }
  }

  if (!Number.isFinite(newMin[0])) {
    newMin[0] = newMin[1] = newMin[2] = 0;
    newMax[0] = newMax[1] = newMax[2] = 0;
  }

  // 4. Складываем бинарник: на каждую группу position → normal → uv → index
  const chunks = [];
  let offset = 0;

  const push = (typed) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    chunks.push(bytes);

    const padding = pad4(bytes.byteLength);
    if (padding) chunks.push(new Uint8Array(padding));

    const at = offset;
    offset += bytes.byteLength + padding;
    return at;
  };

  const resultGroups = picked.map((part) => ({
    ...part.group,
    vertexCount: part.vertexCount,
    indexCount: part.indexCount,
    positionByteOffset: push(part.positions),
    normalByteOffset: push(part.normals),
    uvByteOffset: push(part.uvs),
    indexByteOffset: push(part.indices)
  }));

  const bin = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bin.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const bounds = { min: newMin.map(round), max: newMax.map(round) };
  const length = Math.max(newMax[0] - newMin[0], newMax[1] - newMin[1], newMax[2] - newMin[2]);
  let radius = 0;
  for (const part of picked) {
    for (let i = 0; i < part.positions.length; i += 3) {
      radius = Math.max(radius, Math.hypot(part.positions[i], part.positions[i + 1], part.positions[i + 2]));
    }
  }

  const result = {
    name: options.name || id,
    length: round(length),
    bounds,
    radius: round(radius),
    bytes: bin.byteLength,
    groups: resultGroups
  };

  if (manifest.textureColor) result.textureColor = true;
  if (Array.isArray(manifest.textureMaps) && manifest.textureMaps.length) {
    result.textureMaps = manifest.textureMaps.slice();
  }

  return {
    manifest: result,
    bin,
    stats: {
      groups: resultGroups.length,
      vertices: picked.reduce((sum, part) => sum + part.vertexCount, 0),
      triangles: picked.reduce((sum, part) => sum + part.indexCount / 3, 0),
      length: result.length,
      radius: result.radius,
      bytes: result.bytes
    }
  };
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
