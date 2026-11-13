/**
 * @fileoverview Шейдер энергетического щита.
 *
 * Оболочка почти прозрачна (база + френель на скользящих углах). Попадание
 * зажигает ЛОКАЛЬНУЮ волну непрозрачности от точки удара: фронт добегает до
 * края маленького гексагонального пятна втрое быстрее жизни пятна
 * (patchLife / 3), позади фронта непрозрачность плавно спадает к краю.
 * По всей оболочке волна не идёт.
 *
 * До четырёх попаданий: uHits[i] = (x, y, z, age), координаты — локальные
 * координаты меша щита, age < 0 — слот свободен.
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

// Гексагональная метрика: изолинии — правильные шестиугольники.
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

  // Только обращённая к камере сторона: обратная не просвечивает сквозь корпус.
  if (dot(normal, view) <= 0.0) discard;

  float facing = abs(dot(normal, view));
  float fresnel = pow(1.0 - facing, uFresnel);
  float shell = uBase + fresnel * 0.18;

  // Локальная плоскость гекс-сетки: выбираем ось по нормали меша.
  vec3 localNormal = normalize(vLocalNormal);
  vec3 weights = abs(localNormal) / max(1e-4, abs(localNormal.x) + abs(localNormal.y) + abs(localNormal.z));

  vec2 uv;
  if (weights.x >= weights.y && weights.x >= weights.z) uv = vLocal.zy;
  else if (weights.y >= weights.z) uv = vLocal.xz;
  else uv = vLocal.xy;
  uv *= uHexScale;

  float hexEdgeGlowValue = hexEdgeGlow(uv);
  float hexIdValue = hexId(uv);

  // Пятно — максимум по попаданиям; вне попаданий оболочка не рисуется.
  float patch = 0.0;
  float patchEdge = 0.0;
  float patchId = 0.0;
  float patchCore = 0.0;

  float radius = max(0.5, uHitRadius * uHexScale);

  for (int i = 0; i < 4; i++) {
    vec4 hit = uHits[i];
    if (hit.w < 0.0) continue;

    float age = hit.w;

    // Волна непрозрачности от точки попадания: фронт добегает до края
    // пятна втрое быстрее жизни пятна (patchLife / 3). Позади фронта
    // непрозрачность плавно спадает от центра к краю.
    float front = min(1.0, age / max(0.02, uPatchLife / 3.0));
    float fade = 1.0 - smoothstep(uPatchLife * 0.55, uPatchLife, age);
    if (fade <= 0.0) continue;

    vec2 hitUv;
    if (weights.x >= weights.y && weights.x >= weights.z) hitUv = hit.zy;
    else if (weights.y >= weights.z) hitUv = hit.xz;
    else hitUv = hit.xy;
    hitUv *= uHexScale;

    // Нормированное расстояние в гекс-метрике: 0 — центр, 1 — край пятна.
    float distanceToHit = hexEdge(uv - hitUv) / radius;
    float reveal = 1.0 - smoothstep(front, front + 0.25, distanceToHit);
    float gradient = 1.0 - smoothstep(0.0, 1.0, distanceToHit);
    float weight = reveal * gradient * fade;

    float core = (1.0 - smoothstep(0.0, 0.18, distanceToHit)) * fade;

    patch = max(patch, weight);
    patchEdge = max(patchEdge, weight * hexEdgeGlowValue);
    patchId = max(patchId, weight * hexIdValue);
    patchCore = max(patchCore, core);
  }

  // Нет попаданий — оболочка невидима, не пишем лишние пиксели.
  if (patch <= 0.001) discard;

  float skin = shell * 0.8 + patchEdge * 0.5 + patch * 0.42 + patchId * 0.05;
  vec3 color = uColor * skin * patch * 1.8;
  color += uHitColor * patchCore * 0.35;

  gl_FragColor = vec4(color, 1.0);
}
`;
