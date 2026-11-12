/**
 * @fileoverview Генерация сферических и гибридных коллайдеров.
 *
 * Сферы упаковываются по полю расстояний до внешнего пространства: сначала
 * берётся самый «глубокий» непокрытый воксель, затем — следующие. Это даёт
 * крупные сферы в объёме корпуса и мелкие — у тонких кромок.
 */

import { buildBoxColliderDetailed } from './box-collider.js';
import { meshBounds, voxelize } from './voxelizer.js';

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Поле расстояний (в шагах сетки) от каждого сплошного вокселя до ближайшего
 * внешнего. BFS по 26 соседям: углы не получают длинный путь вдоль оболочки.
 * @param {{solid: Uint8Array, outside?: Uint8Array, dims: number[]}} grid
 * @returns {Int32Array}
 */
export function distanceField(grid) {
  const [nx, ny, nz] = grid.dims;
  const total = nx * ny * nz;
  const distance = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < total; i++) {
    // Границей считаем внешнее пространство. Если маски outside нет
    // (старый вызов), подойдёт любой несплошной воксель.
    const boundary = grid.outside ? grid.outside[i] : !grid.solid[i];
    if (boundary) {
      distance[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const next = distance[i] + 1;
    const x = i % nx;
    const y = Math.floor(i / nx) % ny;
    const z = Math.floor(i / (nx * ny));

    // 26 соседей: так угловая клетка получает расстояние 1 от диагонально
    // близкого внешнего пространства, а не длинный путь вдоль оболочки.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          const zz = z + dz;
          if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) continue;
          const j = xx + nx * (yy + ny * zz);
          if (!grid.solid[j] || distance[j] !== -1) continue;
          distance[j] = next;
          queue[tail++] = j;
        }
      }
    }
  }

  return distance;
}

function countCovered(grid, covered) {
  let count = 0;
  for (let i = 0; i < grid.solid.length; i++) {
    if (grid.solid[i] && covered[i]) count++;
  }
  return count;
}

/**
 * Упаковывает сферы в сетку, не трогая уже покрытые воксели.
 * @param {{solid: Uint8Array, dims: number[], origin: number[], cell: number}} grid
 * @param {object} options
 * @param {number} options.maxSpheres
 * @param {number} options.margin
 * @param {{min: number[], max: number[]}} options.bounds
 * @param {Uint8Array} [options.covered] маска уже покрытых вокселей (изменяется)
 * @returns {{spheres: Array<{offset: number[], radius: number}>, covered: Uint8Array, fill: number}}
 */
