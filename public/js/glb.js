// Разбор glTF Binary (.glb) прямо в браузере.
//
// Модуль чистый: ни WebGL, ни DOM — поэтому его легко проверить в Node.
// Задача — превратить GLB в наш формат ассета: манифест + mesh.bin,
// который потом читает loadBinaryModel (public/js/ship.js).
//
// Поддержано: один и несколько мешей, иерархия узлов с TRS/матрицами,
// материалы (baseColorFactor, emissiveFactor, metallic, roughness) и UV.
// Текстуры из GLB пока не переносятся — цвет берётся из материала.

import { M4, quatToMat4 } from './math.js';

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

const COMPONENT_TYPES = {
  5120: { Array: Int8Array, size: 1, read: 'getInt8' },
  5121: { Array: Uint8Array, size: 1, read: 'getUint8' },
  5122: { Array: Int16Array, size: 2, read: 'getInt16' },
  5123: { Array: Uint16Array, size: 2, read: 'getUint16' },
  5125: { Array: Uint32Array, size: 4, read: 'getUint32' },
  5126: { Array: Float32Array, size: 4, read: 'getFloat32' }
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function toArrayBuffer(input) {
  if (input instanceof ArrayBuffer) return input;
  if (ArrayBuffer.isView(input)) {
    return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  throw new Error('ожидался ArrayBuffer или типизированный массив');
}

function readChunks(source) {
  const buffer = toArrayBuffer(source);
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('это не GLB: неверная сигнатура');
  if (view.getUint32(4, true) !== 2) throw new Error('поддерживается только glTF 2.0');

  const total = view.getUint32(8, true);
  let offset = 12;
  let json = null;
  let bin = null;

  while (offset < total) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;

    if (type === CHUNK_JSON) {
      const text = new TextDecoder('utf-8').decode(new Uint8Array(buffer, start, length));
      json = JSON.parse(text.replace(/\0+$/g, '').trim());
    } else if (type === CHUNK_BIN) {
      bin = buffer.slice(start, start + length);
    }

    offset = start + length + ((4 - (length % 4)) % 4);
  }

  if (!json) throw new Error('в GLB нет JSON-чанка');
  return { json, bin };
}

/** Чтение accessor'а в обычный типизированный массив с учётом stride. */
function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors?.[index];
  if (!accessor) throw new Error(`accessor ${index} не найден`);

  const itemSize = COMPONENTS[accessor.type];
  const type = COMPONENT_TYPES[accessor.componentType];
  if (!itemSize || !type) throw new Error(`accessor ${index}: неизвестный тип`);

  const count = accessor.count;
  const out = new type.Array(count * itemSize);

  if (accessor.bufferView == null) return out;

  const bufferView = gltf.bufferViews[accessor.bufferView];
  const stride = bufferView.byteStride || itemSize * type.size;
  const base = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const view = new DataView(bin);

  for (let i = 0; i < count; i++) {
    const rowOffset = base + i * stride;
    for (let c = 0; c < itemSize; c++) {
      out[i * itemSize + c] = view[type.read](rowOffset + c * type.size, true);
    }
  }

  return out;
}

function matrixFromNode(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.slice();
  }

  const translation = M4.translation(
    node.translation?.[0] || 0,
    node.translation?.[1] || 0,
    node.translation?.[2] || 0
  );

  const rotation = node.rotation
    ? quatToMat4(node.rotation)
    : M4.identity();

  const scale = M4.scaling(
    node.scale?.[0] ?? 1,
    node.scale?.[1] ?? 1,
    node.scale?.[2] ?? 1
  );

  return M4.mul(translation, M4.mul(rotation, scale));
}

function colorFromFactor(factor, fallback = [0.6, 0.63, 0.7]) {
  if (!Array.isArray(factor) || factor.length < 3) return fallback;
  return [
    Math.max(0, Math.min(1, factor[0])),
    Math.max(0, Math.min(1, factor[1])),
    Math.max(0, Math.min(1, factor[2]))
  ];
}

