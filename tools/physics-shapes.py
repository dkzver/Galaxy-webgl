import io
import re

path = 'public/js/physics.js'
raw = io.open(path, encoding='utf-8', newline='').read()
crlf = '\r\n' in raw
src = raw.replace('\r\n', '\n')

def cut(text, start_marker, end_marker, replacement, label):
    i = text.find(start_marker)
    if i < 0:
        raise SystemExit(f'{label}: start not found')
    j = text.find(end_marker, i)
    if j < 0:
        raise SystemExit(f'{label}: end not found')
    return text[:i] + replacement + text[j:]

# ---------------------------------------------------------------- shapes ---

shapes = '''/**
 * Составной коллайдер: сферы и/или боксы. Смещения задаются в локальных
 * координатах тела и поворачиваются вместе с его кватернионом; у бокса
 * полуразмеры тоже локальные.
 *
 * Часть описывается либо как сфера `{ offset, radius }`, либо как бокс
 * `{ type: 'box', offset, halfExtents }`.
 *
 * @param {Array<{type?: string, offset?: number[], radius?: number, halfExtents?: number[]}>} parts
 */
export function compoundShape(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('compoundShape: нужен непустой массив частей');
  }

  const spheres = [];
  const boxes = [];

  parts.forEach((part, index) => {
    const isBox = part?.type === 'box' || Array.isArray(part?.halfExtents);
    const offset = toVec3(part?.offset);

    if (isBox) {
      const half = toVec3(part.halfExtents);
      if (!(half[0] > 0 && half[1] > 0 && half[2] > 0)) {
        throw new Error(`compoundShape: у бокса ${index} полуразмеры должны быть больше нуля`);
      }
      boxes.push({ offset, halfExtents: half });
      return;
    }

    const radius = numberOr(part?.radius, 0);
    if (!(radius > 0)) {
      throw new Error(`compoundShape: у сферы ${index} радиус должен быть больше нуля`);
    }
    spheres.push({ offset, radius });
  });

  const boundingRadius = [...spheres, ...boxes].reduce((max, part) => {
    const [x, y, z] = part.offset;
    const reach = part.radius ?? Math.hypot(
      part.halfExtents[0],
      part.halfExtents[1],
      part.halfExtents[2]
    );
    return Math.max(max, Math.hypot(x, y, z) + reach);
  }, 0);

  return { type: 'compound', spheres, boxes, boundingRadius };
}

'''

src = cut(
    src,
    '/**\n * Составной коллайдер из нескольких сфер.',
    '/**\n * Коллайдер-параллелепипед (OBB).',
    shapes,
    'compoundShape'
)

box = '''/**
 * Коллайдер-параллелепипед (OBB). Полуразмеры задаются в локальных осях
 * тела и поворачиваются вместе с его кватернионом, поэтому куб можно
 * вращать — контакт считается по текущей ориентации.
 *
 * @param {number[]} halfExtents полуразмеры [hx, hy, hz], каждый больше нуля
 */
export function boxShape(halfExtents) {
  const half = toVec3(halfExtents);
  if (!(half[0] > 0 && half[1] > 0 && half[2] > 0)) {
    throw new Error('boxShape: полуразмеры должны быть больше нуля');
  }
  return {
    type: 'box',
    halfExtents: half,
    spheres: [],
    boxes: [{ offset: [0, 0, 0], halfExtents: half }],
    boundingRadius: Math.hypot(half[0], half[1], half[2])
  };
}

/** Локальные сферы тела: у простого бокса их нет. */
function localSpheres(body) {
  const shape = body.shape;
  if (!shape || shape.type === 'box') return [];
  return shape.spheres || [];
}

/** Локальные боксы тела: у простого бокса — он сам. */
function localBoxes(body) {
  const shape = body.shape;
  if (!shape) return [];
  if (shape.type === 'box') return [{ offset: [0, 0, 0], halfExtents: shape.halfExtents }];
  return shape.boxes || [];
}

/** Мировая точка по локальному смещению тела. */
function worldPoint(body, offset) {
  const rotated = quatRotate(body.quaternion, offset);
  return [
    body.position[0] + rotated[0],
    body.position[1] + rotated[1],
    body.position[2] + rotated[2]
  ];
}

'''
src = cut(
    src,
    '/**\n * Коллайдер-параллелепипед (OBB).',
    'function sphereCenter(body, sphere) {',
    box,
    'boxShape'
)

