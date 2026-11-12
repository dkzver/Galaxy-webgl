// Процедурные меши с плоскими нормалями (гранёный, «авиационный» вид).

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

// Четырёхугольник с автоматическим выбором внешней нормали:
// меши строятся вокруг локального нуля, поэтому нормаль «наружу» = от центра.
function quad(P, N, a, b, c, d) {
  let n = cross(sub(b, a), sub(c, a));
  if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = cross(sub(c, a), sub(d, a));
  n = norm(n);
  const center = [
    (a[0] + b[0] + c[0] + d[0]) / 4,
    (a[1] + b[1] + c[1] + d[1]) / 4,
    (a[2] + b[2] + c[2] + d[2]) / 4
  ];
  if (dot(n, center) < 0) n = [-n[0], -n[1], -n[2]];

  for (const tri of [[a, b, c], [a, c, d]]) {
    for (const p of tri) {
      P.push(p[0], p[1], p[2]);
      N.push(n[0], n[1], n[2]);
    }
  }
}

function result(P, N) {
  return { positions: new Float32Array(P), normals: new Float32Array(N) };
}

export function boxGeometry(size = [1, 1, 1]) {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const P = [], N = [];
  quad(P, N, [hx, hy, hz], [hx, -hy, hz], [-hx, -hy, hz], [-hx, hy, hz]);   // +Z
  quad(P, N, [-hx, hy, -hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz]); // -Z
  quad(P, N, [hx, hy, hz], [hx, hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]);     // +X
  quad(P, N, [-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, hz], [-hx, -hy, -hz]); // -X
  quad(P, N, [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]);     // +Y
  quad(P, N, [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]); // -Y
  return result(P, N);
}

// Клин: задняя часть (+Z) полного сечения, нос (-Z) сжат в tip.
export function wedgeGeometry(size = [1, 1, 1], tip = 0.25) {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const tx = hx * tip, ty = hy * tip;
  const P = [], N = [];

  quad(P, N, [-tx, ty, -hz], [tx, ty, -hz], [tx, -ty, -hz], [-tx, -ty, -hz]);   // нос
  quad(P, N, [-hx, hy, hz], [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz]);       // корма
  quad(P, N, [-hx, hy, hz], [hx, hy, hz], [tx, ty, -hz], [-tx, ty, -hz]);       // верх
  quad(P, N, [-hx, -hy, hz], [-tx, -ty, -hz], [tx, -ty, -hz], [hx, -hy, hz]);   // низ
  quad(P, N, [hx, hy, hz], [hx, -hy, hz], [tx, -ty, -hz], [tx, ty, -hz]);       // правый борт
  quad(P, N, [-hx, hy, hz], [-tx, ty, -hz], [-tx, -ty, -hz], [-hx, -hy, hz]);   // левый борт

  return result(P, N);
}

export function cylinderGeometry(radius = 0.5, height = 1, segments = 16) {
  const hz = height / 2;
  const P = [], N = [];
  const step = (Math.PI * 2) / segments;

  for (let i = 0; i < segments; i++) {
    const a0 = i * step, a1 = (i + 1) * step;
    const x0 = Math.cos(a0) * radius, y0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, y1 = Math.sin(a1) * radius;

    quad(P, N, [x0, y0, -hz], [x1, y1, -hz], [x1, y1, hz], [x0, y0, hz]);

    // Торцы (треугольники-веера)
    const nFront = [0, 0, -1], nBack = [0, 0, 1];
    const pushTri = (a, b, c, n) => {
      for (const p of [a, b, c]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); }
    };
    pushTri([0, 0, -hz], [x1, y1, -hz], [x0, y0, -hz], nFront);
    pushTri([0, 0, hz], [x0, y0, hz], [x1, y1, hz], nBack);
  }
  return result(P, N);
}

