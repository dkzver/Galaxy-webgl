/**
 * @fileoverview Шейдер энергетического щита.
 *
 * Оболочка почти прозрачна (база + френель на скользящих углах), а попадания
 * зажигают локальное пятно с гексагональной сеткой, ядро и кольцо.
 * До четырёх попаданий: uHits[i] = (x, y, z, age), age < 0 — слот свободен.
 */

export const shieldVS = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uViewProj;
uniform mat4 uModel;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal);
  vLocal = aPosition;
  vLocalNormal = aNormal;
  gl_Position = uViewProj * world;
}
`;

export const shieldFS = `
precision mediump float;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vLocalNormal;

uniform vec3 uCamera;
uniform vec3 uColor;
uniform vec3 uHitColor;
uniform float uBase;
uniform float uFresnel;
uniform float uHitRadius;
uniform float uHexScale;
uniform float uPatchLife;
uniform float uRingLife;
uniform vec4 uHits[4];

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Ближайший центр гексагональной ячейки и её локальные координаты
vec2 hexLocal(vec2 p) {
  vec2 size = vec2(1.0, 1.7320508);
  vec2 halfSize = size * 0.5;
  vec2 a = mod(p, size) - halfSize;
  vec2 b = mod(p - halfSize, size) - halfSize;
  return dot(a, a) < dot(b, b) ? a : b;
}

float hexEdge(vec2 p) {
  p = abs(p);
  return max(p.x * 0.8660254 + p.y * 0.5, p.y);
}

float hexEdgeGlow(vec2 p) {
  return smoothstep(0.36, 0.5, hexEdge(hexLocal(p)));
}

float hexFill(vec2 p) {
  return 1.0 - smoothstep(0.0, 0.5, hexEdge(hexLocal(p)));
}

float hexId(vec2 p) {
  return hash21(p - hexLocal(p));
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(uCamera - vWorld);

  float facing = abs(dot(normal, view));
  float fresnel = pow(1.0 - facing, uFresnel);
  float shell = uBase + fresnel * 0.18;

  // Гексагональная «кожа»: узор в осях меша, чтобы не плыл при движении
  vec3 localNormal = normalize(vLocalNormal);
  vec3 weights = abs(localNormal) / max(1e-4, abs(localNormal.x) + abs(localNormal.y) + abs(localNormal.z));
  vec2 hexUvX = vLocal.zy * uHexScale;
  vec2 hexUvY = vLocal.xz * uHexScale;
  vec2 hexUvZ = vLocal.xy * uHexScale;

  float hexEdgeGlowValue = hexEdgeGlow(hexUvX) * weights.x
    + hexEdgeGlow(hexUvY) * weights.y
    + hexEdgeGlow(hexUvZ) * weights.z;
  float hexFillValue = hexFill(hexUvX) * weights.x
    + hexFill(hexUvY) * weights.y
    + hexFill(hexUvZ) * weights.z;
  float hexIdValue = hexId(hexUvX) * weights.x
    + hexId(hexUvY) * weights.y
    + hexId(hexUvZ) * weights.z;

  shell += hexEdgeGlowValue * 0.36 + hexFillValue * 0.03 + hexIdValue * 0.01;

  float cell = hexEdgeGlowValue;

  float hits = 0.0;
  float reveal = 0.0;
  float speed = uHitRadius * 2.4 / max(0.05, uRingLife);

  for (int i = 0; i < 4; i++) {
    vec4 hit = uHits[i];
    if (hit.w < 0.0) continue;

    float age = hit.w;
    float distanceToHit = distance(vWorld, hit.xyz);
    float patchFade = max(0.0, 1.0 - age / max(0.05, uPatchLife));

    // Слабое пятно в точке удара: основную форму даёт гекс-кожа
    float patch = 1.0 - smoothstep(0.0, uHitRadius * 0.8, distanceToHit);
    hits += patch * patchFade * (0.6 + cell * 0.4);

    // Три концентрические волны: фронт бежит по оболочке,
    // а гекс-кожа позади него постепенно теряет непрозрачность
    for (int k = 0; k < 3; k++) {
      float waveAge = age - float(k) * uRingLife * 0.18;
      if (waveAge < 0.0) continue;

      float front = waveAge * speed;
      float sinceFront = waveAge - distanceToHit / max(0.001, speed);
      float trail = sinceFront >= 0.0
        ? clamp(1.0 - sinceFront / max(0.05, uPatchLife), 0.0, 1.0)
        : 0.0;
      trail *= (k == 0 ? 1.0 : 0.65);
      reveal = max(reveal, trail);

      float ring = 1.0 - smoothstep(0.0, uHitRadius * 0.12, abs(distanceToHit - front));
      hits += ring * max(0.0, 1.0 - waveAge / max(0.05, uRingLife)) * (k == 0 ? 1.2 : 0.7);
    }

    // Ядро вспышки в первые миллисекунды
    float core = 1.0 - smoothstep(0.0, uHitRadius * 0.25, distanceToHit);
    hits += core * max(0.0, 1.0 - age / max(0.05, uPatchLife * 0.4)) * 1.2;
  }

  vec3 color = uColor * (shell * reveal) + uHitColor * hits;
  color += vec3(0.15, 0.3, 0.38) * max(0.0, hits - 0.8);
  gl_FragColor = vec4(color, 1.0);
}
`;
