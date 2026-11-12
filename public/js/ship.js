// Загрузка модели корабля.
//  1) public/models/ship.obj — если файл есть, он имеет приоритет;
//  2) public/ship-model.json — описание из примитивов (по умолчанию).
// Обе модели можно править вручную, ничего пересобирать не нужно.

import { M4, hexToRgb } from './math.js';
import { boxGeometry, wedgeGeometry, cylinderGeometry, sphereGeometry, hullGeometry, wingGeometry } from './geometry.js';
import { createMesh } from './gl.js';

const DEG = Math.PI / 180;

function partGeometry(part) {
  const size = part.size || [1, 1, 1];
  switch (part.shape) {
    case 'wedge':
      return wedgeGeometry(size, part.tip ?? 0.25);
    case 'cylinder':
      return cylinderGeometry(size[0] / 2, size[2], part.segments ?? 16);
    case 'sphere':
      return sphereGeometry(size[0] / 2, size[1] / 2, size[2] / 2, part.segments ?? 20, part.rings ?? 12);
    case 'hull':
      return hullGeometry({
        length: size[2],
        width: size[0],
        height: size[1],
        sides: part.sides ?? 8,
        noseLength: part.noseLength ?? size[2] * 0.36,
        tailScale: part.tailScale ?? 0.7
      });
    case 'wing':
      return wingGeometry({
        span: size[0],
        chord: size[2],
        thickness: part.thickness ?? size[1],
        taper: part.taper ?? 0.42,
        sweep: part.sweep ?? 0.9,
        dihedral: part.dihedral ?? 0.14,
        stations: part.stations ?? 3
      });
    case 'box':
    default:
      return boxGeometry(size);
  }
}

function partMatrix(part) {
  const pos = part.pos || [0, 0, 0];
  const rot = (part.rot || [0, 0, 0]).map((d) => d * DEG);
  const scale = part.scale || [1, 1, 1];
  return M4.compose(pos, rot, scale);
}

export function parseOBJ(text) {
  const verts = [];
  const norms = [];
  const P = [];
  const N = [];

  const resolve = (raw, length) => {
    const i = parseInt(raw, 10);
    if (Number.isNaN(i)) return -1;
    return i < 0 ? length + i : i - 1;
  };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split(/\s+/);

    if (parts[0] === 'v') {
      verts.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0]);
    } else if (parts[0] === 'vn') {
      norms.push([Number(parts[1]) || 0, Number(parts[2]) || 0, Number(parts[3]) || 0]);
    } else if (parts[0] === 'f') {
      const face = parts.slice(1).map((token) => {
        const [v, , n] = token.split('/');
        return { v: resolve(v, verts.length), n: n ? resolve(n, norms.length) : -1 };
      }).filter((f) => f.v >= 0 && f.v < verts.length);

      for (let i = 1; i + 1 < face.length; i++) {
        const tri = [face[0], face[i], face[i + 1]];
        let normal = null;
        if (tri.every((t) => t.n >= 0 && t.n < norms.length)) {
          normal = norms[tri[0].n];
        } else {
          const a = verts[tri[0].v], b = verts[tri[1].v], c = verts[tri[2].v];
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          normal = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0]
          ];
        }
        const len = Math.hypot(normal[0], normal[1], normal[2]) || 1;
        for (const t of tri) {
          const p = verts[t.v];
          P.push(p[0], p[1], p[2]);
          N.push(normal[0] / len, normal[1] / len, normal[2] / len);
        }
      }
    }
  }

  if (!P.length) throw new Error('OBJ не содержит полигонов');

  // Приводим модель к удобному масштабу: центр в нуле, максимальный размер ~7.4
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], P[i + k]);
      max[k] = Math.max(max[k], P[i + k]);
    }
  }
  const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const k = 7.4 / extent;

  const positions = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) {
    positions[i] = (P[i] - center[0]) * k;
    positions[i + 1] = (P[i + 1] - center[1]) * k;
    positions[i + 2] = (P[i + 2] - center[2]) * k;
  }

  return { positions, normals: new Float32Array(N) };
}