export function sphereGeometry(rx = 0.5, ry = 0.5, rz = 0.5, segments = 20, rings = 14) {
  const P = [], N = [];
  const push = (p, n) => { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); };

  for (let r = 0; r < rings; r++) {
    const v0 = (r / rings) * Math.PI;
    const v1 = ((r + 1) / rings) * Math.PI;
    for (let s = 0; s < segments; s++) {
      const u0 = (s / segments) * Math.PI * 2;
      const u1 = ((s + 1) / segments) * Math.PI * 2;

      const p = (u, v) => [
        Math.sin(v) * Math.cos(u) * rx,
        Math.cos(v) * ry,
        Math.sin(v) * Math.sin(u) * rz
      ];
      const nn = (u, v) => norm([
        Math.sin(v) * Math.cos(u) / rx,
        Math.cos(v) / ry,
        Math.sin(v) * Math.sin(u) / rz
      ]);

      const a = p(u0, v0), b = p(u1, v0), c = p(u1, v1), d = p(u0, v1);
      const na = nn(u0, v0), nb = nn(u1, v0), nc = nn(u1, v1), nd = nn(u0, v1);

      // Два треугольника с плавными нормалями
      push(a, na); push(b, nb); push(c, nc);
      push(a, na); push(c, nc); push(d, nd);
    }
  }
  return result(P, N);
}

// Фюзеляж: гранёное сечение (октагон), протянутое по Z с сужением к носу и корме.
export function hullGeometry({
  length = 6,
  width = 1.5,
  height = 0.9,
  sides = 8,
  noseLength = 2.4,
  tailScale = 0.7
} = {}) {
  const P = [], N = [];
  const half = length / 2;

  const sections = [
    { z: -half, s: 0.06 },
    { z: -half + noseLength * 0.45, s: 0.55 },
    { z: -half + noseLength, s: 1.0 },
    { z: half - 0.45, s: 1.0 },
    { z: half, s: tailScale }
  ];

  const ring = (z, scale) => {
    const points = [];
    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2 + Math.PI / sides;
      points.push([
        Math.cos(angle) * (width / 2) * scale,
        Math.sin(angle) * (height / 2) * scale,
        z
      ]);
    }
    return points;
  };

  const rings = sections.map((s) => ring(s.z, s.s));

  for (let i = 0; i < rings.length - 1; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      quad(P, N, a[k], a[k2], b[k2], b[k]);
    }
  }

  const pushFan = (points, z, normal) => {
    for (let k = 0; k < points.length; k++) {
      const k2 = (k + 1) % points.length;
      for (const p of [[0, 0, z], points[k], points[k2]]) {
        P.push(p[0], p[1], p[2]);
        N.push(normal[0], normal[1], normal[2]);
      }
    }
  };
  pushFan(rings[rings.length - 1], half, [0, 0, 1]);
  pushFan(rings[0], -half, [0, 0, -1]);

  return result(P, N);
}

// Крыло: две консоли с сужением, стреловидностью и поперечным V.
export function wingGeometry({
  span = 7,
  chord = 1.6,
  thickness = 0.16,
  taper = 0.42,
  sweep = 0.9,
  dihedral = 0.14,
  stations = 3
} = {}) {
  const P = [], N = [];
  const halfSpan = span / 2;

  const buildHalf = (sign) => {
    const profile = [];
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const x = halfSpan * t * sign;
      const f = 1 - (1 - taper) * Math.pow(t, 1.25);
      const c = chord * f;
      const th = thickness * (0.45 + 0.55 * f);
      const z = sweep * t * t;
      const y = dihedral * t;
      profile.push({
        topFront: [x, y + th / 2, -c / 2 + z],
        topRear: [x, y + th / 2, c / 2 + z],
        botRear: [x, y - th / 2, c / 2 + z],
        botFront: [x, y - th / 2, -c / 2 + z]
      });
    }

    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i], b = profile[i + 1];
      quad(P, N, a.topFront, b.topFront, b.topRear, a.topRear);
      quad(P, N, a.botFront, a.botRear, b.botRear, b.botFront);
      quad(P, N, a.topFront, a.botFront, b.botFront, b.topFront);
      quad(P, N, a.topRear, b.topRear, b.botRear, a.botRear);
    }

    const tip = profile[profile.length - 1];
    quad(P, N, tip.topFront, tip.topRear, tip.botRear, tip.botFront);
  };

  buildHalf(1);
  buildHalf(-1);

  return result(P, N);
}
