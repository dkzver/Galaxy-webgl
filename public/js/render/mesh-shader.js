// Шейдер меша: общий для игры и редактора, чтобы картинка совпадала.

export const meshVS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;

uniform mat4 uModel;
uniform mat4 uViewProj;
uniform mat3 uNormalMat;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec2 vUv;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vLocal = aPosition;
  vUv = aUv;
  vNormal = uNormalMat * aNormal;
  gl_Position = uViewProj * world;
}`;

export const meshFS = `
precision highp float;

varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec2 vUv;

uniform vec3 uColor;
uniform vec3 uEmissive;
uniform vec3 uLightDir;
uniform vec3 uCamera;
uniform vec3 uTint;
uniform float uSpecular;
uniform float uMetal;
uniform float uTextured;
uniform float uTextureColor;
uniform float uRoughness;

uniform sampler2D uAlbedoMap;
uniform sampler2D uRoughMap;
uniform sampler2D uMetalMap;
// Эмиссивная маска: белый пиксель — деталь светится, чёрный — нет.
// Для моделей без карты грузится белая 1×1, то есть маска пропускает всё.
uniform sampler2D uEmissiveMap;
uniform float uEmissiveMapOn;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

void main() {
  vec3 albedo = uColor;
  float rough = 0.55;
  float metal = uMetal;
  // Эмиссия умножается на маску из атласа: у импортированных моделей
  // glow задан на всю группу, а светятся только сопла и лампочки
  vec3 glow = uEmissive;

  if (uTextured > 0.5) {
    // OBJ хранит V снизу вверх — переворачиваем при сэмплировании
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec3 raw = texture2D(uAlbedoMap, uv).rgb;

    // Из атласа берём рельеф и лёгкий оттенок, цвет задаёт палитра детали:
    // так панели и потёртости читаются, а «чужие» UV-острова не красят корабль целиком
    float lum = dot(raw, vec3(0.299, 0.587, 0.114));
    float detail = 0.7 + 0.45 * clamp(lum / 0.5, 0.0, 1.5);
    vec3 hue = clamp(raw / max(lum, 0.08), 0.8, 1.2);
    // Палитровые модели (Corinth) берут из атласа рельеф, импорт из GLB —
    // сам цвет: у него UV и материалы совпадают с текстурой
    vec3 paletteColor = albedo * mix(vec3(detail), hue * detail, 0.2);
    albedo = mix(paletteColor, raw, uTextureColor) * uTint;
    albedo = min(albedo, vec3(0.85));

    rough = texture2D(uRoughMap, uv).r * uRoughness;
    metal = texture2D(uMetalMap, uv).r * uMetal;
    glow *= mix(1.0, dot(texture2D(uEmissiveMap, uv).rgb, vec3(0.299, 0.587, 0.114)), uEmissiveMapOn);
  } else {
    float grime = hash(floor(vLocal * 0.9)) * 0.6 + hash(floor(vLocal * 3.0)) * 0.4;
    albedo *= 0.88 + 0.24 * grime;
  }

  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamera - vWorld);
  vec3 l = normalize(uLightDir);

  float ndl = max(dot(n, l), 0.0);
  float fill = max(dot(n, normalize(vec3(-0.55, -0.35, -0.5))), 0.0) * 0.35;

  vec3 h = normalize(l + v);
  float shininess = mix(600.0, 8.0, clamp(rough, 0.0, 1.0));
  float specAmount = (1.0 - rough) * (1.0 - rough) * 2.2 + 0.04;
  float spec = pow(max(dot(n, h), 0.0), shininess) * specAmount * uSpecular;

  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);

  // Отражение условного окружения — даёт металлический отблеск
  vec3 refl = reflect(-v, n);
  vec3 env = mix(vec3(0.012, 0.018, 0.04), vec3(0.3, 0.38, 0.56), clamp(refl.y * 0.5 + 0.5, 0.0, 1.0));

  vec3 diffuse = albedo * (1.0 - clamp(metal, 0.0, 1.0) * 0.7);
  vec3 color = diffuse * vec3(1.0, 0.95, 0.9) * (0.16 + 1.65 * ndl);
  color += diffuse * vec3(0.3, 0.45, 0.85) * fill;
  color += albedo * 0.1;
  color += vec3(0.95, 0.97, 1.0) * spec;
  color += env * clamp(metal, 0.0, 1.0) * (0.5 + 0.5 * fres) * 1.0;
  color += glow;

  gl_FragColor = vec4(pow(clamp(color, 0.0, 4.0), vec3(1.0)), 1.0);
}`;

