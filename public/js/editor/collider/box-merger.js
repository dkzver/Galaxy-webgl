/**
 * @fileoverview Покрытие сплошного воксельного объёма брусками.
 *
 * Жадный проход умеет начинать рост с любой оси, а `bestGreedyCover`
 * перебирает шесть порядков и выбирает вариант с меньшим числом боксов.
 * Модуль чистый: ни DOM, ни WebGL.
 */

const EPS = 1e-6;

/**
 * Объём бруска в вокселях.
 * @param {{min: number[], max: number[]}} box
 * @returns {number}
 */
export function volume(box) {
  return (box.max[0] - box.min[0]) * (box.max[1] - box.min[1]) * (box.max[2] - box.min[2]);
}

/**
 * Объединение двух брусков.
 * @param {{min: number[], max: number[]}} a
 * @param {{min: number[], max: number[]}} b
 * @returns {{min: number[], max: number[]}}
 */
export function unionBox(a, b) {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])]
  };
}

/**
 * Свободна ли плоскость `plane` по оси `axis` внутри текущего бруска.
 * @param {{solid: Uint8Array, dims: number[]}} grid
 * @param {Uint8Array} used
 * @param {number[]} min
 * @param {number[]} max
 * @param {number} axis
 * @param {number} plane
 * @returns {boolean}
 */
function planeFree(grid, used, min, max, axis, plane) {
  const [nx, ny, nz] = grid.dims;
  const a1 = (axis + 1) % 3;
  const a2 = (axis + 2) % 3;

  for (let u = min[a1]; u < max[a1]; u++) {
    for (let v = min[a2]; v < max[a2]; v++) {
      const point = [0, 0, 0];
      point[axis] = plane;
      point[a1] = u;
      point[a2] = v;
      const i = point[0] + nx * (point[1] + ny * point[2]);
      if (!grid.solid[i] || used[i]) return false;
    }
  }

  return true;
}

/**
 * Жадное покрытие объёма брусками.
 * @param {{solid: Uint8Array, dims: number[]}} grid
 * @param {number[]} [axisOrder] порядок роста осей, например [0, 2, 1] — X, Z, Y
 * @returns {Array<{min: number[], max: number[]}>}
 */
export function coverSolid(grid, axisOrder = [0, 2, 1]) {
  const [nx, ny, nz] = grid.dims;
  const dims = grid.dims;
  const { solid } = grid;
  const index = (x, y, z) => x + nx * (y + ny * z);
  const used = new Uint8Array(nx * ny * nz);
  const boxes = [];

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const start = index(x, y, z);
        if (!solid[start] || used[start]) continue;

        const min = [x, y, z];
        const max = [x + 1, y + 1, z + 1];

        for (const axis of axisOrder) {
          while (max[axis] < dims[axis] && planeFree(grid, used, min, max, axis, max[axis])) {
            max[axis]++;
          }
        }

        for (let dz = min[2]; dz < max[2]; dz++) {
          for (let dy = min[1]; dy < max[1]; dy++) {
            for (let dx = min[0]; dx < max[0]; dx++) {
              used[index(dx, dy, dz)] = 1;
            }
          }
        }

        boxes.push({ min, max });
      }
    }
  }

  return boxes;
}

/**
 * Слияние брусков с одинаковым сечением по двум осям и стыком по третьей.
 * @param {Array<{min: number[], max: number[]}>} boxes
 * @param {number} axis
 * @returns {Array<{min: number[], max: number[]}>}
 */
function mergeAxis(boxes, axis) {
  const a1 = (axis + 1) % 3;
  const a2 = (axis + 2) % 3;
  const groups = new Map();

  for (const box of boxes) {
    const key = `${box.min[a1]},${box.max[a1]},${box.min[a2]},${box.max[a2]}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(box);
  }

  const out = [];

  for (const group of groups.values()) {
    group.sort((a, b) => a.min[axis] - b.min[axis]);
    let current = { min: group[0].min.slice(), max: group[0].max.slice() };

    for (let i = 1; i < group.length; i++) {
      const box = group[i];
      if (box.min[axis] <= current.max[axis] + EPS) {
        if (box.max[axis] > current.max[axis]) current.max[axis] = box.max[axis];
      } else {
        out.push(current);
        current = { min: box.min.slice(), max: box.max.slice() };
      }
    }

    out.push(current);
  }

  return out;
}

/**
 * Повторяет слияние по трём осям до стабилизации.
 * @param {Array<{min: number[], max: number[]}>} boxes
 * @returns {Array<{min: number[], max: number[]}>}
 */
export function mergeAligned(boxes) {
  let list = boxes;

  for (let round = 0; round < 8; round++) {
    const before = list.length;
    list = mergeAxis(mergeAxis(mergeAxis(list, 0), 1), 2);
    if (list.length === before) break;
  }

  return list;
}

function touches(a, b) {
  for (let axis = 0; axis < 3; axis++) {
    if (b.min[axis] > a.max[axis] + EPS || a.min[axis] > b.max[axis] + EPS) return false;
  }
  return true;
}

/**
 * Сокращает число боксов, сливая только соприкасающиеся пары и только если
 * пустой объём в объединении не больше `maxWaste` доли.
 * @param {Array<{min: number[], max: number[]}>} boxes
 * @param {number} limit
 * @param {number} maxWaste
 * @returns {Array<{min: number[], max: number[]}>}
 */
export function mergeNeighbours(boxes, limit, maxWaste) {
  const list = boxes.map((box) => ({ min: box.min.slice(), max: box.max.slice() }));

  while (list.length > limit) {
    let best = null;

    for (let i = 0; i < list.length; i++) {
      const a = list[i];

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!touches(a, b)) continue;

        const union = unionBox(a, b);
        const unionVolume = volume(union);
        const waste = unionVolume - volume(a) - volume(b);
        if (waste < -EPS) continue;

        const ratio = waste / Math.max(EPS, unionVolume);
        if (ratio > maxWaste) continue;

        if (!best || ratio < best.ratio) best = { i, j, union, ratio };
      }
    }

    if (!best) break;

    list[best.i] = best.union;
    list.splice(best.j, 1);
  }

  return list;
}

/**
 * Перебирает шесть порядков роста осей и выбирает покрытие с минимальным
 * числом брусков, а при равенстве — с минимальным суммарным объёмом.
 * @param {{solid: Uint8Array, dims: number[]}} grid
 * @returns {{boxes: Array<{min: number[], max: number[]}>, order: number[], volume: number}}
 */
export function bestGreedyCover(grid) {
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
    const boxes = mergeAligned(coverSolid(grid, order));
    const total = boxes.reduce((sum, box) => sum + volume(box), 0);

    if (!best
      || boxes.length < best.boxes.length
      || (boxes.length === best.boxes.length && total < best.volume)) {
      best = { boxes, order, volume: total };
    }
  }

  return best || { boxes: [], order: [0, 2, 1], volume: 0 };
}