function packGridSpheres(grid, options) {
  const [nx, ny, nz] = grid.dims;
  const total = nx * ny * nz;
  const covered = options.covered || new Uint8Array(total);
  const maxSpheres = Math.max(0, options.maxSpheres);
  const margin = options.margin;
  const bounds = options.bounds;
  const cell = grid.cell;
  const distance = distanceField(grid);

  const spheres = [];

  for (let iteration = 0; iteration < maxSpheres; iteration++) {
    let best = -1;
    let bestRadius = 0;

    for (let i = 0; i < total; i++) {
      if (!grid.solid[i] || covered[i]) continue;

      // Воксели за габаритами модели — это оболочка сетки, а не корпус:
      // не ставим в них сферы, иначе угол получает ложный огромный радиус.
      const cx = grid.origin[0] + (i % nx + 0.5) * cell;
      const cy = grid.origin[1] + (Math.floor(i / nx) % ny + 0.5) * cell;
      const cz = grid.origin[2] + (Math.floor(i / (nx * ny)) + 0.5) * cell;
      if (cx < bounds.min[0] || cy < bounds.min[1] || cz < bounds.min[2]
        || cx > bounds.max[0] || cy > bounds.max[1] || cz > bounds.max[2]) {
        covered[i] = 1;
        continue;
      }

      let radius = Math.max(cell * 0.5, (distance[i] - margin + 0.5) * cell);
      radius = Math.min(
        radius,
        cx - bounds.min[0],
        bounds.max[0] - cx,
        cy - bounds.min[1],
        bounds.max[1] - cy,
        cz - bounds.min[2],
        bounds.max[2] - cz
      );

      if (radius > bestRadius) {
        bestRadius = radius;
        best = i;
      }
    }

    if (best < 0 || bestRadius <= cell * 0.2) break;

    const x = best % nx;
    const y = Math.floor(best / nx) % ny;
    const z = Math.floor(best / (nx * ny));
    const center = [
      grid.origin[0] + (x + 0.5) * cell,
      grid.origin[1] + (y + 0.5) * cell,
      grid.origin[2] + (z + 0.5) * cell
    ];

    const radius = bestRadius;

    // Помечаем воксели, попавшие в сферу; перекрытие сфер допускается,
    // но уже покрытые клетки не выбираются повторно.
    const minX = Math.max(0, Math.floor((center[0] - radius - grid.origin[0]) / cell));
    const maxX = Math.min(nx - 1, Math.floor((center[0] + radius - grid.origin[0]) / cell));
    const minY = Math.max(0, Math.floor((center[1] - radius - grid.origin[1]) / cell));
    const maxY = Math.min(ny - 1, Math.floor((center[1] + radius - grid.origin[1]) / cell));
    const minZ = Math.max(0, Math.floor((center[2] - radius - grid.origin[2]) / cell));
    const maxZ = Math.min(nz - 1, Math.floor((center[2] + radius - grid.origin[2]) / cell));
    const radiusSq = radius * radius;

    for (let zz = minZ; zz <= maxZ; zz++) {
      for (let yy = minY; yy <= maxY; yy++) {
        for (let xx = minX; xx <= maxX; xx++) {
          const i = xx + nx * (yy + ny * zz);
          if (!grid.solid[i] || covered[i]) continue;
          const dx = grid.origin[0] + (xx + 0.5) * cell - center[0];
          const dy = grid.origin[1] + (yy + 0.5) * cell - center[1];
          const dz = grid.origin[2] + (zz + 0.5) * cell - center[2];
          if (dx * dx + dy * dy + dz * dz <= radiusSq) covered[i] = 1;
        }
      }
    }

    spheres.push({
      offset: center.map((value) => Math.round(value * 1000) / 1000),
      radius: Math.round(radius * 1000) / 1000
    });
  }

  return {
    spheres,
    covered,
    fill: grid.solidCount ? countCovered(grid, covered) / grid.solidCount : 0
  };
}

/**
 * Строит коллайдер из сфер по треугольникам меша.
 * @param {ArrayLike<number>} triangles
 * @param {object} [options]
 * @param {number} [options.detail=20] вокселей по длинной стороне
 * @param {number} [options.maxSpheres=12]
 * @param {number} [options.margin=0.2]
 * @param {boolean} [options.sealGaps=true]
 * @param {number} [options.sealRadius=3]
 * @returns {{spheres: Array<{offset: number[], radius: number}>, stats: object}}
 */
export function buildSphereCollider(triangles, options = {}) {
  const detail = clampInt(options.detail, 8, 48, 20);
  const maxSpheres = clampInt(options.maxSpheres, 1, 32, 12);
  const margin = Number.isFinite(options.margin) ? Math.min(0.5, Math.max(0, options.margin)) : 0.2;
  const sealGaps = options.sealGaps !== false;
  const sealRadius = Math.max(1, Math.min(6, Math.round(options.sealRadius ?? 3)));
  const bounds = meshBounds(triangles);

  if (!bounds) {
    return { spheres: [], stats: { detail: 0, cell: 0, grid: [0, 0, 0], spheres: 0, solidCells: 0, fill: 0, bounds } };
  }

  const maxDim = Math.max(bounds.size[0], bounds.size[1], bounds.size[2]) || 1;
  const grid = voxelize(triangles, bounds, maxDim / detail, { sealGaps, sealRadius });
  const packed = packGridSpheres(grid, { maxSpheres, margin, bounds });

  return {
    spheres: packed.spheres,
    stats: {
      detail: Math.round((maxDim / grid.cell) * 10) / 10,
      cell: grid.cell,
      grid: grid.dims.slice(),
      spheres: packed.spheres.length,
      solidCells: grid.solidCount,
      fill: packed.fill,
      sealed: grid.sealedCount || 0,
      bounds
    }
  };
}

/**
 * Собирает compound-коллайдер в одном из режимов.
 *
 * `hybrid` сначала покрывает крупные участки боксами, а остаток объёма
 * добивает сферами; общий бюджет частей не превышает `maxParts`.
 *
 * @param {ArrayLike<number>} triangles
 * @param {object} [options]
 * @param {'boxes'|'spheres'|'hybrid'} [options.mode='boxes']
 * @param {number} [options.maxParts=32]
 * @param {number} [options.detail=20]
 * @param {number} [options.margin=0.25]
 * @param {boolean} [options.sealGaps=true]
 * @param {number} [options.sealRadius=3]
 * @returns {{boxes: Array<{offset: number[], halfExtents: number[]}>, spheres: Array<{offset: number[], radius: number}>, stats: object}}
 */