function walkNodes(gltf, nodeIndex, parentMatrix, parts, depth = 0) {
  if (depth > 32) return;

  const node = gltf.nodes?.[nodeIndex];
  if (!node) return;

  const matrix = M4.mul(parentMatrix, matrixFromNode(node));
  const normalMatrix = M4.normalMatrix(matrix);

  if (node.mesh != null) {
    const mesh = gltf.meshes[node.mesh];

    for (const primitive of mesh.primitives || []) {
      if (primitive.attributes?.POSITION == null) continue;
      if (primitive.mode != null && primitive.mode !== 4) continue; // только треугольники

      const positions = readAccessor(gltf, gltf.bin, primitive.attributes.POSITION);
      const normalsSource = primitive.attributes.NORMAL != null
        ? readAccessor(gltf, gltf.bin, primitive.attributes.NORMAL)
        : null;
      const uvsSource = primitive.attributes.TEXCOORD_0 != null
        ? readAccessor(gltf, gltf.bin, primitive.attributes.TEXCOORD_0)
        : null;

      const vertexCount = positions.length / 3;
      const outPositions = new Float32Array(vertexCount * 3);
      const outNormals = new Float32Array(vertexCount * 3);
      const outUvs = new Float32Array(vertexCount * 2);

      for (let i = 0; i < vertexCount; i++) {
        const point = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
        const world = M4.transformPoint(matrix, point);
        outPositions[i * 3] = world[0];
        outPositions[i * 3 + 1] = world[1];
        outPositions[i * 3 + 2] = world[2];

        if (normalsSource) {
          const normal = [normalsSource[i * 3], normalsSource[i * 3 + 1], normalsSource[i * 3 + 2]];
          const nx = normalMatrix[0] * normal[0] + normalMatrix[3] * normal[1] + normalMatrix[6] * normal[2];
          const ny = normalMatrix[1] * normal[0] + normalMatrix[4] * normal[1] + normalMatrix[7] * normal[2];
          const nz = normalMatrix[2] * normal[0] + normalMatrix[5] * normal[1] + normalMatrix[8] * normal[2];
          const length = Math.hypot(nx, ny, nz) || 1;
          outNormals[i * 3] = nx / length;
          outNormals[i * 3 + 1] = ny / length;
          outNormals[i * 3 + 2] = nz / length;
        } else {
          outNormals[i * 3] = 0;
          outNormals[i * 3 + 1] = 1;
          outNormals[i * 3 + 2] = 0;
        }

        if (uvsSource) {
          outUvs[i * 2] = uvsSource[i * 2];
          outUvs[i * 2 + 1] = uvsSource[i * 2 + 1];
        }
      }

      const indicesSource = primitive.indices != null
        ? readAccessor(gltf, gltf.bin, primitive.indices)
        : null;
      const indices = indicesSource || Uint32Array.from({ length: vertexCount }, (_, i) => i);

      const material = gltf.materials?.[primitive.material] || {};
      const pbr = material.pbrMetallicRoughness || {};
      const rough = pbr.roughnessFactor ?? 0.7;

      // Базовая текстура материала: texture -> source -> image
      const textureIndex = pbr.baseColorTexture?.index ?? null;
      const imageIndex = textureIndex != null
        ? (gltf.textures?.[textureIndex]?.source ?? null)
        : null;

      parts.push({
        name: `${mesh.name || node.name || 'mesh'}${parts.length ? ` ${parts.length}` : ''}`,
        positions: outPositions,
        normals: outNormals,
        uvs: outUvs,
        indices,
        color: colorFromFactor(pbr.baseColorFactor),
        emissive: colorFromFactor(material.emissiveFactor, [0, 0, 0]),
        metal: pbr.metallicFactor ?? 0.2,
        specular: Math.max(0.2, 1.4 - rough),
        imageIndex
      });
    }
  }

  for (const child of node.children || []) {
    walkNodes(gltf, child, matrix, parts, depth + 1);
  }
}

