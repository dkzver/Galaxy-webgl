// Каркасная отрисовка для отладки и редактора: линии без материалов и текстур.
// Формат вершины — [x, y, z, r, g, b] (24 байта), как у отладочных линий в игре.

export function pushLine(vertices, from, to, color) {
  vertices.push(
    from[0], from[1], from[2], color[0], color[1], color[2],
    to[0], to[1], to[2], color[0], color[1], color[2]
  );
}

/**
 * Сетка сферы: меридианы и параллели. Так коллайдер читается как объём,
 * а не как набор колец, и остаётся чистой геометрией без заливки.
 */
export function pushWireSphere(vertices, center, radius, color, options = {}) {
  const meridians = options.meridians ?? 8;
  const parallels = options.parallels ?? 4;
  const segments = options.segments ?? 20;

  for (let m = 0; m < meridians; m++) {
    const angle = (m / meridians) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let previous = null;

    for (let i = 0; i <= segments; i++) {
      const phi = (i / segments) * Math.PI * 2;
      const point = [
        center[0] + Math.cos(phi) * radius * dx,
        center[1] + Math.sin(phi) * radius,
        center[2] + Math.cos(phi) * radius * dz
      ];

      if (previous) pushLine(vertices, previous, point, color);
      previous = point;
    }
  }

  for (let p = 1; p <= parallels; p++) {
    const latitude = (p / (parallels + 1)) * Math.PI - Math.PI / 2;
    const ringRadius = Math.cos(latitude) * radius;
    const y = center[1] + Math.sin(latitude) * radius;
    let previous = null;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const point = [
        center[0] + Math.cos(theta) * ringRadius,
        y,
        center[2] + Math.sin(theta) * ringRadius
      ];

      if (previous) pushLine(vertices, previous, point, color);
      previous = point;
    }
  }
}

const BOX_EDGES = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

/** Рёбра по восьми углам (порядок как в pushWireBoxCorners). */
export function pushWireBoxCorners(vertices, corners, color) {
  for (const [i, j] of BOX_EDGES) pushLine(vertices, corners[i], corners[j], color);
}

/** Локальный параллелепипед [min, max] с учётом матрицы трансформа. */
export function pushWireBox(vertices, min, max, color, matrix = null) {
  const corners = [];

  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push(matrix ? transformPoint(matrix, [x, y, z]) : [x, y, z]);
      }
    }
  }

  pushWireBoxCorners(vertices, corners, color);
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
  ];
}