# --------------------------------------------------------- box ↔ sphere ---

box_sphere = '''/**
 * Геометрия контакта сферы с боксом. Бокс задаётся частью тела: смещение
 * и полуразмеры — в локальных осях. Возвращает нормаль «от бокса к сфере»,
 * точку на поверхности бокса и глубину проникновения.
 *
 * @returns {{outward: number[], point: number[], penetration: number}|null}
 */
function boxSphereContact(boxBody, boxPart, sphereBody, sphere) {
  const half = boxPart.halfExtents;
  const inverse = quatConjugate(boxBody.quaternion);
  const center = worldPoint(sphereBody, sphere.offset);
  const local = quatRotate(inverse, [
    center[0] - boxBody.position[0],
    center[1] - boxBody.position[1],
    center[2] - boxBody.position[2]
  ]);

  const relative = [
    local[0] - boxPart.offset[0],
    local[1] - boxPart.offset[1],
    local[2] - boxPart.offset[2]
  ];

  const closest = [
    clamp(relative[0], -half[0], half[0]),
    clamp(relative[1], -half[1], half[1]),
    clamp(relative[2], -half[2], half[2])
  ];

  const dx = relative[0] - closest[0];
  const dy = relative[1] - closest[1];
  const dz = relative[2] - closest[2];
  const distance = Math.hypot(dx, dy, dz);
  let normalLocal;
  let penetration;

  if (distance > 1e-6) {
    if (distance >= sphere.radius) return null;
    normalLocal = [dx / distance, dy / distance, dz / distance];
    penetration = sphere.radius - distance;
  } else {
    // Центр сферы внутри бокса: ближайшая грань задаёт направление выталкивания
    const faces = [
      { axis: 0, sign: 1, depth: half[0] - relative[0] },
      { axis: 0, sign: -1, depth: half[0] + relative[0] },
      { axis: 1, sign: 1, depth: half[1] - relative[1] },
      { axis: 1, sign: -1, depth: half[1] + relative[1] },
      { axis: 2, sign: 1, depth: half[2] - relative[2] },
      { axis: 2, sign: -1, depth: half[2] + relative[2] }
    ];

    let nearest = faces[0];
    for (const face of faces) if (face.depth < nearest.depth) nearest = face;

    normalLocal = [0, 0, 0];
    normalLocal[nearest.axis] = nearest.sign;
    closest[nearest.axis] = nearest.sign * half[nearest.axis];
    penetration = sphere.radius + nearest.depth;
  }

  const offset = quatRotate(boxBody.quaternion, [
    closest[0] + boxPart.offset[0],
    closest[1] + boxPart.offset[1],
    closest[2] + boxPart.offset[2]
  ]);

  return {
    outward: quatRotate(boxBody.quaternion, normalLocal),
    point: [
      boxBody.position[0] + offset[0],
      boxBody.position[1] + offset[1],
      boxBody.position[2] + offset[2]
    ],
    penetration
  };
}

const BOX_AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function verticesOf(center, axes, half) {
  const points = [];
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const s = [sx * half[0], sy * half[1], sz * half[2]];
        points.push([
          center[0] + axes[0][0] * s[0] + axes[1][0] * s[1] + axes[2][0] * s[2],
          center[1] + axes[0][1] * s[0] + axes[1][1] * s[1] + axes[2][1] * s[2],
          center[2] + axes[0][2] * s[0] + axes[1][2] * s[1] + axes[2][2] * s[2]
        ]);
      }
    }
  }
  return points;
}

function insideBox(point, center, axes, half) {
  for (let i = 0; i < 3; i++) {
    const axis = axes[i];
    const local =
      (point[0] - center[0]) * axis[0] +
      (point[1] - center[1]) * axis[1] +
      (point[2] - center[2]) * axis[2];
    if (Math.abs(local) > half[i] + 1e-4) return false;
  }
  return true;
}

/**
 * Пересечение двух OBB (теорема о разделяющей оси). Возвращает нормаль
 * «от A к B», глубину минимального перекрытия и точки контакта —
 * вершины, попавшие внутрь соседа (для устойчивого «лежания» куба).
 *
 * @returns {{normal: number[], overlap: number, points: number[][]}|null}
 */
function boxBoxGeometry(bodyA, partA, bodyB, partB) {
  const axesA = BOX_AXES.map((axis) => quatRotate(bodyA.quaternion, axis));
  const axesB = BOX_AXES.map((axis) => quatRotate(bodyB.quaternion, axis));
  const centerA = worldPoint(bodyA, partA.offset);
  const centerB = worldPoint(bodyB, partB.offset);

  const hA = partA.halfExtents;
  const hB = partB.halfExtents;

  const d = [centerB[0] - centerA[0], centerB[1] - centerA[1], centerB[2] - centerA[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const absR = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = dot(axesA[i], axesB[j]);
      absR[i][j] = Math.abs(R[i][j]) + 1e-6;
    }
  }

  const t = [dot(d, axesA[0]), dot(d, axesA[1]), dot(d, axesA[2])];

  let best = null;
  const consider = (axis, overlap) => {
    if (overlap <= 0) return false;
    if (!best || overlap < best.overlap) best = { axis, overlap };
    return true;
  };

  for (let i = 0; i < 3; i++) {
    const reach = hB[0] * absR[i][0] + hB[1] * absR[i][1] + hB[2] * absR[i][2];
    if (!consider(axesA[i], hA[i] + reach - Math.abs(t[i]))) return null;
  }

  for (let j = 0; j < 3; j++) {
    const distance = Math.abs(t[0] * R[0][j] + t[1] * R[1][j] + t[2] * R[2][j]);
    const reach = hA[0] * absR[0][j] + hA[1] * absR[1][j] + hA[2] * absR[2][j];
    if (!consider(axesB[j], reach + hB[j] - distance)) return null;
  }

  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;

    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3;
      const j2 = (j + 2) % 3;

      const axis = [
        axesA[i1][1] * axesB[j][2] - axesA[i1][2] * axesB[j][1],
        axesA[i1][2] * axesB[j][0] - axesA[i1][0] * axesB[j][2],
        axesA[i1][0] * axesB[j][1] - axesA[i1][1] * axesB[j][0]
      ];

      const length = Math.hypot(axis[0], axis[1], axis[2]);
      if (length < 1e-5) continue;

      const unit = [axis[0] / length, axis[1] / length, axis[2] / length];
      const reachA = hA[i1] * absR[i2][j] + hA[i2] * absR[i1][j];
      const reachB = hB[j1] * absR[i][j2] + hB[j2] * absR[i][j1];

      if (!consider(unit, reachA + reachB - Math.abs(dot(d, unit)))) return null;
    }
  }

  if (!best) return null;

  let normal = best.axis.slice();
  if (dot(normal, d) < 0) normal = [-normal[0], -normal[1], -normal[2]];

  const vertsA = verticesOf(centerA, axesA, hA);
  const vertsB = verticesOf(centerB, axesB, hB);

  const points = [];
  for (const point of vertsA) {
    if (insideBox(point, centerB, axesB, hB)) points.push(point);
  }
  for (const point of vertsB) {
    if (insideBox(point, centerA, axesA, hA)) points.push(point);
  }

  if (!points.length) {
    points.push([
      (centerA[0] + centerB[0]) / 2,
      (centerA[1] + centerB[1]) / 2,
      (centerA[2] + centerB[2]) / 2
    ]);
  }

  return { normal, overlap: best.overlap, points };
}

'''
src = cut(
    src,
    '/**\n * Геометрия контакта одной сферы с параллелепипедом.',
    '/**\n * Мировые центры и радиусы сфер тела.',
    box_sphere,
    'boxSphereContact'
)

# ------------------------------------------------------------ debug view ---

world_boxes = '''/**
 * Мировые габариты боксов тела. Удобно для отладки и запросов.
 * @returns {Array<{center: number[], halfExtents: number[], quaternion: number[]}>}
 */
export function getWorldBoxes(body) {
  return localBoxes(body).map((part) => ({
    center: worldPoint(body, part.offset),
    halfExtents: part.halfExtents.slice(),
    quaternion: body.quaternion.slice()
  }));
}

'''
src = cut(
    src,
    '/* --------------------------------- Тело ---------------------------------- */',
    '/* --------------------------------- Тело ---------------------------------- */',
    world_boxes,
    'getWorldBoxes'
)

if crlf:
    src = src.replace('\n', '\r\n')
io.open(path, 'w', encoding='utf-8', newline='').write(src)
print('physics shapes updated')