function boundsOf(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const part of parts) {
    for (let i = 0; i < part.positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = part.positions[i + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }

  if (!Number.isFinite(min[0])) return { min: [-1, -1, -1], max: [1, 1, 1] };
  return { min, max };
}

/**
 * Разобрать GLB в части: геометрия уже в мировых координатах модели,
 * нормали пересчитаны, материалы переведены в наши поля.
 */
export function parseGlb(buffer) {
  const { json, bin } = readChunks(buffer);
  if (!bin) throw new Error('в GLB нет бинарного чанка');

  // Привязываем буфер к JSON, чтобы walkNodes мог читать accessor'ы
  json.bin = bin;

  const parts = [];
  const scene = json.scenes?.[json.scene || 0];
  const roots = scene?.nodes || (json.nodes || []).map((_, index) => index);

  for (const root of roots) {
    walkNodes(json, root, M4.identity(), parts);
  }

  if (!parts.length) throw new Error('в GLB нет треугольных мешей');

  // Изображения материалов лежат в бинарном чанке — достаём только те,
  // на которые ссылаются материалы (иначе 150-мегабайтный GLB тащит всё)
  const textures = [];
  const usedImages = new Set();

  for (const material of json.materials || []) {
    const pbr = material.pbrMetallicRoughness || {};
    const textureIndex = pbr.baseColorTexture?.index;
    if (textureIndex == null) continue;

    const source = json.textures?.[textureIndex]?.source;
    if (source != null) usedImages.add(source);
  }

  (json.images || []).forEach((image, index) => {
    if (!usedImages.has(index)) return;
    if (image.bufferView == null) return; // внешние файлы и data-URI не поддерживаем

    const view = json.bufferViews?.[image.bufferView];
    if (!view) return;

    const offset = view.byteOffset || 0;
    const length = view.byteLength || 0;
    if (!length) return;

    textures.push({
      index,
      mime: image.mimeType || 'image/png',
      bytes: new Uint8Array(bin, offset, length).slice()
    });
  });

  return {
    name: json.asset?.generator ? (json.scenes?.[0]?.name || 'Imported') : 'Imported',
    parts,
    textures,
    bounds: boundsOf(parts)
  };
}

function pad4(length) {
  return (4 - (length % 4)) % 4;
}

/**
 * Упаковать части в наш ассет: манифест + бинарник.
 * Раскладка как у build-corinth.mjs: [позиции][нормали][UV][индексы], всё по 4 байта.
 */
export function packAsset(parsed, options = {}) {
  const chunks = [];
  let offset = 0;

  // Уникальные изображения материалов → имена наборов текстур
  const textureNames = new Map();
  const textures = [];

  const push = (bytes) => {
    const padding = pad4(bytes.byteLength);
    chunks.push(bytes);
    if (padding) chunks.push(new Uint8Array(padding));
    const at = offset;
    offset += bytes.byteLength + padding;
    return at;
  };

  const groups = [];

  for (const part of parsed.parts) {
    const positions = part.positions instanceof Float32Array ? part.positions : new Float32Array(part.positions);
    const normals = part.normals instanceof Float32Array ? part.normals : new Float32Array(part.normals);
    const uvs = part.uvs instanceof Float32Array ? part.uvs : new Float32Array(part.uvs);

    const maxIndex = part.indices.reduce((max, value) => Math.max(max, value), 0);
    const indices = maxIndex < 65536 ? new Uint16Array(part.indices) : new Uint32Array(part.indices);

    const vertexCount = positions.length / 3;

    let texture = null;
    if (part.imageIndex != null) {
      if (!textureNames.has(part.imageIndex)) {
        const name = textureNames.size === 0 ? options.textureName || 'tex' : `tex${textureNames.size + 1}`;
        textureNames.set(part.imageIndex, name);
        const image = parsed.textures?.find((item) => item.index === part.imageIndex);
        if (image) textures.push({ name, mime: image.mime, bytes: image.bytes });
      }

      texture = textureNames.get(part.imageIndex);
    }

    groups.push({
      name: part.name,
      texture,
      color: part.color,
      metal: part.metal,
      specular: part.specular,
      vertexCount,
      indexCount: indices.length,
      positionByteOffset: push(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)),
      normalByteOffset: push(new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength)),
      uvByteOffset: push(new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength)),
      indexByteOffset: push(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)),
      emissive: part.emissive && part.emissive.some((v) => v > 0) ? part.emissive : undefined
    });
  }

  const bin = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bin.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  const bounds = parsed.bounds;
  const size = [bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]];

  const manifest = {
    name: options.name || parsed.name || 'Imported',
    length: Math.max(size[0], size[1], size[2]) || 1,
    bounds,
    radius: Math.max(size[0], size[1], size[2]) * 0.5,
    // Импорт из GLB: UV и материалы верные, поэтому цвет берём из текстуры,
    // а не из палитры. rough/metal у таких наборов обычно нет.
    textureColor: true,
    textureMaps: ['base'],
    groups: groups.map((group) => ({
      name: group.name,
      texture: group.texture,
      color: rgbToHex(group.color),
      metal: group.metal,
      specular: group.specular,
      vertexCount: group.vertexCount,
      indexCount: group.indexCount,
      positionByteOffset: group.positionByteOffset,
      normalByteOffset: group.normalByteOffset,
      uvByteOffset: group.uvByteOffset,
      indexByteOffset: group.indexByteOffset,
      ...(group.emissive ? { glow: rgbToHex(group.emissive), glowIntensity: 1 } : {})
    }))
  };

  return { manifest, bin, textures };
}

function rgbToHex(rgb) {
  return `#${rgb.map((value) => {
    const v = Math.max(0, Math.min(255, Math.round(value * 255)));
    return v.toString(16).padStart(2, '0');
  }).join('')}`;
}

/** base64 → Uint8Array для отправки на сервер. */
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }

  return btoa(binary);
}