// Плоский список треугольников меша (9 чисел на треугольник) в системе
// координат модели — нужен для точного попадания луча по астероиду.
function buildTriangleSoup(positions, indices) {
  const corners = indices ? indices.length : positions.length / 3;
  const soup = new Float32Array(corners * 3);

  for (let i = 0; i < corners; i++) {
    const vertex = indices ? indices[i] : i;
    soup[i * 3] = positions[vertex * 3];
    soup[i * 3 + 1] = positions[vertex * 3 + 1];
    soup[i * 3 + 2] = positions[vertex * 3 + 2];
  }

  return soup;
}

function concatSoups(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

async function loadBinaryModel(gl, manifestUrl, binUrl, id, options = {}) {
  const manifestText = await fetchOptional(manifestUrl);
  if (!manifestText) return null;

  const response = await fetch(binUrl, { cache: 'no-store' });
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();

  const manifest = JSON.parse(manifestText);

  // Наборы текстур грузим параллельно и один раз на набор.
  // У импортированных моделей обычно есть только albedo — не дёргаем 404.
  const textureMaps = manifest.textureMaps
    || (manifest.bytes ? ['base'] : ['base', 'rough', 'metal']);
  const setNames = [...new Set((manifest.groups || []).map((g) => g.texture).filter(Boolean))];
  const textureSets = {};
  await Promise.all(setNames.map(async (name) => {
    textureSets[name] = await loadTextureSet(gl, name, textureMaps);
  }));

  const triangleChunks = [];

  const parts = (manifest.groups || []).map((group) => {
    const positions = new Float32Array(buffer, group.positionByteOffset, group.vertexCount * 3);
    const normals = new Float32Array(buffer, group.normalByteOffset, group.vertexCount * 3);
    const uvs = new Float32Array(buffer, group.uvByteOffset, group.vertexCount * 2);
    const indices = new Uint16Array(buffer, group.indexByteOffset, group.indexCount);
    if (options.triangles) triangleChunks.push(buildTriangleSoup(positions, indices));
    return {
      name: group.name,
      mesh: createMesh(gl, { positions, normals, uvs, indices }),
      matrix: M4.identity(),
      color: hexToRgb(group.color || '#ffffff'),
      tint: group.tint ? hexToRgb(group.tint) : (id === 'corinth' ? [1.45, 1.4, 1.34] : [1, 1, 1]),
      emissive: group.glow ? hexToRgb(group.glow).map((c) => c * (group.glowIntensity ?? 1)) : [0, 0, 0],
      specular: group.specular ?? 1,
      metal: group.metal ?? 0.8,
      textureColor: Boolean(manifest.textureColor ?? manifest.bytes),
      material: textureSets[group.texture] || null
    };
  });

  const bounds = manifest.bounds || { min: [-4, -2, -7], max: [4, 2, 7] };
  const halfZ = Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2]));
  const width = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]);
  const shipRadius = Math.max(0.8, width * 0.5 * 0.85);

  return {
    id,
    name: manifest.name,
    source: id,
    length: manifest.length || 15,
    radius: manifest.radius || null,
    bounds,
    triangles: options.triangles ? concatSoups(triangleChunks) : null,
    nose: manifest.nose || [0, 0, -(manifest.length || 15) * 0.47],
    // Три сферы вдоль корпуса — грубое, но устойчивое приближение для столкновений
    collision: {
      radius: shipRadius,
      points: [[0, 0, -halfZ * 0.55], [0, 0, 0], [0, 0, halfZ * 0.55]]
    },
    parts,
    thrusters: manifest.thrusters || [{ pos: [0, 0, 7], size: 1.4 }]
  };
}

export { loadBinaryModel };

async function loadCorinth(gl) {
  return loadBinaryModel(gl, 'models/corinth.json', 'models/corinth.mesh.bin', 'corinth');
}

async function loadSpaceship(gl) {
  return loadBinaryModel(gl, 'models/spaceship.json', 'models/spaceship.mesh.bin', 'spaceship');
}

// Два астероида — статичные объекты сцены
export async function loadAsteroids(gl) {
  const ids = ['asteroid1', 'asteroid2'];
  const models = await Promise.all(ids.map((id) => loadBinaryModel(gl, `models/${id}.json`, `models/${id}.mesh.bin`, id, { triangles: true })));
  return models.filter(Boolean);
}

