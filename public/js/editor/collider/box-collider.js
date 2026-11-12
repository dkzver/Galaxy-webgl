/**
 * @fileoverview Сборка compound-коллайдера из боксов по треугольникам меша.
 *
 * Оркестрация: вокселизация → лучшее жадное покрытие → слияние → сжатие
 * до габаритов. Все функции чистые, пригодны для Node.js.
 */

import { coverSolid, mergeAligned, mergeNeighbours } from './box-merger.js';
import { meshBounds, voxelize } from './voxelizer.js';

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Выбирает порядок осей не по «сырому» покрытию, а по качеству после
 * сокращения до лимита: заполнение важнее числа боксов.
 * @param {{solid: Uint8Array, dims: number[]}} grid
 * @param {number} maxBoxes
 * @returns {{boxes: Array<{min: number[], max: number[]}>, order: number[], fill: number}}
 */
function bestCoverForLimit(grid, maxBoxes) {
  const orders = [
    [0, 2, 1],
    [2, 0, 1],
    [2, 1, 0],
    [0, 1, 2],
    [1, 2, 0],
    [1, 0, 2]
  ];

  let best = null;

  for (const order of orders) {
    let boxes = mergeAligned(coverSolid(grid, order));
    if (boxes.length > maxBoxes) boxes = mergeNeighbours(boxes, maxBoxes, 0.3);
    const fill = measureFill(grid, boxes);

    if (!best
      || fill.fill > best.fill + 1e-9
      || (Math.abs(fill.fill - best.fill) <= 1e-9 && boxes.length < best.boxes.length)
      || (Math.abs(fill.fill - best.fill) <= 1e-9 && boxes.length === best.boxes.length && fill.boxCells < best.boxCells)) {
      best = { boxes, order, fill: fill.fill, boxCells: fill.boxCells };
    }
  }

  return best || { boxes: [], order: [0, 2, 1], fill: 0 };
}

/**
 * Переводит воксельные бруски в мировые боксы, подрезая их по габаритам.
 * @param {{origin: number[], cell: number}} grid
 * @param {Array<{min: number[], max: number[]}>} boxes
 * @param {{min: number[], max: number[]}} bounds
 * @param {number} margin доля ячейки, снимаемая с каждой стороны
 * @returns {Array<{offset: number[], halfExtents: number[]}>}
 */
function convertBoxes(grid, boxes, bounds, margin) {
  const shrink = grid.cell * margin;
  const out = [];

  for (const box of boxes) {
    const lo = [0, 1, 2].map((axis) => Math.max(bounds.min[axis], grid.origin[axis] + box.min[axis] * grid.cell));
    const hi = [0, 1, 2].map((axis) => Math.min(bounds.max[axis], grid.origin[axis] + box.max[axis] * grid.cell));

    let valid = true;
    const halfExtents = [0, 1, 2].map((axis) => {
      const half = (hi[axis] - lo[axis]) / 2 - shrink;
      if (!(half > 0.005)) valid = false;
      return Math.max(0.01, half);
    });

    if (!valid) continue;

    out.push({
      offset: [0, 1, 2].map((axis) => Math.round(((lo[axis] + hi[axis]) / 2) * 1000) / 1000),
      halfExtents: halfExtents.map((value) => Math.round(value * 1000) / 1000)
    });
  }

  return out;
}

/**
 * Заполнение: какая доля объёма боксов реально занята корпусом.
 * @param {{dims: number[]}} grid
 * @param {Array<{min: number[], max: number[]}>} boxes
 * @returns {{coveredCells: number, boxCells: number, fill: number}}
 */
export function measureFill(grid, boxes) {
  const [nx, ny, nz] = grid.dims;
  const covered = new Uint8Array(nx * ny * nz);
  let coveredCells = 0;
  let boxCells = 0;

  for (const box of boxes) {
    const w = box.max[0] - box.min[0];
    const h = box.max[1] - box.min[1];
    const d = box.max[2] - box.min[2];
    boxCells += w * h * d;

    for (let z = box.min[2]; z < box.max[2]; z++) {
      for (let y = box.min[1]; y < box.max[1]; y++) {
        for (let x = box.min[0]; x < box.max[0]; x++) {
          const i = x + nx * (y + ny * z);
          if (covered[i]) continue;
          covered[i] = 1;
          coveredCells++;
        }
      }
    }
  }

  return {
    coveredCells,
    boxCells,
    fill: boxCells ? coveredCells / boxCells : 0
  };
}

