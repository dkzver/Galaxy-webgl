// Минимальная математика для WebGL: матрицы 4x4 (column-major), векторы.

export const M4 = {
  identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },

  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },

  translation(x, y, z) {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  },

  scaling(x, y, z) {
    return new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);
  },

  /** Обратная матрица для аффинного преобразования (сдвиг + поворот + масштаб). */
  invert(m) {
    const c0 = [m[0], m[1], m[2]];
    const c1 = [m[4], m[5], m[6]];
    const c2 = [m[8], m[9], m[10]];

    // Строки обратной матрицы — векторные произведения столбцов, делённые на det
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];

    const r0 = cross(c1, c2);
    const r1 = cross(c2, c0);
    const r2 = cross(c0, c1);
    const det = c0[0] * r0[0] + c0[1] * r0[1] + c0[2] * r0[2];

    if (Math.abs(det) < 1e-12) return M4.identity();

    const rows = [r0, r1, r2].map((row) => row.map((value) => value / det));
    const out = new Float32Array(16);

    for (let col = 0; col < 3; col++) {
      out[col * 4] = rows[0][col];
      out[col * 4 + 1] = rows[1][col];
      out[col * 4 + 2] = rows[2][col];
      out[col * 4 + 3] = 0;
    }

    out[12] = -(rows[0][0] * m[12] + rows[0][1] * m[13] + rows[0][2] * m[14]);
    out[13] = -(rows[1][0] * m[12] + rows[1][1] * m[13] + rows[1][2] * m[14]);
    out[14] = -(rows[2][0] * m[12] + rows[2][1] * m[13] + rows[2][2] * m[14]);
    out[15] = 1;
    return out;
  },

  rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  },

  rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  },

  rotZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },

  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  },

  lookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  },

  // pos — смещение, rot — углы Эйлера в радианах [rx, ry, rz], scale — масштаб
  compose(pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    let m = M4.translation(pos[0], pos[1], pos[2]);
    m = M4.mul(m, M4.rotY(rot[1]));
    m = M4.mul(m, M4.rotX(rot[0]));
    m = M4.mul(m, M4.rotZ(rot[2]));
    return M4.mul(m, M4.scaling(scale[0], scale[1], scale[2]));
  },

  // Матрица нормалей = transpose(inverse(upper 3x3)).
  // В column-major она совпадает с обратной матрицей, записанной по строкам.
  normalMatrix(m) {
    const m00 = m[0], m01 = m[4], m02 = m[8];
    const m10 = m[1], m11 = m[5], m12 = m[9];
    const m20 = m[2], m21 = m[6], m22 = m[10];

    const det =
      m00 * (m11 * m22 - m12 * m21) -
      m01 * (m10 * m22 - m12 * m20) +
      m02 * (m10 * m21 - m11 * m20);

    if (Math.abs(det) < 1e-8) {
      return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }
    const d = 1 / det;
    return new Float32Array([
      (m11 * m22 - m12 * m21) * d,
      -(m01 * m22 - m02 * m21) * d,
      (m01 * m12 - m02 * m11) * d,
      -(m10 * m22 - m12 * m20) * d,
      (m00 * m22 - m02 * m20) * d,
      -(m00 * m12 - m02 * m10) * d,
      (m10 * m21 - m11 * m20) * d,
      -(m00 * m21 - m01 * m20) * d,
      (m00 * m11 - m01 * m10) * d
    ]);
  },

  transformPoint(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    ];
  },

  transformDirection(m, p) {
    return [
      m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
      m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
      m[2] * p[0] + m[6] * p[1] + m[10] * p[2]
    ];
  }
};

/** Кватернион вращения из матрицы: масштаб из столбцов убираем. */
export function quatFromMat4(m) {
  const axis = (x, y, z) => {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };

  const [a0, a1, a2] = axis(m[0], m[1], m[2]);
  const [b0, b1, b2] = axis(m[4], m[5], m[6]);
  const [c0, c1, c2] = axis(m[8], m[9], m[10]);

  const trace = a0 + b1 + c2;
  let x;
  let y;
  let z;
  let w;

  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (b2 - c1) / s;
    y = (c0 - a2) / s;
    z = (a1 - b0) / s;
  } else if (a0 > b1 && a0 > c2) {
    const s = Math.sqrt(1 + a0 - b1 - c2) * 2;
    w = (b2 - c1) / s;
    x = 0.25 * s;
    y = (b0 + a1) / s;
    z = (c0 + a2) / s;
  } else if (b1 > c2) {
    const s = Math.sqrt(1 + b1 - a0 - c2) * 2;
    w = (c0 - a2) / s;
    x = (b0 + a1) / s;
    y = 0.25 * s;
    z = (c1 + b2) / s;
  } else {
    const s = Math.sqrt(1 + c2 - a0 - b1) * 2;
    w = (a1 - b0) / s;
    x = (c0 + a2) / s;
    y = (c1 + b2) / s;
    z = 0.25 * s;
  }

  return quatNormalize([x, y, z, w]);
}

export function hexToRgb(hex, fallback = [0.6, 0.65, 0.75]) {
  if (typeof hex !== 'string') return fallback;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/* ------------------------------- Кватернионы ------------------------------ */

export function quatIdentity() {
  return [0, 0, 0, 1];
}

export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}

export function quatFromAxisAngle(axis, angle) {
  const half = angle / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/**
 * Кватернион, разворачивающий локальную ось forward в direction.
 * По умолчанию forward = [0, 0, -1]: так смотрят носы моделей кораблей и ракеты.
 */
export function quatFromDirection(direction, forward = [0, 0, -1]) {
  const normalize = (v) => {
    const length = Math.hypot(v?.[0] || 0, v?.[1] || 0, v?.[2] || 0);
    return length < 1e-9 ? [0, 0, -1] : [v[0] / length, v[1] / length, v[2] / length];
  };

  const from = normalize(forward);
  const to = normalize(direction);
  const dot = Math.min(1, Math.max(-1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));

  if (dot > 0.999999) return [0, 0, 0, 1];

  if (dot < -0.999999) {
    // Разворот на 180°: любая перпендикулярная ось даёт корректный кватернион.
    const axis = Math.abs(from[1]) < 0.9
      ? normalize([-from[2], 0, from[0]])
      : normalize([0, -from[2], from[1]]);
    return quatFromAxisAngle(axis, Math.PI);
  }

  const axis = normalize([
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0]
  ]);

  return quatFromAxisAngle(axis, Math.acos(dot));
}

export function quatNormalize(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function quatConjugate(q) {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function quatRotate(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];

  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x
  ];
}

export function quatToMat4(q) {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;

  return new Float32Array([
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    0, 0, 0, 1
  ]);
}