async function loadTextureSet(gl, name, maps = ['base', 'rough', 'metal']) {
  const hasRough = maps.includes('rough');
  const hasMetal = maps.includes('metal');

  const [albedo, rough, metal] = await Promise.all([
    loadTexture(gl, `textures/${name}/base.png`),
    hasRough ? loadTexture(gl, `textures/${name}/rough.png`) : null,
    hasMetal ? loadTexture(gl, `textures/${name}/metal.png`) : null
  ]);
  if (!albedo) return null;

  // У импортированных моделей часто есть только albedo: подставляем
  // однотонные карты, иначе шейдер сэмплит пустую текстуру в чёрный
  return {
    albedo,
    rough: rough || solidTexture(gl, 255, 255, 255),
    metal: metal || solidTexture(gl, 0, 0, 0)
  };
}

/** Однотонная 1×1 текстура на случай, если карты в наборе нет. */
function solidTexture(gl, r, g, b) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

async function loadTexture(gl, url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anisotropy) {
      const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }

    if (bitmap.close) bitmap.close();
    return texture;
  } catch (err) {
    console.warn('[ship] текстура не загружена:', url, err);
    return null;
  }
}

async function fetchOptional(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export const SHIP_MODELS = [
  { id: 'corinth', label: 'Corinth Cargo Transporter' },
  { id: 'spaceship', label: 'Space Cruiser' }
];

const modelCache = new Map();

// Модели кэшируются: переключение в паузе не перезагружает буферы
async function loadModelById(gl, id) {
  if (modelCache.has(id)) return modelCache.get(id);

  let model = null;
  if (id === 'spaceship') {
    model = await loadSpaceship(gl);
  } else {
    try {
      model = await loadCorinth(gl);
    } catch (err) {
      console.warn('[ship] не удалось загрузить Corinth:', err);
    }
  }

  if (model) modelCache.set(id, model);
  return model;
}

export async function loadShip(gl, modelId) {
  const configText = await fetchOptional('ship.config.json');
  const config = configText ? JSON.parse(configText) : {};
  const wanted = modelId || config.model || 'corinth';

  if (wanted !== 'spec') {
    try {
      const model = await loadModelById(gl, wanted);
      if (model) return model;
    } catch (err) {
      console.warn('[ship] модель не загружена, беру запасную:', err);
    }
  }

  if (wanted !== 'spec') {
    // 1. Ручная модель в формате OBJ (public/models/ship.obj)
    const objText = await fetchOptional('models/ship.obj');
    if (objText && objText.trim().length) {
      const geometry = parseOBJ(objText);
      const mesh = createMesh(gl, geometry);
      return {
        id: 'obj',
        name: 'ship.obj',
        source: 'obj',
        length: 7.4,
        parts: [{
          mesh,
          matrix: M4.identity(),
          color: hexToRgb('#aab4c6'),
          emissive: [0, 0, 0],
          specular: 1.0,
          metal: 0.6
        }],
        thrusters: [{ pos: [0, 0, 3.4], size: 1.1 }]
      };
    }
  }

  // 2. Описание из примитивов
  const jsonText = await fetchOptional('ship-model.json');
  if (!jsonText) throw new Error('Не найден ship-model.json');

  const spec = JSON.parse(jsonText);
  const parts = (spec.parts || []).map((part) => {
    const emissiveScale = part.emissive ?? 0;
    const color = hexToRgb(part.color);
    return {
      name: part.name || part.shape,
      mesh: createMesh(gl, partGeometry(part)),
      matrix: partMatrix(part),
      color,
      emissive: part.glow ? hexToRgb(part.glow).map((c) => c * (part.glowIntensity ?? 1)) : color.map((c) => c * emissiveScale),
      specular: part.specular ?? 1.0,
      metal: part.metal ?? 0.35
    };
  });

  const thrusters = (spec.thrusters || [{ pos: [0, 0, 3.2], size: 1.0 }]).map((t) => ({
    pos: t.pos || [0, 0, 3.2],
    size: t.size ?? 1.0
  }));

  return { id: 'spec', name: spec.name || 'ship-model.json', source: 'spec', length: 15, parts, thrusters };
}