/**
 * Полная сборка с доступом к промежуточной сетке — нужна гибридному режиму.
 * @param {ArrayLike<number>} triangles
 * @param {object} [options]
 * @param {number} [options.detail=16]
 * @param {number} [options.maxBoxes=32]
 * @param {number} [options.margin=0.35]
 * @param {boolean} [options.sealGaps=true]
 * @param {number} [options.sealRadius=3]
 * @param {object} [options.grid] готовая сетка (чтобы не вокселизировать дважды)
 * @returns {{boxes: Array<{offset: number[], halfExtents: number[]}>, grid: object, gridBoxes: Array<{min: number[], max: number[]}>, stats: object}}
 */
export function buildBoxColliderDetailed(triangles, options = {}) {
  const maxBoxes = clampInt(options.maxBoxes, 1, 32, 32);
  const detail = clampInt(options.detail, 4, 64, 16);
  const margin = Number.isFinite(options.margin) ? Math.min(0.5, Math.max(0, options.margin)) : 0.35;
  const sealGaps = options.sealGaps !== false;
  const sealRadius = Math.max(1, Math.min(6, Math.round(options.sealRadius ?? 3)));

  const bounds = meshBounds(triangles);
  const empty = {
    boxes: [],
    grid: null,
    gridBoxes: [],
    stats: {
      detail: 0,
      cell: 0,
      grid: [0, 0, 0],
      boxes: 0,
      solidCells: 0,
      fill: 0,
      passes: 0,
      sealed: 0,
      bounds
    }
  };

  if (!bounds) return empty;

  const maxDim = Math.max(bounds.size[0], bounds.size[1], bounds.size[2]) || 1;
  let grid = options.grid || voxelize(triangles, bounds, maxDim / detail, { sealGaps, sealRadius });
  let cover = bestCoverForLimit(grid, maxBoxes).boxes;
  let passes = 0;

  // Если боксов слишком много — сначала сливаем соседей, затем огрубляем сетку.
  while (cover.length > maxBoxes && passes < 8) {
    if (cover.length <= maxBoxes * 3) {
      cover = mergeNeighbours(cover, maxBoxes, 0.3);
      if (cover.length <= maxBoxes) break;
    }

    if (Math.min(grid.dims[0], grid.dims[1], grid.dims[2]) <= 3) break;

    grid = voxelize(triangles, bounds, grid.cell * 2, { sealGaps, sealRadius });
    cover = bestCoverForLimit(grid, maxBoxes).boxes;
    passes++;
  }

  // Крайний случай: даже на грубой сетке боксов больше лимита.
  if (cover.length > maxBoxes) cover = mergeNeighbours(cover, maxBoxes, 1);

  const fill = measureFill(grid, cover);
  const boxes = convertBoxes(grid, cover, bounds, margin);

  return {
    boxes,
    grid,
    gridBoxes: cover,
    stats: {
      detail: Math.round((maxDim / grid.cell) * 10) / 10,
      cell: grid.cell,
      grid: grid.dims.slice(),
      boxes: boxes.length,
      solidCells: grid.solidCount,
      fill: fill.fill,
      passes,
      sealed: grid.sealedCount || 0,
      bounds
    }
  };
}

/**
 * Публичная сборка compound-коллайдера из боксов.
 * @param {ArrayLike<number>} triangles
 * @param {object} [options]
 * @param {number} [options.detail=16] вокселей по длинной стороне
 * @param {number} [options.maxBoxes=32]
 * @param {number} [options.margin=0.35]
 * @param {boolean} [options.sealGaps=true]
 * @param {number} [options.sealRadius=3]
 * @returns {{boxes: Array<{offset: number[], halfExtents: number[]}>, stats: object}}
 */
export function buildBoxCollider(triangles, options = {}) {
  const result = buildBoxColliderDetailed(triangles, options);
  return { boxes: result.boxes, stats: result.stats };
}