export function buildCompoundCollider(triangles, options = {}) {
  const mode = ['boxes', 'spheres', 'hybrid'].includes(options.mode) ? options.mode : 'boxes';
  const maxParts = clampInt(options.maxParts, 1, 32, 32);
  const detail = clampInt(options.detail, 8, 48, 20);
  const margin = Number.isFinite(options.margin) ? Math.min(0.5, Math.max(0, options.margin)) : 0.25;
  const sealGaps = options.sealGaps !== false;
  const sealRadius = Math.max(1, Math.min(6, Math.round(options.sealRadius ?? 3)));
  const bounds = meshBounds(triangles);

  if (!bounds) {
    return {
      boxes: [],
      spheres: [],
      stats: { mode, parts: 0, boxes: 0, spheres: 0, detail: 0, cell: 0, grid: [0, 0, 0], solidCells: 0, fill: 0, bounds }
    };
  }

  if (mode === 'boxes') {
    const result = buildBoxColliderDetailed(triangles, { detail, maxBoxes: maxParts, margin, sealGaps, sealRadius });
    return {
      boxes: result.boxes,
      spheres: [],
      stats: { ...result.stats, mode, parts: result.boxes.length, boxes: result.boxes.length, spheres: 0 }
    };
  }

  if (mode === 'spheres') {
    const result = buildSphereCollider(triangles, { detail, maxSpheres: maxParts, margin, sealGaps, sealRadius });
    return {
      boxes: [],
      spheres: result.spheres,
      stats: { ...result.stats, mode, parts: result.spheres.length, boxes: 0, spheres: result.spheres.length }
    };
  }

  const maxDim = Math.max(bounds.size[0], bounds.size[1], bounds.size[2]) || 1;
  const grid = voxelize(triangles, bounds, maxDim / detail, { sealGaps, sealRadius });
  const boxBudget = Math.max(1, Math.min(maxParts - 1, Math.ceil(maxParts * 0.6)));
  const boxResult = buildBoxColliderDetailed(triangles, {
    detail,
    maxBoxes: boxBudget,
    margin,
    sealGaps,
    sealRadius,
    grid
  });

  const [nx, ny, nz] = grid.dims;
  const cell = grid.cell;
  const covered = new Uint8Array(nx * ny * nz);

  // Покрытие считаем по итоговым мировым боксам, а не по сырым воксельным:
  // часть сырых брусков отбрасывается при сжатии, и сферы не должны считать
  // эти клетки закрытыми.
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const i = x + nx * (y + ny * z);
        if (!grid.solid[i]) continue;

        const px = grid.origin[0] + (x + 0.5) * cell;
        const py = grid.origin[1] + (y + 0.5) * cell;
        const pz = grid.origin[2] + (z + 0.5) * cell;

        for (const box of boxResult.boxes) {
          if (Math.abs(px - box.offset[0]) <= box.halfExtents[0] + 1e-6
            && Math.abs(py - box.offset[1]) <= box.halfExtents[1] + 1e-6
            && Math.abs(pz - box.offset[2]) <= box.halfExtents[2] + 1e-6) {
            covered[i] = 1;
            break;
          }
        }
      }
    }
  }

  const sphereBudget = Math.max(0, maxParts - boxResult.boxes.length);
  const packed = sphereBudget > 0
    ? packGridSpheres(grid, { maxSpheres: sphereBudget, margin, bounds, covered })
    : { spheres: [], covered, fill: boxResult.stats.fill };

  const fill = grid.solidCount ? countCovered(grid, covered) / grid.solidCount : 0;

  return {
    boxes: boxResult.boxes,
    spheres: packed.spheres,
    stats: {
      mode,
      parts: boxResult.boxes.length + packed.spheres.length,
      boxes: boxResult.boxes.length,
      spheres: packed.spheres.length,
      detail: boxResult.stats.detail,
      cell: grid.cell,
      grid: grid.dims.slice(),
      solidCells: grid.solidCount,
      fill,
      sealed: grid.sealedCount || 0,
      bounds
    }
  };
}
