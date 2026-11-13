import { M4, quatIdentity, quatMul, quatNormalize, quatFromAxisAngle, quatToMat4, quatConjugate, quatRotate } from './math.js';
import { createProgram } from './gl.js';
import { loadShip, SHIP_MODELS } from './ship.js';
import { eulerToQuat, loadScene } from './scene.js';
import { attachBodies, bindEffectTriggers, buildScene, updateScene } from './scene-runtime.js';
import { PhysicsWorld, boxShape, compoundShape, sphereShape, getWorldBoxes, getWorldSpheres } from './physics.js';
import { EffectSystem } from './effects.js';
import { cursorRayDirection } from './mining.js';
import { pickClosest } from './picking.js';
import { ScriptRuntime } from './script-runtime.js';
import { createReticleView } from './reticle-view.js';
import { createPrefabRuntime } from './prefab-runtime.js';
import { createProjectilePool } from './projectile-pool.js';
import { createProjectileSystem } from './projectiles.js';
import { partHidden } from './model-split.js';
import { pushWireBoxCorners, pushWireSphere } from './wire.js';
import { shieldVS, shieldFS } from './render/shield-shader.js';
import { normalizeMaterial } from './materials.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
let overlayText = document.getElementById('overlay-text');

function fail(message) {
  loadingState.error = message;
  if (window.__galaxy) window.__galaxy.error = message;
  overlay.classList.remove('hidden');
  overlayText = document.getElementById('overlay-text');

  if (overlayText) {
    overlayText.textContent = message;
    overlayText.classList.add('error');
  }

  loadingScript?.update?.(loadingCtx, 0.016);
  console.error(message);
}

/* ------------------------- Загрузочный экран сцены ------------------------ */

const loadingState = { progress: 0, elapsed: 0, ready: false, error: null };
let loadingScript = null;
let loadingCtx = null;
let loadingRaf = 0;
const loadingStartedAt = performance.now();

function setLoadingProgress(value) {
  const next = Math.max(0, Math.min(1, Number(value) || 0));
  if (next > loadingState.progress) loadingState.progress = next;
}

function paintLoadingFallback() {
  if (loadingScript) return;
  overlayText = document.getElementById('overlay-text');
  if (!overlayText) return;

  overlayText.textContent = loadingState.error
    || `загрузка ${Math.round(loadingState.progress * 100)}% · ${loadingState.elapsed.toFixed(1)} с`;
}

async function startLoadingScreen(config = {}) {
  loadingState.progress = 0;
  loadingState.error = null;
  loadingState.ready = false;

  const file = config.file || 'hud/loading.html';
  const scriptFile = config.script || 'scripts/loading.js';

  try {
    const response = await fetch(file, { cache: 'no-store' });
    if (response.ok) overlay.innerHTML = await response.text();
  } catch {
    // останется встроенная заглушка из index.html
  }

  overlayText = document.getElementById('overlay-text');

  try {
    const url = new URL(scriptFile, `${location.origin}/`);
    url.searchParams.set('t', String(Date.now()));
    const mod = await import(url.href);
    loadingScript = mod.default || null;
  } catch (err) {
    console.warn(`[loading] скрипт ${scriptFile} не загрузился:`, err);
    loadingScript = null;
  }

  loadingCtx = {
    api: {
      root: overlay,
      loading: {
        getProgress: () => loadingState.progress,
        getElapsed: () => loadingState.elapsed,
        isReady: () => loadingState.ready,
        getError: () => loadingState.error
      }
    },
    state: {}
  };

  loadingScript?.init?.(loadingCtx);

  let last = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    loadingState.elapsed = (now - loadingStartedAt) / 1000;

    loadingScript?.update?.(loadingCtx, dt);
    if (!loadingScript) paintLoadingFallback();

    if (!loadingState.ready) loadingRaf = requestAnimationFrame(tick);
  };

  loadingRaf = requestAnimationFrame(tick);
}

function finishLoadingScreen() {
  setLoadingProgress(1);
  loadingState.ready = true;
  loadingState.elapsed = (performance.now() - loadingStartedAt) / 1000;

  loadingScript?.update?.(loadingCtx, 0.016);
  if (!loadingScript) paintLoadingFallback();

  cancelAnimationFrame(loadingRaf);
  loadingScript?.dispose?.(loadingCtx);

  // Даём экрану показать 100% и плавно убираем его
  setTimeout(() => {
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 800);
  }, 220);
}

// Контекст создаём с фолбэками: на программном рендере или старых драйверах
// запрос "high-performance" может не вернуть контекст вообще.
function createContext() {
  const preferred = { antialias: true, alpha: false, powerPreference: 'high-performance' };
  const simple = { antialias: true, alpha: false };

  return canvas.getContext('webgl2', preferred)
    || canvas.getContext('webgl', preferred)
    || canvas.getContext('webgl2', simple)
    || canvas.getContext('webgl', simple);
}

const gl = createContext();

if (!gl) {
  fail('WebGL недоступен в этом браузере.');
  throw new Error('WebGL недоступен');
}

/* ------------------------------- Шейдеры ------------------------------- */

import { meshVS, meshFS } from './render/mesh-shader.js';

const glowVS = `
attribute vec2 aQuad;

uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
uniform mat4 uViewProj;
uniform float uSize;

varying vec2 vUv;

void main() {
  vUv = aQuad;
  vec3 world = uCenter + (uRight * aQuad.x + uUp * aQuad.y) * uSize;
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const glowFS = `
precision mediump float;

varying vec2 vUv;

uniform vec3 uColor;
uniform float uIntensity;

void main() {
  float r = length(vUv);
  float a = pow(smoothstep(1.0, 0.0, r), 2.4);
  gl_FragColor = vec4(uColor * a * uIntensity, a * uIntensity);
}`;

// Луч рисуется в экранных координатах: линия от носа корабля к прицелу,
// поэтому он читается даже когда летит прямо от камеры
const skyboxVS = `
attribute vec2 aQuad;
varying vec2 vUv;

void main() {
  vUv = aQuad;
  gl_Position = vec4(aQuad, 0.0, 1.0);
}`;

// Кубемапа: цвет грани берётся по направлению луча, поэтому шва на азимуте и
// растяжения на полюсах нет. depth/CULL не участвуют — это фон кадра.
const skyboxFS = `
precision mediump float;

varying vec2 vUv;

uniform samplerCube uSky;
uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uTanHalfFov;
uniform float uAspect;

void main() {
  vec3 dir = normalize(uForward + uRight * vUv.x * uTanHalfFov * uAspect + uUp * vUv.y * uTanHalfFov);
  gl_FragColor = textureCube(uSky, dir);
}`;

const beamVS = `
attribute vec2 aQuad;

uniform vec2 uStartNdc;
uniform vec2 uEndNdc;
uniform vec2 uViewport;
uniform float uWidth;
uniform float uStartZ;
uniform float uEndZ;

varying vec2 vUv;

void main() {
  vec2 delta = uEndNdc - uStartNdc;
  vec2 dir = length(delta) > 1e-6 ? normalize(delta) : vec2(0.0, 1.0);
  vec2 normal = vec2(-dir.y, dir.x);

  vec2 ndc = mix(uStartNdc, uEndNdc, aQuad.y);
  ndc += normal * aQuad.x * uWidth * 2.0 / uViewport;

  gl_Position = vec4(ndc, mix(uStartZ, uEndZ, aQuad.y), 1.0);
  vUv = aQuad;
}`;

const beamFS = `
precision mediump float;

varying vec2 vUv;

uniform vec3 uColor;
uniform float uIntensity;

void main() {
  float across = 1.0 - abs(vUv.x);
  float core = pow(across, 2.6);
  // луч горит по всей длине и гаснет только у самого кончика
  float fade = 1.0 - smoothstep(0.82, 1.0, vUv.y);
  float a = core * fade;
  gl_FragColor = vec4(uColor * a * uIntensity, a * uIntensity);
}`;

// Отладочная геометрия физики: линии сфер коллайдеров и точки контактов
const debugVS = `
attribute vec3 aPosition;
attribute vec3 aColor;

uniform mat4 uViewProj;

varying vec3 vColor;

void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPosition, 1.0);
}`;

const debugFS = `
precision mediump float;

varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, 0.9);
}`;

// Мягкие камера-билборды для дымных следов пуль и ракеты
const smokeVS = `
attribute vec2 aQuad;

uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
uniform mat4 uViewProj;
uniform float uSize;

varying vec2 vUv;

void main() {
  vUv = aQuad;
  vec3 world = uCenter + (uRight * aQuad.x + uUp * aQuad.y) * uSize;
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const smokeFS = `
precision mediump float;

varying vec2 vUv;

uniform vec3 uColor;
uniform float uOpacity;

void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = pow(smoothstep(1.0, 0.0, r), 2.0) * uOpacity;
  gl_FragColor = vec4(uColor, a);
}`;

let meshProgram, glowProgram, beamProgram, debugProgram, smokeProgram, shieldProgram, skyboxProgram;
try {
  meshProgram = createProgram(gl, meshVS, meshFS);
  glowProgram = createProgram(gl, glowVS, glowFS);
  beamProgram = createProgram(gl, beamVS, beamFS);
  debugProgram = createProgram(gl, debugVS, debugFS);
  smokeProgram = createProgram(gl, smokeVS, smokeFS);
  shieldProgram = createProgram(gl, shieldVS, shieldFS);
  skyboxProgram = createProgram(gl, skyboxVS, skyboxFS);
} catch (err) {
  fail(err.message);
  throw err;
}

const meshLoc = {
  aPosition: gl.getAttribLocation(meshProgram.program, 'aPosition'),
  aNormal: gl.getAttribLocation(meshProgram.program, 'aNormal'),
  aUv: gl.getAttribLocation(meshProgram.program, 'aUv'),
  u: meshProgram.uniforms
};
const glowLoc = {
  aQuad: gl.getAttribLocation(glowProgram.program, 'aQuad'),
  u: glowProgram.uniforms
};
const beamLoc = {
  aQuad: gl.getAttribLocation(beamProgram.program, 'aQuad'),
  u: beamProgram.uniforms
};
const debugLoc = {
  aPosition: gl.getAttribLocation(debugProgram.program, 'aPosition'),
  aColor: gl.getAttribLocation(debugProgram.program, 'aColor'),
  u: debugProgram.uniforms
};
const smokeLoc = {
  aQuad: gl.getAttribLocation(smokeProgram.program, 'aQuad'),
  u: smokeProgram.uniforms
};
const shieldLoc = {
  aPosition: gl.getAttribLocation(shieldProgram.program, 'aPosition'),
  aNormal: gl.getAttribLocation(shieldProgram.program, 'aNormal'),
  u: shieldProgram.uniforms
};
const skyboxLoc = {
  aQuad: gl.getAttribLocation(skyboxProgram.program, 'aQuad'),
  u: skyboxProgram.uniforms
};

const glowQuadBuffer = (() => {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return buffer;
})();

// Лента луча: x — поперёк (−1..1), y — вдоль (0..1)
const beamQuadBuffer = (() => {
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, 0, 1, 0, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return buffer;
})();

// Линии отладки физики: позиция + цвет на вершину
const debugLineBuffer = gl.createBuffer();
let debugLineCapacity = 0;

/* -------------------------------- Состояние ------------------------------ */

const keys = { w: false, a: false, s: false, d: false, q: false, e: false, f: false };
const mouse = { down: false, button: -1 };   // для input.js
const keysDown = new Set();                  // все зажатые клавиши по code
const CODE_MAP = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e', KeyF: 'f' };

// Скрипты видят любые клавиши, включая Esc
window.addEventListener('keydown', (event) => {
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  keysDown.add(event.code);
});

window.addEventListener('keyup', (event) => { keysDown.delete(event.code); });
window.addEventListener('blur', () => keysDown.clear());

window.addEventListener('keydown', (event) => {
  const key = CODE_MAP[event.code];
  if (key) {
    keys[key] = true;
    event.preventDefault();
  }
}, { passive: false });

window.addEventListener('keyup', (event) => {
  const key = CODE_MAP[event.code];
  if (key) {
    keys[key] = false;
    event.preventDefault();
  }
}, { passive: false });

window.addEventListener('blur', () => {
  keys.w = keys.a = keys.s = keys.d = keys.f = false;
  endOrbit();
});

/* --- мышь: курсор задаёт направление --- */

const cursor = { x: 0, y: 0 }; // нормализованные координаты, -1..1
// Экранная точка курсора: по ней движок ставит прицел-виджет у мыши
const cursorScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let hoveredPointerEntity = null; // модель под курсором (наведение мыши)
// Курсоры могут переехать в HTML-слои сцены, поэтому не const
let reticle = document.getElementById('reticle');
let targetMarker = document.getElementById('target-marker');
let targetProgressEl = document.getElementById('target-progress');
let reticleView = null;      // прицел из скрипта reticle.js (дизайн в reticles.js)
let scriptedTarget = null;   // последняя точка и состояние от скрипта
let cursorReticleView = null; // виджет у курсора мыши (api.target.cursor)
let scriptedCursor = null;    // конфиг и состояние для него
let sceneCursorId = null;     // ссылка сцены на объект-курсор
let sceneCursorEntity = null;
let sceneCursorView = null;

// Слои HUD из сцены: движок только вставляет HTML, положение задаёт их CSS
let hudLayers = [];
let hudTargetEntity = null;
let targetFireTimer = 0;

// Обзор средней кнопкой мыши. Углы хранятся в системе координат корабля,
// поэтому камера облетает корпус вместе с его наклоном и креном.
const ORBIT_SENSITIVITY = 0.0065; // рад на пиксель
const ORBIT_PITCH_MIN = -1.35;
const ORBIT_PITCH_MAX = 1.35;
const ORBIT_BLEND_SPEED = 14;
const orbit = {
  active: false,
  yaw: 0,
  pitch: 0,
  radius: 20,
  blend: 0,
  lastX: 0,
  lastY: 0
};
let cameraPositionReady = false;

// Точка попадания — мировая точка в 500 единицах от носа вдоль оси корабля.
// Она не зависит от камеры и следует за поворотом корабля.
const TARGET_DISTANCE = 500;
const targetState = {
  world: [0, 0, 0],
  screen: null,
  ndc: null,
  ndcZ: null,
  visible: false
};

function trackCursor(event) {
  if (orbit.active) {
    if ((event.buttons & 4) === 0) {
      endOrbit();
      return;
    }

    const dx = event.clientX - orbit.lastX;
    const dy = event.clientY - orbit.lastY;
    orbit.lastX = event.clientX;
    orbit.lastY = event.clientY;

    orbit.yaw += dx * ORBIT_SENSITIVITY;
    if (orbit.yaw > Math.PI) orbit.yaw -= Math.PI * 2;
    if (orbit.yaw < -Math.PI) orbit.yaw += Math.PI * 2;
    orbit.pitch = clamp(orbit.pitch - dy * ORBIT_SENSITIVITY, ORBIT_PITCH_MIN, ORBIT_PITCH_MAX);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  cursorScreen.x = event.clientX;
  cursorScreen.y = event.clientY;
  cursor.x = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
  cursor.y = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
  if (reticle) {
    reticle.style.left = `${event.clientX}px`;
    reticle.style.top = `${event.clientY}px`;
  }

  updatePointerHover();
}

function shipVisualQuaternion() {
  return quatMul(ship.quat, quatFromAxisAngle([0, 0, 1], ship.bank));
}

function beginOrbit(event) {
  if (paused || orbit.active || !shipModel) return;

  event.preventDefault();
  orbit.active = true;
  orbit.lastX = event.clientX;
  orbit.lastY = event.clientY;
  clearPointerHover();

  const visual = shipVisualQuaternion();

  // Стартуем из текущего положения камеры, чтобы не было рывка.
  let dx;
  let dy;
  let dz;

  if (cameraPositionReady) {
    dx = camera.pos[0] - ship.pos[0];
    dy = camera.pos[1] - ship.pos[1];
    dz = camera.pos[2] - ship.pos[2];
  } else {
    const fallback = M4.transformPoint(
      quatToMat4(camera.quat),
      [0, cameraTuning.height, cameraTuning.distance]
    );
    dx = fallback[0];
    dy = fallback[1];
    dz = fallback[2];
  }

  let radius = Math.hypot(dx, dy, dz);
  if (radius < 1e-3) {
    const fallback = M4.transformPoint(
      quatToMat4(camera.quat),
      [0, cameraTuning.height, cameraTuning.distance]
    );
    dx = fallback[0];
    dy = fallback[1];
    dz = fallback[2];
    radius = Math.hypot(dx, dy, dz) || Math.hypot(cameraTuning.height, cameraTuning.distance);
  }

  const local = quatRotate(quatConjugate(visual), [dx, dy, dz]);
  orbit.radius = radius;
  orbit.yaw = Math.atan2(local[0], local[2]);
  orbit.pitch = clamp(
    Math.asin(clamp(local[1] / radius, -1, 1)),
    ORBIT_PITCH_MIN,
    ORBIT_PITCH_MAX
  );

  camera.yawRate = 0;
  camera.pitchRate = 0;
  document.body.classList.add('orbiting');
}

function endOrbit() {
  if (!orbit.active) return;

  orbit.active = false;
  document.body.classList.remove('orbiting');
  camera.yawRate = 0;
  camera.pitchRate = 0;
  cursor.x = 0;
  cursor.y = 0;
  cursorScreen.x = window.innerWidth / 2;
  cursorScreen.y = window.innerHeight / 2;

  if (reticle) {
    reticle.style.left = `${window.innerWidth / 2}px`;
    reticle.style.top = `${window.innerHeight / 2}px`;
  }
}

window.addEventListener('pointermove', trackCursor);

// ЛКМ — спуск оружия, СКМ — обзор камеры вокруг корабля
canvas.addEventListener('mousedown', (event) => {
  mouse.button = event.button;
  if (event.button === 1) {
    event.preventDefault();
    beginOrbit(event);
  }
});

// Средняя кнопка не должна открывать автопрокрутку
canvas.addEventListener('auxclick', (event) => {
  if (event.button === 1) event.preventDefault();
});

window.addEventListener('mousedown', (event) => {
  if (event.button === 0) {
    // Клик по HUD (панель оружия, меню) — это интерфейс, а не выстрел.
    // Слои HUD лежат в #scene-hud; сама сцена — canvas.
    if (event.target?.closest?.('#scene-hud')) return;

    mouse.down = true;
    handlePointerClick(event);
  }
});

window.addEventListener('mouseup', (event) => {
  if (event.button === 1) endOrbit();
  if (event.button === 0) mouse.down = false;
});

document.addEventListener('mouseleave', () => {
  cursor.x = 0;
  cursor.y = 0;
  mouse.down = false;
  endOrbit();
});

/* --- пауза, настройки и выбор корабля --- */

// У каждого меша свои настройки полёта. Камеру движок не настраивает:
// параметры кадра задаёт только объект «камера» сцены (или скрипт camera.js).
const MODEL_SETTINGS = {
  corinth: { turnRate: 2.6, maxSpeed: 85 },
  spaceship: { turnRate: 2.2, maxSpeed: 120 }
};

let currentModelId = 'corinth';
// camHeight / shipDrop — зеркало ползунков камеры, значения приходят из сцены
const settings = { ...MODEL_SETTINGS.corinth, camHeight: 0, shipDrop: 0, cameraSmooth: 2.8 };

let paused = false;
const pausePanel = document.getElementById('pause');
const modelSelect = document.getElementById('set-model');
const editorButton = document.getElementById('open-editor');
const editorNote = document.getElementById('editor-note');
let editorNoteTimer = 0;

function hideEditorNote() {
  clearTimeout(editorNoteTimer);
  if (!editorNote) return;
  editorNote.classList.remove('visible');
  editorNote.textContent = '';
}

function bindEditorButton() {
  const button = document.getElementById('open-editor');
  if (!button || button.dataset.bound) return;

  button.dataset.bound = '1';
  button.addEventListener('click', () => {
    // Открываем редактор той же сцены — путь от корня, не от текущего URL
    const sceneId = window.__galaxy?.scene?.id
      || new URLSearchParams(location.search).get('scene')
      || 'first-game';

    window.open(`/editor.html?scene=${encodeURIComponent(sceneId)}`, '_blank', 'noopener');
  });
}

bindEditorButton();

function switchModel(id) {
  // Модель теперь берётся из сущности игрока — селектор в паузе не нужен
  return;
  if (!id || id === currentModelId) return;
  currentModelId = id;

  if (MODEL_SETTINGS[id]) {
    Object.assign(settings, MODEL_SETTINGS[id]);
    syncSettingsUI();
  }

  return loadShip(gl, id).then((model) => {
    shipModel = model;
    currentModelId = model.id || id;
    // У нового меша другой размер корпуса — пересобираем коллайдер.
    rebuildShipBody();
  }).catch((err) => {
    console.error(err);
  });
}

if (modelSelect) {
  modelSelect.innerHTML = SHIP_MODELS
    .map((model) => `<option value="${model.id}">${model.label}</option>`)
    .join('');
  modelSelect.value = currentModelId;
  modelSelect.addEventListener('change', () => switchModel(modelSelect.value));
}

const RANGES = [
  { key: 'camHeight', input: 'set-cam', out: 'out-cam', digits: 1 },
  { key: 'shipDrop', input: 'set-drop', out: 'out-drop', digits: 1 },
  { key: 'cameraSmooth', input: 'set-smooth', out: 'out-smooth', digits: 1 },
  { key: 'turnRate', input: 'set-turn', out: 'out-turn', digits: 1 },
  { key: 'maxSpeed', input: 'set-speed', out: 'out-speed', digits: 0 }
];

function syncSettingsUI() {
  for (const range of RANGES) {
    const input = document.getElementById(range.input);
    const output = document.getElementById(range.out);
    if (!input || !output) continue;
    input.value = String(settings[range.key]);
    output.textContent = settings[range.key].toFixed(range.digits);
  }
}

// Слайдеры камеры показывают реальные значения движка, а не дефолты сцены
function syncCameraUI() {
  const pairs = [
    ['set-cam', 'out-cam', cameraTuning.height, 1],
    ['set-drop', 'out-drop', cameraTuning.drop, 1],
    ['set-dist', 'out-dist', cameraTuning.distance, 0],
    ['set-tilt', 'out-tilt', cameraTuning.tilt, 0]
  ];

  for (const [inputId, outputId, value, digits] of pairs) {
    const input = document.getElementById(inputId);
    const output = document.getElementById(outputId);
    if (!input || !output) continue;

    input.value = String(value);
    output.textContent = Number(value).toFixed(digits);
  }
}

function bindRangeInputs() {
  for (const range of RANGES) {
    const input = document.getElementById(range.input);
    const output = document.getElementById(range.out);
    if (!input || !output) continue;

    input.addEventListener('input', () => {
      settings[range.key] = Number(input.value);
      // запоминаем значение именно для текущего меша
      if (MODEL_SETTINGS[currentModelId]) MODEL_SETTINGS[currentModelId][range.key] = settings[range.key];
      output.textContent = settings[range.key].toFixed(range.digits);

      // Слайдеры камеры сразу меняют и её параметры
      if (range.key === 'camHeight') cameraTuning.height = settings.camHeight;
      if (range.key === 'shipDrop') cameraTuning.drop = settings.shipDrop;
    });
  }
}

bindRangeInputs();

// Слайдер дистанции: значение читает camera.js, подпись обновляем здесь
function bindDistanceSlider() {
  const slider = document.getElementById('set-dist');
  const output = document.getElementById('out-dist');
  if (!slider || !output || slider.dataset.bound) return;

  slider.dataset.bound = '1';
  slider.addEventListener('input', () => {
    const value = Number(slider.value) || 0;
    output.textContent = String(Math.round(value));
    cameraTuning.distance = value;
  });
}

bindDistanceSlider();

// Слайдер наклона камеры: 0…360°, позиция камеры не меняется
function bindTiltSlider() {
  const slider = document.getElementById('set-tilt');
  const output = document.getElementById('out-tilt');
  if (!slider || !output || slider.dataset.bound) return;

  slider.dataset.bound = '1';
  slider.addEventListener('input', () => {
    const value = Number(slider.value) || 0;
    output.textContent = String(Math.round(value));
    cameraTuning.tilt = value;
  });
}

bindTiltSlider();

syncSettingsUI();

function setMenuOpen(next) {
  menuOpen = Boolean(next);
  document.body.classList.toggle('menu-open', menuOpen);

  // Стрельба и луч не должны «залипать» под меню
  if (menuOpen) {
    syncCameraUI();
  }
}

function setPaused(next) {
  paused = next;
  hideEditorNote();
  pausePanel.classList.toggle('open', paused);
  pausePanel.setAttribute('aria-hidden', String(!paused));
  document.body.classList.toggle('paused', paused);

  if (paused) {
    // Обзор и полёт полностью останавливаются
    endOrbit();

    // Полная остановка: гасим скорость и все угловые скорости
    ship.vel = [0, 0, 0];
    ship.turnRate = 0;
    ship.bank = 0;
    camera.yawRate = 0;
    camera.pitchRate = 0;

    if (shipBody) {
      shipBody.setVelocity([0, 0, 0]);
      shipBody.setAngularVelocity([0, 0, 0]);
    }
    playerEntity?.body?.setVelocity([0, 0, 0]);
    physics.resetClock();
    physics.stats.steps = 0;
  } else {
    // после паузы стартуем без команды поворота
    cursor.x = 0;
    cursor.y = 0;
  }
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    event.preventDefault();
    // Если Esc забрал скрипт (например, меню сцены) — движок молчит
    if (!scriptOwns('pause')) setPaused(!paused);
  }
});


const ship = {
  pos: [0, 0, 0],
  vel: [0, 0, 0],
  quat: quatIdentity(), // ориентация в пространстве
  bank: 0,              // визуальный крен в вираже
  turnRate: 0           // текущая угловая скорость корабля
};

const camera = {
  pos: [0, 0, 0],
  quat: quatIdentity(),
  yawRate: 0,
  pitchRate: 0
};

// Отладочный ракурс: ?cam=dx,dy,dz (например, ?cam=20,3,0 для вида сбоку)
const camParam = new URLSearchParams(location.search).get('cam');
const camOffset = camParam
  ? camParam.split(',').map(Number).filter((n) => Number.isFinite(n))
  : null;

const ACCEL = 34;
const REVERSE_ACCEL = 20;
const DRAG = 0.55;

const CAM_YAW_RATE = 0.95;   // рад/с при курсоре у края экрана (легаси-режим без скриптов)
const CAM_PITCH_RATE = 0.7;
const CAM_ACCEL = 2.8;       // плавность доворота камеры в легаси-режиме
const CAM_FOLLOW = 10;       // 1/с — камера догоняет ориентацию корпуса

const SHIP_TURN_ACCEL = 4.5; // разгон/торможение поворота
const SHIP_TURN_GAIN = 3.8;  // насколько резко догоняем цель

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const mix3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t
];
const smoothstep = (t) => t * t * (3 - 2 * t);
const crossVec = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
const normalizeVec = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

// Кватернион минимального поворота из направления a в направление b.
function quatFromTo(a, b) {
  const dot = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1);
  if (dot > 1 - 1e-6) return quatIdentity();

  if (dot < -1 + 1e-6) {
    let axis = crossVec(a, [0, 1, 0]);
    if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-6) {
      axis = crossVec(a, [1, 0, 0]);
    }
    axis = normalizeVec(axis);
    return [axis[0], axis[1], axis[2], 0];
  }

  const axis = normalizeVec(crossVec(a, b));
  return quatFromAxisAngle(axis, Math.acos(dot));
}

// Ближайшая дуга между кватернионами — для плавного следования камеры
function quatNlerp(a, b, t) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;

  return quatNormalize([
    a[0] + (b[0] * sign - a[0]) * t,
    a[1] + (b[1] * sign - a[1]) * t,
    a[2] + (b[2] * sign - a[2]) * t,
    a[3] + (b[3] * sign - a[3]) * t
  ]);
}

function baseCameraOffset() {
  return camOffset && camOffset.length === 3
    ? camOffset
    : [0, cameraTuning.height, cameraTuning.distance];
}

// Куда должен смотреть нос, чтобы точка в 500 от него легла в центр кадра.
// Центральный луч камеры задаётся её текущей ориентацией и точкой прицеливания.
function computeAimForward() {
  if (!shipModel) return null;

  const cameraMat = quatToMat4(camera.quat);
  const offset = M4.transformPoint(cameraMat, baseCameraOffset());
  const cameraPos = [
    ship.pos[0] + offset[0],
    ship.pos[1] + offset[1],
    ship.pos[2] + offset[2]
  ];

  const aim = M4.transformPoint(cameraMat, [0, cameraTuning.drop, 0]);
  const lookAt = [
    ship.pos[0] + aim[0],
    ship.pos[1] + aim[1],
    ship.pos[2] + aim[2]
  ];

  const direction = normalizeVec([
    lookAt[0] - cameraPos[0],
    lookAt[1] - cameraPos[1],
    lookAt[2] - cameraPos[2]
  ]);

  const visual = quatMul(ship.quat, quatFromAxisAngle([0, 0, 1], ship.bank));
  const noseOffset = quatRotate(visual, shipModel.nose || [0, 0, -6]);
  const nose = [
    ship.pos[0] + noseOffset[0],
    ship.pos[1] + noseOffset[1],
    ship.pos[2] + noseOffset[2]
  ];

  // Пересечение центрального луча камеры со сферой радиуса 500 вокруг носа.
  const vx = cameraPos[0] - nose[0];
  const vy = cameraPos[1] - nose[1];
  const vz = cameraPos[2] - nose[2];
  const b = vx * direction[0] + vy * direction[1] + vz * direction[2];
  const c = vx * vx + vy * vy + vz * vz - TARGET_DISTANCE * TARGET_DISTANCE;
  const discriminant = b * b - c;

  if (!(discriminant > 0)) return null;

  const t = -b + Math.sqrt(discriminant);
  if (!(t > 0)) return null;

  const target = [
    cameraPos[0] + direction[0] * t,
    cameraPos[1] + direction[1] * t,
    cameraPos[2] + direction[2] * t
  ];

  return normalizeVec([
    target[0] - nose[0],
    target[1] - nose[1],
    target[2] - nose[2]
  ]);
}


// Мировая точка → NDC. null, если точка за камерой.
function projectWorldPoint(point) {
  const m = viewProj;
  const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
  const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
  const z = m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14];
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];

  if (!(w > 1e-4)) return null;
  return { ndc: [x / w, y / w], ndcZ: z / w, w };
}

// Мировая точка → CSS-пиксели окна браузера. null, если точка вне кадра.
function projectToScreen(point) {
  const projected = projectWorldPoint(point);
  if (!projected) return null;

  const [nx, ny] = projected.ndc;
  if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return null;
  if (projected.ndcZ < -1 || projected.ndcZ > 1) return null;

  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + (nx * 0.5 + 0.5) * rect.width,
    y: rect.top + (0.5 - ny * 0.5) * rect.height,
    ndc: projected.ndc,
    ndcZ: projected.ndcZ
  };
}

// Нос корабля в мире.
function computeNoseWorld() {
  return shipModel
    ? M4.transformPoint(shipMatrix, shipModel.nose || [0, 0, -6])
    : null;
}

// Точка в 500 от носа по направлению носа. Камера здесь не участвует.
function computeTargetWorld() {
  if (!shipModel) return null;

  const nose = M4.transformPoint(shipMatrix, shipModel.nose || [0, 0, -6]);
  const forward = quatRotate(ship.quat, [0, 0, -1]);
  return [
    nose[0] + forward[0] * TARGET_DISTANCE,
    nose[1] + forward[1] * TARGET_DISTANCE,
    nose[2] + forward[2] * TARGET_DISTANCE
  ];
}

function updateTargetMarker(worldPoint, { applyDom = true } = {}) {

  if (worldPoint) {
    targetState.world[0] = worldPoint[0];
    targetState.world[1] = worldPoint[1];
    targetState.world[2] = worldPoint[2];
  }

  const projected = paused || !worldPoint ? null : projectToScreen(worldPoint);

  if (!projected) {
    targetState.visible = false;
    targetState.screen = null;
    targetState.ndc = null;
    targetState.ndcZ = null;
    if (applyDom && targetMarker) targetMarker.classList.remove('visible');
    return;
  }

  targetState.visible = true;
  targetState.screen = [projected.x, projected.y];
  targetState.ndc = projected.ndc;
  targetState.ndcZ = projected.ndcZ;

  if (applyDom && targetMarker) {
    targetMarker.style.left = `${projected.x}px`;
    targetMarker.style.top = `${projected.y}px`;
    targetMarker.classList.add('visible');
  }
}

/* ---------------------------- Прицел из скрипта --------------------------- */

function ensureReticleView() {
  if (!reticleView) {
    reticleView = createReticleView({ mount: document.body });
    if (window.__galaxy) window.__galaxy.reticle = reticleView;
  }

  return reticleView;
}

/**
 * Экранная точка прицела и расстояние до центра кадра.
 * Нужно скрипту reticle.js для проверки наведения.
 */
function aimScreen() {
  const point = targetState.world.slice();
  const projected = targetState.visible ? projectToScreen(point) : null;
  if (!projected) return { point, visible: false, px: null, distance: Infinity };

  const rect = canvas.getBoundingClientRect();
  return {
    point,
    visible: true,
    px: { x: projected.x, y: projected.y },
    distance: Math.hypot(
      projected.x - (rect.left + rect.width / 2),
      projected.y - (rect.top + rect.height / 2)
    )
  };
}

/** API прицела для скриптов: точка, конфиг сущности и состояние. */
const targetsApi = {
  show(options = {}) {
    const point = Array.isArray(options.point) && options.point.length >= 3
      ? options.point.slice(0, 3).map((value) => Number(value) || 0)
      : null;
    if (!point) return null;

    scriptedTarget = {
      point,
      config: options.config || null,
      state: options.state || {}
    };
    return point;
  },

  hide() {
    if (!scriptedTarget) return false;
    scriptedTarget = null;
    return true;
  },

  pulse() {
    ensureReticleView().pulse();
    if (cursorReticleView) cursorReticleView.pulse();
    if (sceneCursorView) sceneCursorView.pulse();
    return true;
  },

  /** Виджет у курсора мыши: тот же прицел, другой якорь. */
  cursor(options = {}) {
    if (!options.config) {
      scriptedCursor = null;
      return false;
    }

    scriptedCursor = { config: options.config, state: options.state || {} };
    return true;
  },

  hideCursor() {
    if (!scriptedCursor) return false;
    scriptedCursor = null;
    return true;
  },

  aim: () => aimScreen()
};

/** Прицел ведёт скрипт: старый маркер молчит, позицию берём из мировой точки. */
function updateScriptedTarget() {
  const view = ensureReticleView();
  if (targetMarker) targetMarker.classList.remove('visible');

  if (!scriptedTarget || paused) {
    view.hide();
    return;
  }

  const projected = projectToScreen(scriptedTarget.point);
  if (!projected) {
    view.hide();
    return;
  }

  view.setConfig(scriptedTarget.config);
  view.setState(scriptedTarget.state);
  view.setPosition(projected.x, projected.y, true);
}

function ensureCursorView() {
  if (!cursorReticleView) {
    cursorReticleView = createReticleView({ mount: document.body });
    cursorReticleView.element.classList.add('weapon-reticle--cursor');
    if (window.__galaxy) window.__galaxy.cursorReticle = cursorReticleView;
  }

  return cursorReticleView;
}

function ensureSceneCursorView() {
  if (!sceneCursorView) {
    sceneCursorView = createReticleView({ mount: document.body });
    sceneCursorView.element.classList.add('weapon-reticle--cursor');
    if (window.__galaxy) window.__galaxy.cursorReticle = sceneCursorView;
  }

  return sceneCursorView;
}

function hideCursorLayers() {
  if (cursorReticleView) cursorReticleView.hide();
  if (sceneCursorView) sceneCursorView.hide();
  document.body.classList.remove('cursor-widget');
}

/**
 * Виджет у курсора. Основной путь — скрипт cursor.js на объекте; если роли нет,
 * движок сам показывает объект, выбранный в сцене полем «Курсор».
 */
function updateScriptedCursor() {
  if (scriptedCursor) {
    const view = ensureCursorView();
    if (sceneCursorView) sceneCursorView.hide();

    if (paused || orbit.active) {
      view.hide();
      document.body.classList.remove('cursor-widget');
      return;
    }

    view.setConfig(scriptedCursor.config);
    view.setState(scriptedCursor.state);
    view.setPosition(cursorScreen.x, cursorScreen.y, true);
    document.body.classList.add('cursor-widget');
    return;
  }

  if (!sceneCursorId || !sceneCursorEntity) {
    hideCursorLayers();
    return;
  }

  const view = ensureSceneCursorView();
  if (cursorReticleView) cursorReticleView.hide();

  if (paused || orbit.active) {
    view.hide();
    document.body.classList.remove('cursor-widget');
    return;
  }

  const raw = sceneCursorEntity.raw || {};
  view.setConfig({
    ...(raw.reticle && typeof raw.reticle === 'object' ? raw.reticle : {}),
    design: sceneCursorEntity.reticleDesign || null
  });
  view.setState({});
  view.setPosition(cursorScreen.x, cursorScreen.y, true);
  document.body.classList.add('cursor-widget');
}


/* ------------------------------ Слои HUD сцены --------------------------- */

/** Якорь слоя: какая его точка садится в экранную координату. */
function hudAnchorTransform(anchor) {
  switch (anchor) {
    case 'top-right': return 'translate(-100%, 0)';
    case 'bottom-left': return 'translate(0, -100%)';
    case 'bottom-right': return 'translate(-100%, -100%)';
    case 'center': return 'translate(-50%, -50%)';
    default: return 'none';
  }
}

/** Слои с follow: parent/entity/target висят на объекте и едут за ним. */
function updateAttachedHud() {
  for (const layer of hudLayers) {
    if (!layer.attached) continue;

    const hud = layer.hud;
    let point = null;

    if (hud.follow === 'target') {
      point = targetState.visible && targetState.screen
        ? { x: targetState.screen[0], y: targetState.screen[1] }
        : null;
    } else {
      const anchorEntity = hud.follow === 'parent'
        ? layer.entity.parent
        : sceneEntities.find((entity) => entity.id === hud.target) || null;
      const matrix = anchorEntity?.matrix;
      if (matrix) point = projectToScreen([matrix[12], matrix[13], matrix[14]]);
    }

    if (!point) {
      layer.el.classList.add('offscreen');
      continue;
    }

    layer.el.classList.remove('offscreen');
    layer.el.style.left = `${Math.round(point.x + (hud.offset?.[0] || 0))}px`;
    layer.el.style.top = `${Math.round(point.y + (hud.offset?.[1] || 0))}px`;
  }
}

/** Загрузить HTML-слои, которые описаны в сцене. */
/** Один файл стилей сцены на все HTML-слои HUD. */
function applySceneHudStyle(href) {
  const id = 'scene-hud-style';
  const link = document.getElementById(id);

  if (!href) {
    link?.remove();
    return;
  }

  if (link) {
    if (link.getAttribute('href') !== href) link.href = href;
    return;
  }

  const el = document.createElement('link');
  el.id = id;
  el.rel = 'stylesheet';
  el.href = href;
  document.head.append(el);
}

let skyboxTexture = null;
const skyboxTextureCache = new Map();

// Порядок совпадает с GL: +X, -X, +Y, -Y, +Z, -Z.
const SKYBOX_FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

/** Привести грань к допустимому размеру текстуры, не теряя пропорций. */
function resizeCubeFace(bitmap, size) {
  const canvasFace = document.createElement('canvas');
  canvasFace.width = size;
  canvasFace.height = size;
  const context = canvasFace.getContext('2d');
  context.drawImage(bitmap, 0, 0, size, size);
  return canvasFace;
}

/**
 * Кубемапа вместо equirect-панорамы: у куба нет шва на азимуте склейки и нет
 * сингулярности на полюсах, поэтому небо вращается без видимых границ.
 */
async function loadSkyboxTexture(id) {
  if (!id) return null;
  if (skyboxTextureCache.has(id)) return skyboxTextureCache.get(id);

  const promise = (async () => {
    try {
      const bitmaps = await Promise.all(SKYBOX_FACES.map(async (face) => {
        const response = await fetch(`skyboxes/cube/${id}-${face}.jpg`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`грань ${face}: ${response.status}`);
        return createImageBitmap(await response.blob());
      }));

      const source = bitmaps[0].width;
      const limit = gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE) || source;
      const size = Math.min(source, limit);

      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
      bitmaps.forEach((bitmap, index) => {
        const target = gl.TEXTURE_CUBE_MAP_POSITIVE_X + index;
        const image = size === source ? bitmap : resizeCubeFace(bitmap, size);
        gl.texImage2D(target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      });
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      bitmaps.forEach((bitmap) => bitmap.close?.());
      return texture;
    } catch (err) {
      console.warn('[skybox] кубемапа не загружена:', id, err);
      return null;
    }
  })();

  skyboxTextureCache.set(id, promise);
  return promise;
}

/** Небесная сфера: фон кадра, глубина и коллизии не участвуют. */
function drawSkybox(fov) {
  if (!skyboxTexture) return;

  const right = [viewMatrix[0], viewMatrix[4], viewMatrix[8]];
  const up = [viewMatrix[1], viewMatrix[5], viewMatrix[9]];
  const forward = [-viewMatrix[2], -viewMatrix[6], -viewMatrix[10]];

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(skyboxProgram.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
  gl.uniform1i(skyboxLoc.u.uSky, 0);
  gl.uniform3fv(skyboxLoc.u.uForward, forward);
  gl.uniform3fv(skyboxLoc.u.uRight, right);
  gl.uniform3fv(skyboxLoc.u.uUp, up);
  gl.uniform1f(skyboxLoc.u.uTanHalfFov, Math.tan((fov * Math.PI) / 360));
  gl.uniform1f(skyboxLoc.u.uAspect, canvas.width / Math.max(1, canvas.height));
  gl.bindBuffer(gl.ARRAY_BUFFER, glowQuadBuffer);
  gl.enableVertexAttribArray(skyboxLoc.aQuad);
  gl.vertexAttribPointer(skyboxLoc.aQuad, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.depthMask(true);
}

async function loadSceneHud(entities) {
  const host = document.getElementById('scene-hud');
  if (!host) return;

  const defs = entities.filter((entity) => entity.type === 'hud' && entity.hud?.file && entity.visible !== false);

  host.innerHTML = '';
  hudLayers = [];

  if (!defs.length) return;

  // Статику задаёт сцена: встроенные блоки больше не нужны
  for (const entity of defs) {
    const hud = entity.hud;
    let html = '';

    try {
      const response = await fetch(hud.file, { cache: 'no-store' });
      if (response.ok) html = await response.text();
    } catch {
      // файла нет — слой останется пустым, сцена продолжит работать
    }

    // Обычные слои движок не позиционирует: только вставляет HTML в контейнер.
    // Слои с привязкой к объекту ведёт updateAttachedHud().
    const el = document.createElement('div');
    el.className = 'hud-layer';
    el.innerHTML = html;

    const attached = ['parent', 'entity', 'target'].includes(hud.follow);
    if (attached) {
      el.classList.add('attached');
      el.style.transform = `${hudAnchorTransform(hud.anchor)} scale(${hud.scale})`;
    }

    host.append(el);

    const layer = { entity, hud, el, hidden: Boolean(hud.startHidden), attached };
    hudLayers.push(layer);
    el.classList.toggle('hidden', layer.hidden);
  }

  // Меню из сцены заменяет встроенную панель паузы: её разметка внутри слоя
  const menuLayer = hudLayerById(MENU_LAYER_ID);
  if (menuLayer && menuLayer.el.querySelector('#pause')) {
    // Удаляем именно встроенную панель, а не копию внутри слоя
    pausePanel?.remove();
    bindRangeInputs();
    bindDistanceSlider();
    bindTiltSlider();
    syncSettingsUI();
    bindEditorButton();
  }

  // Курсоры переехали в слои: перечитываем ссылки на их содержимое
  reticle = document.getElementById('reticle');
  targetMarker = document.getElementById('target-marker');
  targetProgressEl = document.getElementById('target-progress');

  applyModelBind();
}

function applyModelBind() {
  const name = shipModel ? `${shipModel.name} · ${shipModel.source}` : 'модель корабля';

  for (const layer of hudLayers) {
    if (layer.hud.bind !== 'model') continue;
    layer.el.querySelectorAll('[data-bind="model"]').forEach((node) => { node.textContent = name; });
  }
}

const MENU_LAYER_ID = 'hud-menu';

/**
 * Смещение камеры в её осях: Up·height + Right·side + Back·distance.
 * Длина горизонтальной части нормируется так, чтобы отрезок
 * от точки (пивот + Up·height) до камеры был ровно distance.
 */
function cameraOffsetOf(tuning) {
  const side = tuning.side || 0;
  const back = tuning.distance || 0;
  const length = Math.hypot(side, back);
  const k = length > 1e-6 ? back / length : 0;

  return [side * k, tuning.height, back * k];
}

// Поза, которую выставляет скрипт камеры: позиция, точка взгляда, up и fov
let scriptCameraPose = null;

const cameraApi = {
  set: (params) => {
    if (!params) return { ...cameraTuning };

    const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value)));

    if (Number.isFinite(Number(params.height))) cameraTuning.height = clamp(params.height, 0, 200);
    if (Number.isFinite(Number(params.drop))) cameraTuning.drop = clamp(params.drop, 0, 15);
    if (Number.isFinite(Number(params.distance))) cameraTuning.distance = clamp(params.distance, 0, 120);
    if (Number.isFinite(Number(params.side))) cameraTuning.side = clamp(params.side, -20, 20);
    if (Number.isFinite(Number(params.fov))) cameraTuning.fov = clamp(params.fov, 5, 120);
    if (Number.isFinite(Number(params.tilt))) cameraTuning.tilt = clamp(params.tilt, 0, 360);
    if (Number.isFinite(Number(params.lag))) cameraTuning.lag = clamp(params.lag, 0, 20);

    syncCameraUI();
    return { ...cameraTuning };
  },
  // Скрипт камеры сам считает позу — движок только применяет её в рендере
  setPose: (pose) => {
    if (!pose || !Array.isArray(pose.position) || !Array.isArray(pose.lookAt)) return false;

    const vec = (value, fallback) => (Array.isArray(value) && value.length >= 3
      ? value.slice(0, 3).map((item) => Number(item) || 0)
      : fallback.slice());

    scriptCameraPose = {
      position: vec(pose.position, [0, 0, 0]),
      lookAt: vec(pose.lookAt, [0, 0, 0]),
      up: vec(pose.up, [0, 1, 0]),
      fov: Number.isFinite(Number(pose.fov))
        ? Math.min(120, Math.max(5, Number(pose.fov)))
        : cameraTuning.fov
    };

    return true;
  },
  clearPose: () => { scriptCameraPose = null; },
  isScripted: () => scriptOwns('camera'),
  get: () => ({ ...cameraTuning })
};

/** Есть ли откуда взять камеру: объект сцены или поза из скрипта camera.js. */
function hasCameraSource() {
  if (scriptOwns('camera')) return Boolean(scriptCameraPose);
  return sceneCameraAvailable;
}

// Панель паузы: без камеры в сцене ползункам кадра нечего крутить
let cameraAvailabilityUi = null;
function syncCameraAvailabilityUI(available) {
  if (available === cameraAvailabilityUi) return;
  cameraAvailabilityUi = available;
  // Меню паузы может прийти из сцены — берём актуальные элементы
  for (const panel of document.querySelectorAll('#pause')) {
    panel.classList.toggle('no-camera', !available);
  }
  const note = document.getElementById('camera-missing');
  if (note) note.hidden = available;
}

function hudLayerById(id) {
  const layer = hudLayers.find((item) => item.entity.id === id);
  if (layer) return layer;

  // Префаб перенумеровал сущность («hud-menu» → «hud-menu-1»):
  // слой тот же, ищем по префиксу
  return hudLayers.find((item) => item.entity.id.startsWith(`${id}-`)) || null;
}

/** Показ/скрытие слоёв из скриптов и консоли. */
const hudApi = {
  setVisible: (id, visible) => {
    const layer = hudLayerById(id);
    if (!layer) return false;

    layer.hidden = !visible;
    layer.el.classList.toggle('hidden', layer.hidden);
    if (id === MENU_LAYER_ID) setMenuOpen(visible);
    return true;
  },
  toggle: (id) => {
    const layer = hudLayerById(id);
    if (!layer) return null;

    layer.hidden = !layer.hidden;
    layer.el.classList.toggle('hidden', layer.hidden);
    if (id === MENU_LAYER_ID) setMenuOpen(!layer.hidden);
    return !layer.hidden;
  },
  isVisible: (id) => {
    const layer = hudLayerById(id);
    return layer ? !layer.hidden : false;
  },
  exists: (id) => Boolean(hudLayerById(id)),
  // Записать значение в контрол слоя (например, чтобы слайдер показал параметр)
  setValue: (controlId, value) => {
    const host = document.getElementById('scene-hud');
    const node = (host && host.querySelector(`#${controlId}`)) || document.getElementById(controlId);
    if (!node) return false;

    node.value = String(value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  },
  // Значение контрола внутри слоя (id элемента внутри HTML-файла)
  value: (controlId) => {
    const host = document.getElementById('scene-hud');
    const node = (host && host.querySelector(`#${controlId}`)) || document.getElementById(controlId);
    return node ? node.value : null;
  },
  setText: (id, text) => {
    const host = document.getElementById('scene-hud');
    const node = (host && host.querySelector(`#${id}`)) || document.getElementById(id);
    if (!node) return false;
    node.textContent = String(text);
    return true;
  },
  setStyle: (id, property, value) => {
    const host = document.getElementById('scene-hud');
    const node = (host && host.querySelector(`#${id}`)) || document.getElementById(id);
    if (!node) return false;
    node.style[property] = value;
    return true;
  },
  setClass: (id, name, enabled) => {
    const host = document.getElementById('scene-hud');
    const node = (host && host.querySelector(`#${id}`)) || document.getElementById(id);
    if (!node) return false;
    node.classList.toggle(name, Boolean(enabled));
    return true;
  },
  onClick: (id, handler) => {
    const host = document.getElementById('scene-hud');
    const node = (host && host.querySelector(`#${id}`)) || document.getElementById(id);
    if (!node || typeof handler !== 'function') return null;

    const listener = (event) => {
      event.preventDefault();
      handler(event);
    };

    node.addEventListener('click', listener);
    return () => node.removeEventListener('click', listener);
  }
};

// Низкоуровневые эффекты: скрипты присылают лучи, трассеры и ракеты,
// движок только рисует их и гасит по ttl.
const effects = new EffectSystem();
// Материалы как данные: id → нормализованное описание (public/materials)
const materials = new Map();

// Отдача от столкновения: тряска камеры и короткая вспышка
const impact = { shake: 0 };
window.__galaxyImpact = impact;

/* ------------------------------- Физика -------------------------------- */

// Корабль — динамическое тело с массой, астероиды — статические тела.
// Восстановление скорости 0.55 и трение 0.18 сохраняют прежнее ощущение удара,
// но теперь импульсы считаются через массы и нормаль контакта.
const SHIP_MASS = 12;
const SHIP_RESTITUTION = 0.55;
const SHIP_FRICTION = 0.18;
const ASTEROID_FRICTION = 0.2;

const physics = new PhysicsWorld({
  gravity: [0, 0, 0],
  fixedStep: 1 / 120,
  maxSubSteps: 6,
  iterations: 10,
  positionIterations: 4
});

let shipBody = null;

const impactLog = [];
physics.on('impact', (event) => {
  if (!shipBody || (event.a !== shipBody && event.b !== shipBody)) return;

  const approach = Math.max(0, event.speed);
  impact.shake = Math.min(1, impact.shake + Math.min(1, approach / 45) * 0.9 + 0.15);

  impactLog.push({ speed: approach, point: event.point });
  if (impactLog.length > 24) impactLog.shift();
});

const copyVec3 = (target, source) => {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
  return target;
};

// Коллайдер корпуса: три сферы вдоль оси Z из модели. Для моделей без
// collision-данных (OBJ / spec) строим такой же набор по длине корпуса.
function collisionShapeFor(model) {
  const collision = model?.collision;
  if (collision?.points?.length && collision.radius > 0) {
    return compoundShape(
      collision.points.map((offset) => ({ offset, radius: collision.radius }))
    );
  }

  const length = model?.length || 7.4;
  const radius = Math.max(0.8, length * 0.22);
  const offset = length * 0.28;
  return compoundShape([
    { offset: [0, 0, -offset], radius },
    { offset: [0, 0, 0], radius },
    { offset: [0, 0, offset], radius }
  ]);
}

function modelOfEntity(entity) {
  if (entity?.model) return entity.model;

  for (const child of entity.children || []) {
    const model = modelOfEntity(child);
    if (model) return model;
  }

  return null;
}

/** Взял ли подсистему скрипт (иначе движок работает сам). */
function scriptOwns(name) {
  return Boolean(scripts && scripts.claims && scripts.claims.has(name));
}

function rebuildShipBody() {
  if (!shipModel) return;

  if (shipBody) {
    physics.removeBody(shipBody);
    shipBody = null;
  }

  shipBody = physics.addBody({
    name: `ship:${shipModel.id || 'custom'}`,
    type: 'dynamic',
    mass: SHIP_MASS,
    position: ship.pos,
    quaternion: ship.quat,
    velocity: ship.vel,
    lockRotation: true, // ориентацией управляет игрок, а не физика
    restitution: SHIP_RESTITUTION,
    friction: SHIP_FRICTION,
    shape: collisionShapeFor(shipModel),
    userData: { kind: 'ship' }
  });

  physics.resetClock();

  console.log(
    `[physics] корпус ${shipModel.name}: сфер ${shipBody.shape.spheres.length}, ` +
    `радиус ${shipBody.shape.boundingRadius.toFixed(2)}`
  );
}

function syncShipBody() {
  if (!shipBody) return;
  shipBody.setPosition(ship.pos);
  shipBody.setQuaternion(ship.quat);
  shipBody.setVelocity(ship.vel);
}

/* --- отладочный показ коллайдеров: F3 или ?debug=1 --- */

let showPhysicsDebug = new URLSearchParams(location.search).get('debug') === '1';
const physicsStatsEl = document.getElementById('physics-stats');
if (showPhysicsDebug && physicsStatsEl) physicsStatsEl.classList.add('open');

window.addEventListener('keydown', (event) => {
  if (event.code === 'F3') {
    event.preventDefault();
    if (event.repeat) return;
    showPhysicsDebug = !showPhysicsDebug;
    if (physicsStatsEl) physicsStatsEl.classList.toggle('open', showPhysicsDebug);
  }

});

function pushDebugLine(vertices, from, to, color) {
  vertices.push(
    from[0], from[1], from[2], color[0], color[1], color[2],
    to[0], to[1], to[2], color[0], color[1], color[2]
  );
}

function pushDebugSphere(vertices, center, radius, color) {
  // Сетка вместо колец: объём читается сразу, заливки и текстур нет —
  // это чистые линии отладочного слоя
  pushWireSphere(vertices, center, radius, color);
}

function pushDebugBox(vertices, body, color) {
  pushDebugBoxAt(vertices, body.position, body.quaternion, body.shape.halfExtents, color);
}

function pushDebugBoxAt(vertices, position, quaternion, half, color) {
  const corners = [];

  // Индекс угла — три бита знака: любая перестановка осей даёт те же рёбра
  for (let index = 0; index < 8; index++) {
    const offset = quatRotate(quaternion, [
      (index & 1 ? 1 : -1) * half[0],
      (index & 2 ? 1 : -1) * half[1],
      (index & 4 ? 1 : -1) * half[2]
    ]);

    corners.push([
      position[0] + offset[0],
      position[1] + offset[1],
      position[2] + offset[2]
    ]);
  }

  pushWireBoxCorners(vertices, corners, color);
}

function buildDebugLines() {
  const vertices = [];

  for (const body of physics.bodies) {
    const color = body.userData?.kind === 'ship'
      ? [0.35, 0.85, 1.0]
      : [1.0, 0.58, 0.25];

    // Сферы — сеткой, боксы (включая части compound) — рёбрами OBB
    for (const sphere of getWorldSpheres(body)) {
      pushDebugSphere(vertices, sphere.center, sphere.radius, color);
    }

    for (const box of getWorldBoxes(body)) {
      pushDebugBoxAt(vertices, box.center, box.quaternion, box.halfExtents, color);
    }
  }

  // Триггеры — не тела физики: рисуем их объёмы отдельно
  for (const entity of sceneEntities) {
    if (!entity.trigger || entity.visible === false) continue;

    const color = [0.55, 1.0, 0.6];
    const center = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];

    if (entity.trigger.shape === 'sphere') {
      pushDebugSphere(vertices, center, entity.trigger.radius * entity.scaleUniform, color);
      continue;
    }

    const half = [
      entity.trigger.size[0] * 0.5,
      entity.trigger.size[1] * 0.5,
      entity.trigger.size[2] * 0.5
    ];
    const corners = [];

    for (let index = 0; index < 8; index++) {
      const offset = M4.transformDirection(entity.matrix, [
        (index & 1 ? 1 : -1) * half[0],
        (index & 2 ? 1 : -1) * half[1],
        (index & 4 ? 1 : -1) * half[2]
      ]);

      corners.push([center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]]);
    }

    pushWireBoxCorners(vertices, corners, color);
  }

  // Точки контактов — маленькие красные кресты
  for (const contact of physics.contacts) {
    const [x, y, z] = contact.point;
    const size = 0.55;
    const color = [1.0, 0.24, 0.18];
    pushDebugLine(vertices, [x - size, y, z], [x + size, y, z], color);
    pushDebugLine(vertices, [x, y - size, z], [x, y + size, z], color);
    pushDebugLine(vertices, [x, y, z - size], [x, y, z + size], color);
  }

  return vertices;
}

function drawDebugLines(vertices) {
  if (!vertices.length) return;

  const data = new Float32Array(vertices);
  gl.bindBuffer(gl.ARRAY_BUFFER, debugLineBuffer);
  if (data.byteLength > debugLineCapacity) {
    debugLineCapacity = data.byteLength * 2;
    gl.bufferData(gl.ARRAY_BUFFER, debugLineCapacity, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);

  gl.useProgram(debugProgram.program);
  gl.uniformMatrix4fv(debugLoc.u.uViewProj, false, viewProj);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.bindBuffer(gl.ARRAY_BUFFER, debugLineBuffer);
  gl.enableVertexAttribArray(debugLoc.aPosition);
  gl.vertexAttribPointer(debugLoc.aPosition, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(debugLoc.aColor);
  gl.vertexAttribPointer(debugLoc.aColor, 3, gl.FLOAT, false, 24, 12);

  gl.drawArrays(gl.LINES, 0, vertices.length / 6);
}

function drawPhysicsDebug() {
  if (!showPhysicsDebug) return;
  drawDebugLines(buildDebugLines());
}


function pulseTargetMarker() {
  if (!targetMarker) return;

  targetMarker.classList.remove('fire');
  void targetMarker.offsetWidth;
  targetMarker.classList.add('fire');

  clearTimeout(targetFireTimer);
  targetFireTimer = setTimeout(() => targetMarker.classList.remove('fire'), 460);
}

// Мёртвая зона в центре экрана, чтобы корабль не дрожал от мелких движений мыши
function deadZone(value, width = 0.06) {
  if (Math.abs(value) < width) return 0;
  return (value - Math.sign(value) * width) / (1 - width);
}

// Отладочный доступ к состоянию (удобно проверять из консоли)
window.__galaxy = {
  ship,
  camera,
  orbit,
  target: targetState,
  targets: targetsApi,
  effects,
  cursor,
  keys,
  physics,
  impacts: impactLog,
  project: (point) => projectWorldPoint(point),
  // Отладка привязки HUD: слой с follow: parent/entity/target
  updateHud: () => updateAttachedHud(),
  // Сколько отрезков даёт отладочный слой F3 (коллайдеры + триггеры + контакты)
  debugLines: () => buildDebugLines().length / 6,
  get hudLayers() {
    return hudLayers.map((layer) => ({
      id: layer.entity.id,
      follow: layer.hud.follow,
      attached: Boolean(layer.attached),
      left: layer.el.style.left,
      top: layer.el.style.top
    }));
  },
  get shipBody() {
    return shipBody;
  },
};

/* Камера доворачивается за курсором — и в обычном режиме, и при скриптах */
function updateCameraAim(dt, freeLook, keyYaw) {
  // Пока открыто меню, курсор не крутит камеру и корабль
  if (menuOpen) freeLook = true;
  // На время обзора управление курсом замораживается: мышью вращаем камеру,
  // а не корабль. Тяга и физика продолжают работать.
  const cmdYaw = freeLook ? 0 : (-deadZone(cursor.x) + keyYaw) * CAM_YAW_RATE;
  const cmdPitch = freeLook ? 0 : -deadZone(cursor.y) * CAM_PITCH_RATE;

  const camK = Math.min(1, dt * CAM_ACCEL);
  camera.yawRate += (cmdYaw - camera.yawRate) * camK;
  camera.pitchRate += (cmdPitch - camera.pitchRate) * camK;

  if (!freeLook && camera.yawRate) {
    camera.quat = quatNormalize(quatMul(camera.quat, quatFromAxisAngle([0, 1, 0], camera.yawRate * dt)));
  }
  if (!freeLook && camera.pitchRate) {
    camera.quat = quatNormalize(quatMul(camera.quat, quatFromAxisAngle([1, 0, 0], camera.pitchRate * dt)));
  }
}

/** Ориентация, при которой центр кадра смотрит в прицел. Для rotation.js. */
function aimQuaternion() {
  const aimForward = computeAimForward();
  if (!aimForward) return null;

  const cameraForward = quatRotate(camera.quat, [0, 0, -1]);
  return quatNormalize(quatMul(quatFromTo(cameraForward, aimForward), camera.quat));
}

/** Игрок — сущность сцены: движок шагает физику и синхронизирует ship. */
function updateShipScripted(dt) {
  const freeLook = orbit.active;

  // Курс считает скрипт из положения мыши: камера просто едет за корпусом,
  // мышь её не крутит — отсюда плавная картинка без рывков.
  if (!scriptOwns('camera')) {
    camera.quat = quatNlerp(camera.quat, ship.quat, 1 - Math.exp(-CAM_FOLLOW * dt));
    camera.yawRate = 0;
    camera.pitchRate = 0;
  }

  // Настройки из панели паузы — скриптам: пределы и резкость реакции на мышь
  if (playerEntity?.controls) {
    playerEntity.controls.maxSpeed = settings.maxSpeed;
    playerEntity.controls.maxTurn = settings.turnRate;
    playerEntity.controls.turnAccel = settings.cameraSmooth;
    playerEntity.controls.lookAround = freeLook;
  }

  const body = playerEntity.body;
  if (body) {
    physics.step(dt);
    copyVec3(playerEntity.position, body.position);
    playerEntity.quaternion = body.quaternion.slice();
    copyVec3(ship.pos, body.position);
    copyVec3(ship.vel, body.velocity);
  } else {
    copyVec3(ship.pos, playerEntity.position);
    copyVec3(ship.vel, playerEntity.velocity || [0, 0, 0]);
  }

  ship.quat = playerEntity.quaternion.slice();
  ship.turnRate = playerEntity.controls?.turnRate || 0;
  ship.bank += ((playerEntity.controls?.bank || 0) - ship.bank) * Math.min(1, dt * 5);

  return {
    thrustInput: playerEntity.controls?.thrust || 0,
    speed: Math.hypot(ship.vel[0], ship.vel[1], ship.vel[2])
  };
}

function updateShipObserver(dt) {
  // Камера смотрит из точки сцены и крутится мышью; корабля нет
  updateCameraAim(dt, orbit.active, 0);
  return { thrustInput: 0, speed: 0 };
}

function updateShip(dt) {
  if (playerEntity) return updateShipScripted(dt);
  if (observerMode) return updateShipObserver(dt);

  const keyYaw = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
  const thrustInput = (keys.w ? 1 : 0) - (keys.s ? 0.6 : 0);
  const freeLook = orbit.active;

  updateCameraAim(dt, freeLook, keyYaw);

  /* --- корабль доворачивает точку попадания в центр кадра --- */
  const canCenterTarget = !freeLook && orbit.blend < 0.01;
  const desiredQuat = (canCenterTarget ? aimQuaternion() : null) || ship.quat;

  let delta = quatMul(desiredQuat, quatConjugate(ship.quat));
  if (delta[3] < 0) delta = [-delta[0], -delta[1], -delta[2], -delta[3]];

  const w = clamp(delta[3], -1, 1);
  const angle = 2 * Math.acos(w);
  const sinHalf = Math.sqrt(Math.max(1e-8, 1 - w * w));
  const axis = angle < 1e-4 ? [0, 1, 0] : [delta[0] / sinHalf, delta[1] / sinHalf, delta[2] / sinHalf];

  const desiredTurn = freeLook || angle < 1e-5
    ? 0
    : Math.min(settings.turnRate, angle * SHIP_TURN_GAIN);
  ship.turnRate += (desiredTurn - ship.turnRate) * Math.min(1, dt * SHIP_TURN_ACCEL);

  const step = freeLook ? 0 : Math.min(angle, ship.turnRate * dt);
  if (!freeLook) {
    if (step > 1e-6) {
      const invShip = quatConjugate(ship.quat);
      const localAxis = quatRotate(invShip, axis);
      const yawComponent = (localAxis[1] * step) / Math.max(dt, 1e-4);

      ship.quat = quatNormalize(quatMul(quatFromAxisAngle(axis, step), ship.quat));

      // Крен в вираж: чем быстрее поворот, тем сильнее наклон
      const bankTarget = clamp(yawComponent * 0.24, -0.5, 0.5);
      ship.bank += (bankTarget - ship.bank) * Math.min(1, dt * 5);
    } else {
      ship.bank += (0 - ship.bank) * Math.min(1, dt * 3);
    }
  }

  const forward = quatRotate(ship.quat, [0, 0, -1]);
  const accel = thrustInput >= 0 ? ACCEL : REVERSE_ACCEL;

  for (let i = 0; i < 3; i++) {
    ship.vel[i] += forward[i] * thrustInput * accel * dt;
    ship.vel[i] *= Math.exp(-DRAG * dt);
  }

  const speed = Math.hypot(ship.vel[0], ship.vel[1], ship.vel[2]);
  if (speed > settings.maxSpeed) {
    const k = settings.maxSpeed / speed;
    for (let i = 0; i < 3; i++) ship.vel[i] *= k;
  }

  // Позицию интегрирует и столкновения разрешает физический мир.
  // Ориентация остаётся за игроком: тело корабля имеет lockRotation.
  if (shipBody) {
    syncShipBody();
    physics.step(dt);
    copyVec3(ship.pos, shipBody.position);
    copyVec3(ship.vel, shipBody.velocity);
  }

  // Скорость после удара — ею же регулируется свечение двигателей.
  const finalSpeed = Math.hypot(ship.vel[0], ship.vel[1], ship.vel[2]);
  return { thrustInput, speed: finalSpeed };
}

/* -------------------------------- Отрисовка ------------------------------ */

let shipModel = null;
let shipMatrix = M4.identity();
let viewProj = M4.identity();
let viewMatrix = M4.identity();

/* --- астероиды: статичные ориентиры в мире --- */
// Сцена приходит из public/scenes/<id>.scene.json; asteroids — её добываемые
// объекты в формате, который ждёт mining.js (pos / radius / hitTest / angle).
let scene = null;
let sceneEntities = [];
let scripts = null;
let prefabRuntime = null;   // сборка префабов в рантайме
let projectiles = null;     // снаряды из префабов (ракета и будущие)
let asteroids = [];
let playerEntity = null;   // сущность игрока из сцены (префаб корабля)
let observerMode = false;  // в сцене нет игрока — только камера
// Параметры кадра: их задаёт только сцена — объект «камера» или скрипт camera.js.
// Своих значений у встроенной камеры нет: без камеры в сцене кадр не рисуется.
const cameraTuning = { height: 0, drop: 0, distance: 0, side: 0, fov: 50, lag: 0, tilt: 0 };
// В сцене есть камера: объект «камера» или параметры camera.js на игроке
let sceneCameraAvailable = false;
let menuOpen = false;
// Луч из камеры через курсор мыши: задаёт сторону, куда смотрит добывающий лазер.
function cursorRay() {
  const aspect = canvas.width / Math.max(1, canvas.height);

  return {
    origin: camera.pos.slice(),
    // cursor.y растёт вниз по экрану, а NDC — вверх, поэтому знак обратный.
    direction: cursorRayDirection(viewMatrix, cursor.x, -cursor.y, aspect, (50 * Math.PI) / 180)
  };
}

/* ------------------------- Взаимодействие с мышью ------------------------- */

/** Луч из камеры через курсор — для наведения и клика по моделям. */
function pointerRay() {
  const aspect = canvas.width / Math.max(1, canvas.height);

  return {
    origin: camera.pos.slice(),
    direction: cursorRayDirection(
      viewMatrix,
      cursor.x,
      -cursor.y,
      aspect,
      ((cameraTuning.fov || 50) * Math.PI) / 180
    )
  };
}

/** Модели, у которых в настройках включён нужный флажок мыши. */
function pointerCandidates(flag) {
  return sceneEntities.filter((entity) => entity.raw?.mouse?.[flag]
    && entity.visible !== false
    && entity.model?.bounds);
}

function clearPointerHover() {
  if (!hoveredPointerEntity) return;

  const previous = hoveredPointerEntity;
  hoveredPointerEntity = null;
  scripts?.emit({ type: 'pointer.leave', id: previous.id, entity: previous });
}

/** Наведение: событие при входе в модель и при выходе из неё. */
function updatePointerHover() {
  if (!scripts || paused || menuOpen || orbit.active) {
    clearPointerHover();
    return;
  }

  const candidates = pointerCandidates('hover');
  if (!candidates.length) {
    clearPointerHover();
    return;
  }

  const hit = pickClosest(pointerRay(), candidates);
  const entity = hit?.entity || null;
  if (entity === hoveredPointerEntity) return;

  const previous = hoveredPointerEntity;
  hoveredPointerEntity = entity;

  if (previous) scripts.emit({ type: 'pointer.leave', id: previous.id, entity: previous });
  if (entity) scripts.emit({ type: 'pointer.hover', id: entity.id, entity, point: hit.point });
}

/** Клик: событие только по моделям с включённым флажком «определять клик». */
function handlePointerClick(event) {
  if (!scripts || paused || menuOpen || orbit.active) return;

  const candidates = pointerCandidates('click');
  if (!candidates.length) return;

  const hit = pickClosest(pointerRay(), candidates);
  if (!hit) return;

  scripts.emit({
    type: 'pointer.click',
    id: hit.entity.id,
    entity: hit.entity,
    point: hit.point,
    screen: { x: cursorScreen.x, y: cursorScreen.y }
  });
}

// Сцена целиком описана в public/scenes/*.scene.json: меши, тела,
// вращение и зоны добычи собирает scene-runtime.js.

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
  return dpr;
}


function drawEffects(time, dpr) {
  const beams = effects.byType('beam');
  const tracers = effects.byType('tracer');
  const smokes = effects.byType('smoke');
  const sparks = effects.byType('spark');

  if (!beams.length && !tracers.length && !smokes.length && !sparks.length) return;

  const cameraRight = [viewMatrix[0], viewMatrix[4], viewMatrix[8]];
  const cameraUp = [viewMatrix[1], viewMatrix[5], viewMatrix[9]];

  /* --- дымные следы --- */
  if (smokes.length) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(smokeProgram.program);

    gl.uniformMatrix4fv(smokeLoc.u.uViewProj, false, viewProj);
    gl.uniform3fv(smokeLoc.u.uRight, cameraRight);
    gl.uniform3fv(smokeLoc.u.uUp, cameraUp);

    gl.bindBuffer(gl.ARRAY_BUFFER, glowQuadBuffer);
    gl.enableVertexAttribArray(smokeLoc.aQuad);
    gl.vertexAttribPointer(smokeLoc.aQuad, 2, gl.FLOAT, false, 0, 0);

    for (const smoke of smokes) {
      gl.uniform3fv(smokeLoc.u.uCenter, smoke.position);
      gl.uniform3fv(smokeLoc.u.uColor, smoke.color || [0.68, 0.72, 0.8]);
      gl.uniform1f(smokeLoc.u.uSize, smoke.size ?? 1);
      gl.uniform1f(smokeLoc.u.uOpacity, smoke.opacity ?? 0.25);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.depthMask(true);
  }

  /* --- свечение трассеров и искр --- */
  if (sparks.length || tracers.length) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(glowProgram.program);

    gl.uniformMatrix4fv(glowLoc.u.uViewProj, false, viewProj);
    gl.uniform3fv(glowLoc.u.uRight, cameraRight);
    gl.uniform3fv(glowLoc.u.uUp, cameraUp);

    gl.bindBuffer(gl.ARRAY_BUFFER, glowQuadBuffer);
    gl.enableVertexAttribArray(glowLoc.aQuad);
    gl.vertexAttribPointer(glowLoc.aQuad, 2, gl.FLOAT, false, 0, 0);

    for (const tracer of tracers) {
      gl.uniform3fv(glowLoc.u.uCenter, tracer.to);
      gl.uniform3fv(glowLoc.u.uColor, tracer.color || [1.0, 0.62, 0.28]);
      gl.uniform1f(glowLoc.u.uSize, 0.55);
      gl.uniform1f(glowLoc.u.uIntensity, 2.2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    for (const spark of sparks) {
      gl.uniform3fv(glowLoc.u.uCenter, spark.position);
      gl.uniform3fv(glowLoc.u.uColor, spark.color || [1.0, 0.72, 0.32]);
      gl.uniform1f(glowLoc.u.uSize, spark.size ?? 0.9);
      gl.uniform1f(glowLoc.u.uIntensity, spark.intensity ?? 1.8);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.depthMask(true);
  }

  /* --- лучи и трассеры: светящиеся полосы между точками --- */
  if (beams.length || tracers.length) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(beamProgram.program);

    gl.uniform2fv(beamLoc.u.uViewport, [canvas.width, canvas.height]);
    gl.bindBuffer(gl.ARRAY_BUFFER, beamQuadBuffer);
    gl.enableVertexAttribArray(beamLoc.aQuad);
    gl.vertexAttribPointer(beamLoc.aQuad, 2, gl.FLOAT, false, 0, 0);

    const drawLine = (item, fallbackWidth, fallbackIntensity) => {
      const from = projectWorldPoint(item.from);
      const to = projectWorldPoint(item.to);
      if (!from || !to) return;

      gl.uniform2fv(beamLoc.u.uStartNdc, from.ndc);
      gl.uniform2fv(beamLoc.u.uEndNdc, to.ndc);
      gl.uniform1f(beamLoc.u.uStartZ, from.ndcZ);
      gl.uniform1f(beamLoc.u.uEndZ, to.ndcZ);
      gl.uniform3fv(beamLoc.u.uColor, item.color || [1.0, 0.42, 0.12]);
      gl.uniform1f(beamLoc.u.uWidth, (item.width ?? fallbackWidth) * dpr);
      gl.uniform1f(beamLoc.u.uIntensity, item.intensity ?? fallbackIntensity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    for (const beam of beams) drawLine(beam, 12, 2.2);
    for (const tracer of tracers) drawLine(tracer, 8, 1.6);

    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
  }

  gl.disable(gl.BLEND);
  gl.depthMask(true);
}

// Одна деталь меша: матрица, материал и буферы. Вынесено, чтобы куб,
// ядро и остальная сцена рисовались одним и тем же кодом.
function drawMeshPart(part, matrix, emissive = part.emissive) {
  gl.uniformMatrix4fv(meshLoc.u.uModel, false, matrix);
  gl.uniformMatrix3fv(meshLoc.u.uNormalMat, false, M4.normalMatrix(matrix));
  gl.uniform3fv(meshLoc.u.uColor, part.color);
  gl.uniform3fv(meshLoc.u.uTint, part.tint || [1, 1, 1]);
  gl.uniform3fv(meshLoc.u.uEmissive, emissive);
  gl.uniform1f(meshLoc.u.uSpecular, part.specular);
  gl.uniform1f(meshLoc.u.uMetal, part.metal ?? 0.0);
  gl.uniform1f(meshLoc.u.uTextureColor, part.textureColor ? 1 : 0);

  if (part.material) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, part.material.albedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, part.material.rough);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, part.material.metal);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, part.material.emissive || part.material.albedo);
    gl.uniform1f(meshLoc.u.uEmissiveMapOn, part.material.emissive ? 1 : 0);
    gl.uniform1f(meshLoc.u.uTextured, 1);
  } else {
    gl.uniform1f(meshLoc.u.uTextured, 0);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.positionBuffer);
  gl.enableVertexAttribArray(meshLoc.aPosition);
  gl.vertexAttribPointer(meshLoc.aPosition, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.normalBuffer);
  gl.enableVertexAttribArray(meshLoc.aNormal);
  gl.vertexAttribPointer(meshLoc.aNormal, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.uvBuffer);
  gl.enableVertexAttribArray(meshLoc.aUv);
  gl.vertexAttribPointer(meshLoc.aUv, 2, gl.FLOAT, false, 0, 0);

  if (part.mesh.indexBuffer) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indexBuffer);
    gl.drawElements(gl.TRIANGLES, part.mesh.count, part.mesh.indexType, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, part.mesh.count);
  }
}

/** Деталь щита: та же геометрия, но программа shield и без текстур. */
function drawShieldPart(part, matrix) {
  gl.uniformMatrix4fv(shieldLoc.u.uModel, false, matrix);

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.positionBuffer);
  gl.enableVertexAttribArray(shieldLoc.aPosition);
  gl.vertexAttribPointer(shieldLoc.aPosition, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.normalBuffer);
  gl.enableVertexAttribArray(shieldLoc.aNormal);
  gl.vertexAttribPointer(shieldLoc.aNormal, 3, gl.FLOAT, false, 0, 0);

  if (part.mesh.indexBuffer) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indexBuffer);
    gl.drawElements(gl.TRIANGLES, part.mesh.count, part.mesh.indexType, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, part.mesh.count);
  }
}

function hexToRgb(hex, fallback = [0, 0, 0]) {
  if (typeof hex !== 'string') return fallback.slice();

  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback.slice();

  const value = Number.parseInt(full, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Фон кадра: цвет камеры сцены, иначе фон сцены, иначе чёрный. */
function cameraBackgroundRgb() {
  const cameraEntity = sceneEntities.find((entity) => entity.type === 'camera' && entity.raw.visible !== false);
  const color = cameraEntity?.raw?.camera?.background || scene?.background || '#000000';
  return hexToRgb(color, [0, 0, 0]);
}

function render(time) {
  window.__frames = (window.__frames || 0) + 1;
  const dpr = resize();
  // На паузе мир замирает: корабль не движется и не вращается, камера не крутится,
  // но настройки продолжают применяться к кадру
  const state = paused ? { thrustInput: 0, speed: 0 } : updateShip(time.dt);

  // У сущности-игрока матрица своя; nose/прицел считаются от неё же
  shipMatrix = playerEntity
    ? playerEntity.matrix
    : M4.mul(
      M4.translation(ship.pos[0], ship.pos[1], ship.pos[2]),
      M4.mul(quatToMat4(ship.quat), M4.rotZ(ship.bank))
    );

  const targetWorld = shipModel ? computeTargetWorld() : null;

  if (!paused && scripts) scripts.update(time.dt);
  if (!paused && projectiles) projectiles.update(time.dt);
  updateScene(sceneEntities, time.dt);
  effects.update(time.dt);

  // Камеру задаёт сцена. Нет камеры — рисовать нечем: остаётся только фон кадра.
  const cameraAvailable = hasCameraSource();
  syncCameraAvailabilityUI(cameraAvailable);

  if (!cameraAvailable) {
    cameraPositionReady = false;
    updateTargetMarker(null);
    if (reticleView) reticleView.hide();
    if (cursorReticleView) cursorReticleView.hide();
    if (sceneCursorView) sceneCursorView.hide();
    for (const layer of hudLayers) {
      if (layer.hud.follow !== 'mouse') layer.el.classList.remove('visible');
    }
    const background = cameraBackgroundRgb();
    gl.clearColor(background[0], background[1], background[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return;
  }

  // Камера живёт своей ориентацией: она плавно доворачивается за курсором,
  // а корабль догоняет её со своими предельными угловыми скоростями —
  // поэтому в вираже видно, как нос отстаёт от центра кадра и подтягивается обратно.
  const cameraMat = quatToMat4(camera.quat);
  // Габариты модели: камера и сдвиг масштабируются под размер корабля
  const baseOffset = camOffset && camOffset.length === 3
    ? camOffset
    : cameraOffsetOf(cameraTuning);
  // Наклон камеры: ось — правый вектор корабля, выведенный из его
  // forwardVector. Поэтому наклон не зависит от того, куда смотрит мышь,
  // и поворачивается вместе с корпусом при вираже или тангаже
  const tiltRad = ((cameraTuning.tilt || 0) * Math.PI) / 180;
  const shipRight = quatRotate(ship.quat, [1, 0, 0]);
  const tiltQuat = tiltRad ? quatFromAxisAngle(shipRight, tiltRad) : null;
  const worldOffset = M4.transformPoint(cameraMat, baseOffset);
  const chaseOffset = tiltQuat ? quatRotate(tiltQuat, worldOffset) : worldOffset;
  const chasePos = [
    ship.pos[0] + chaseOffset[0],
    ship.pos[1] + chaseOffset[1],
    ship.pos[2] + chaseOffset[2]
  ];
  // Смотрим строго вдоль оси камеры: смена высоты — это смещение, а не поворот
  let forward = quatRotate(camera.quat, [0, 0, -1]);
  if (tiltQuat) forward = quatRotate(tiltQuat, forward);
  const chaseLookAt = [
    chasePos[0] + forward[0],
    chasePos[1] + forward[1],
    chasePos[2] + forward[2]
  ];
  let up = M4.transformDirection(cameraMat, [0, 1, 0]);
  if (tiltQuat) up = quatRotate(tiltQuat, up);

  // Обзор: плавно смешиваем обычный вид с орбитой вокруг корабля.
  orbit.blend += ((orbit.active ? 1 : 0) - orbit.blend) * Math.min(1, time.dt * ORBIT_BLEND_SPEED);
  orbit.blend = clamp(orbit.blend, 0, 1);

  if (!orbit.active && orbit.blend < 0.001) {
    orbit.blend = 0;
    orbit.yaw = 0;
    orbit.pitch = 0;
  }

  let desired = chasePos;
  let lookAtPoint = chaseLookAt;

  if (orbit.blend > 0) {
    // Орбита считается в системе координат корабля вместе с креном,
    // поэтому камера облетает наклонённый корпус, а не мировую ось Y.
    const visual = shipVisualQuaternion();
    const radius = orbit.radius || Math.hypot(cameraTuning.height, cameraTuning.distance);
    const cosPitch = Math.cos(orbit.pitch);
    const localOffset = [
      Math.sin(orbit.yaw) * cosPitch * radius,
      Math.sin(orbit.pitch) * radius,
      Math.cos(orbit.yaw) * cosPitch * radius
    ];
    const orbitOffset = quatRotate(visual, localOffset);
    const orbitPos = [
      ship.pos[0] + orbitOffset[0],
      ship.pos[1] + orbitOffset[1],
      ship.pos[2] + orbitOffset[2]
    ];

    const orbitLookAt = [ship.pos[0], ship.pos[1], ship.pos[2]];
    const orbitUp = quatRotate(visual, [0, 1, 0]);

    const blend = smoothstep(orbit.blend);
    desired = mix3(chasePos, orbitPos, blend);
    lookAtPoint = mix3(chaseLookAt, orbitLookAt, blend);

    const blendedUp = mix3(up, orbitUp, blend);
    const upLength = Math.hypot(blendedUp[0], blendedUp[1], blendedUp[2]);
    up = upLength > 1e-6
      ? [blendedUp[0] / upLength, blendedUp[1] / upLength, blendedUp[2] / upLength]
      : [0, 1, 0];
  }

  // Плавность: камера догоняет точку за кормой, а не прилипает к ней
  if (cameraTuning.lag > 0 && cameraPositionReady) {
    const k = 1 - Math.exp(-cameraTuning.lag * time.dt);
    desired = [
      camera.pos[0] + (desired[0] - camera.pos[0]) * k,
      camera.pos[1] + (desired[1] - camera.pos[1]) * k,
      camera.pos[2] + (desired[2] - camera.pos[2]) * k
    ];
  }

  // Камера трясётся после удара и плавно успокаивается
  impact.shake = Math.max(0, impact.shake - time.dt * 2.2);
  const shakeAmount = impact.shake * 0.45;
  if (shakeAmount > 0.001) {
    const t = time.seconds * 47;
    camera.pos = [
      desired[0] + Math.sin(t * 1.7) * shakeAmount,
      desired[1] + Math.sin(t * 2.3 + 1.1) * shakeAmount,
      desired[2] + Math.sin(t * 1.9 + 2.4) * shakeAmount
    ];
  } else {
    camera.pos = desired;
  }
  cameraPositionReady = true;

  // Скрипт камеры перекрывает встроенный облёт: его поза уже сглажена
  const scriptedPose = scriptOwns('camera') ? scriptCameraPose : null;
  if (scriptedPose) {
    camera.pos = scriptedPose.position;
    lookAtPoint = scriptedPose.lookAt;
    up = scriptedPose.up;
  }

  viewMatrix = M4.lookAt(camera.pos, lookAtPoint, up);
  const renderFov = scriptedPose ? scriptedPose.fov : cameraTuning.fov;
  const proj = M4.perspective((renderFov * Math.PI) / 180, canvas.width / canvas.height, 0.1, 4000);

  // «Корабль ниже центра» — сдвиг кадра вниз без поворота камеры.
  // Скрипт уже учитывает drop в точке взгляда, проекцию не трогаем
  if (cameraTuning.drop && !scriptedPose) {
    const f = 1 / Math.tan((renderFov * Math.PI) / 360);
    proj[9] += (cameraTuning.drop * f) / Math.max(1, cameraTuning.distance);
  }
  viewProj = M4.mul(proj, viewMatrix);

  // Добыча считается после камеры: луч целится через курсор мыши.

  // Старый маркер выключен: прицел рисует только объект со скриптом reticle.js.
  // Мировая точка всё равно обновляется — её читает api.target.aim().
  updateTargetMarker(targetWorld, { applyDom: false });
  if (scriptOwns('reticle')) updateScriptedTarget();
  updateScriptedCursor();

  updateAttachedHud();

  const background = cameraBackgroundRgb();
  gl.clearColor(background[0], background[1], background[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  drawSkybox(renderFov);

  /* --- корабль --- */
  if (shipModel) {
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.useProgram(meshProgram.program);

    gl.uniformMatrix4fv(meshLoc.u.uViewProj, false, viewProj);
    gl.uniform3fv(meshLoc.u.uCamera, camera.pos);
    gl.uniform3fv(meshLoc.u.uLightDir, [0.35, 0.55, 0.76]);
    gl.uniform1f(meshLoc.u.uRoughness, 1.0);
    gl.uniform1i(meshLoc.u.uAlbedoMap, 0);
    gl.uniform1i(meshLoc.u.uRoughMap, 1);
    gl.uniform1i(meshLoc.u.uMetalMap, 2);
    gl.uniform1i(meshLoc.u.uEmissiveMap, 3);

    const drawList = sceneEntities
      .filter((entity) => entity.model && entity.visible !== false)
      .map((entity) => ({
        model: entity.model,
        matrix: entity.matrix,
        entity,
        material: entity.raw?.materialId ? materials.get(entity.raw.materialId) : null
      }));

    // В сцене игрок — обычная сущность: её модель уже в sceneEntities
    if (!playerEntity && shipModel) drawList.push({ model: shipModel, matrix: shipMatrix });

    // Непрозрачное — первым проходом, аддитивные ядра — вторым
    for (const item of drawList) {
      for (const part of item.model.parts) {
        if (part.blend === 'additive') continue;
        if (item.material?.shader === 'shield') continue;
        if (partHidden(item.entity?.raw?.hiddenParts, part.name)) continue;
        drawMeshPart(part, M4.mul(item.matrix, part.matrix));
      }
    }

    const pulse = 0.86 + 0.14 * Math.sin(time.seconds * 2.1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);

    for (const item of drawList) {
      for (const part of item.model.parts) {
        if (part.blend !== 'additive') continue;
        if (item.material?.shader === 'shield') continue;
        if (partHidden(item.entity?.raw?.hiddenParts, part.name)) continue;
        drawMeshPart(part, M4.mul(item.matrix, part.matrix), part.emissive.map((c) => c * pulse));
      }
    }

    /* --- энергетические щиты: прозрачная оболочка + пятна попаданий --- */
    const shields = drawList.filter((item) => item.material?.shader === 'shield');
    if (shields.length) {
      gl.useProgram(shieldProgram.program);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      gl.uniformMatrix4fv(shieldLoc.u.uViewProj, false, viewProj);
      gl.uniform3fv(shieldLoc.u.uCamera, camera.pos);

      const hitData = new Float32Array(16);

      for (const item of shields) {
        const uniforms = item.material.uniforms || {};

        gl.uniform3fv(shieldLoc.u.uColor, hexToRgb(uniforms.color, [0.35, 0.85, 1]));
        gl.uniform3fv(shieldLoc.u.uHitColor, hexToRgb(uniforms.hitColor, [0.92, 1, 1]));
        gl.uniform1f(shieldLoc.u.uBase, Number(uniforms.base) || 0);
        gl.uniform1f(shieldLoc.u.uFresnel, Number(uniforms.fresnel) || 3);
        gl.uniform1f(shieldLoc.u.uHitRadius, Number(uniforms.hitRadius) || 0.9);
        gl.uniform1f(shieldLoc.u.uHexScale, Number(uniforms.hexScale) || 6);
        gl.uniform1f(shieldLoc.u.uPatchLife, Number(uniforms.patchLife) || 0.35);

        const bounds = item.model?.bounds;
        const shieldCenter = bounds
          ? [
            (bounds.min[0] + bounds.max[0]) / 2,
            (bounds.min[1] + bounds.max[1]) / 2,
            (bounds.min[2] + bounds.max[2]) / 2
          ]
          : [0, 0, 0];
        const shieldSize = bounds
          ? [
            (bounds.max[0] - bounds.min[0]) / 2,
            (bounds.max[1] - bounds.min[1]) / 2,
            (bounds.max[2] - bounds.min[2]) / 2
          ]
          : [1, 1, 1];
        gl.uniform3fv(shieldLoc.u.uShieldCenter, shieldCenter);
        gl.uniform3fv(shieldLoc.u.uShieldSize, shieldSize);

        // Точки попадания уже в локальных координатах меша щита:
        // их перевёл shield.js в момент удара.
        hitData.fill(0);
        for (let i = 0; i < 4; i++) hitData[i * 4 + 3] = -1;

        const hits = item.entity?.shieldHits || [];
        for (let i = 0; i < Math.min(4, hits.length); i++) {
          const hit = hits[i];
          if (!hit?.position) continue;

          const local = hit.position;
          hitData[i * 4] = local[0];
          hitData[i * 4 + 1] = local[1];
          hitData[i * 4 + 2] = local[2];
          hitData[i * 4 + 3] = Math.max(0, Number(hit.age) || 0);
        }
        gl.uniform4fv(shieldLoc.u.uHits, hitData);

        for (const part of item.model.parts) {
          if (partHidden(item.entity?.raw?.hiddenParts, part.name)) continue;
          drawShieldPart(part, M4.mul(item.matrix, part.matrix));
        }

      }

      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Ореолы сущностей: билборд из центра; грани перекрывают его, остаётся сияние вокруг
    gl.useProgram(glowProgram.program);
    gl.uniformMatrix4fv(glowLoc.u.uViewProj, false, viewProj);
    gl.uniform3fv(glowLoc.u.uRight, [viewMatrix[0], viewMatrix[4], viewMatrix[8]]);
    gl.uniform3fv(glowLoc.u.uUp, [viewMatrix[1], viewMatrix[5], viewMatrix[9]]);

    gl.bindBuffer(gl.ARRAY_BUFFER, glowQuadBuffer);
    gl.enableVertexAttribArray(glowLoc.aQuad);
    gl.vertexAttribPointer(glowLoc.aQuad, 2, gl.FLOAT, false, 0, 0);

    for (const entity of sceneEntities) {
      if (!entity.glow || entity.visible === false) continue;

      gl.uniform3fv(glowLoc.u.uCenter, [entity.matrix[12], entity.matrix[13], entity.matrix[14]]);
      gl.uniform3fv(glowLoc.u.uColor, entity.glowColor);
      gl.uniform1f(glowLoc.u.uSize, entity.glow.size);
      gl.uniform1f(glowLoc.u.uIntensity, entity.glow.intensity * pulse);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    /* --- свечение двигателей --- */
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(glowProgram.program);

    const right = [viewMatrix[0], viewMatrix[4], viewMatrix[8]];
    const camUp = [viewMatrix[1], viewMatrix[5], viewMatrix[9]];
    gl.uniformMatrix4fv(glowLoc.u.uViewProj, false, viewProj);
    gl.uniform3fv(glowLoc.u.uRight, right);
    gl.uniform3fv(glowLoc.u.uUp, camUp);
    gl.uniform3fv(glowLoc.u.uColor, [1.0, 0.46, 0.16]);

    gl.bindBuffer(gl.ARRAY_BUFFER, glowQuadBuffer);
    gl.enableVertexAttribArray(glowLoc.aQuad);
    gl.vertexAttribPointer(glowLoc.aQuad, 2, gl.FLOAT, false, 0, 0);

    const flicker = 0.92 + 0.08 * Math.sin(time.seconds * 41.0);
    const base = 0.4 + Math.max(0, state.thrustInput) * 0.9 + Math.max(0, -state.thrustInput) * 0.2;

    shipModel.thrusters.forEach((thruster, index) => {
      const world = M4.transformPoint(shipMatrix, thruster.pos);
      const local = 0.93 + 0.07 * Math.sin(time.seconds * 37 + index * 2.1);
      const intensity = base * flicker * local;

      gl.uniform3fv(glowLoc.u.uCenter, world);

      gl.uniform1f(glowLoc.u.uSize, thruster.size * (0.5 + 0.4 * intensity));
      gl.uniform1f(glowLoc.u.uIntensity, intensity * 0.75);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.uniform1f(glowLoc.u.uSize, thruster.size * 2.6 * (0.6 + 0.4 * intensity));
      gl.uniform1f(glowLoc.u.uIntensity, intensity * 0.2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

  }

  drawEffects(time, dpr);

  // Отладочные коллайдеры, триггеры и точки контактов — поверх сцены, без глубины.
  drawPhysicsDebug();
}

/* ------------------------------- Цикл кадров ------------------------------ */

let last = performance.now();
let hudTimer = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const seconds = now / 1000;

  render({ dt, seconds });

  hudTimer += dt;
  if (hudTimer > 0.08) {
    hudTimer = 0;

    if (showPhysicsDebug && physicsStatsEl) {
      const stats = physics.stats;
      physicsStatsEl.textContent = [
        `ФИЗИКА · ${Math.round(1 / physics.fixedStep)} ГЦ`,
        `тел ${physics.bodies.length} · пар ${stats.pairs} · контактов ${stats.contacts}`,
        `подшагов ${stats.steps} · ударов ${stats.impacts}`
      ].join('\n');
    }
  }

  requestAnimationFrame(frame);
}

/* --------------------------------- Старт --------------------------------- */

async function defaultSceneId() {
  try {
    const index = await fetch('scenes/index.json', { cache: 'no-store' }).then((response) => response.json());
    const first = Array.isArray(index.scenes) ? index.scenes.find((entry) => entry?.id) : null;
    return first ? first.id : 'first-game';
  } catch {
    return 'first-game';
  }
}

/**
 * Загрузить скрипт сцены и дать ему построить кадр через api.scene.build().
 * Движок использует только то, что скрипт передал в build.
 */
async function bootstrapSceneScript(document) {
  const script = document.scripts[0];
  if (!script) throw new Error('у сцены нет скрипта');

  const url = new URL(`scripts/${script.file}`, `${location.origin}/`);
  url.searchParams.set('t', String(Date.now()));
  const module = await import(url.href);
  const definition = module.default || module;

  const schema = module.params && typeof module.params === 'object' ? module.params : {};
  const defaults = {};
  for (const [key, meta] of Object.entries(schema)) {
    if (meta && Object.prototype.hasOwnProperty.call(meta, 'default')) defaults[key] = meta.default;
  }

  const params = { ...defaults, ...(script.params || {}) };
  let options = null;

  const ctx = {
    entity: { id: document.scene?.id || 'scene', type: 'scene', raw: { type: 'scene' } },
    params,
    state: {},
    api: {
      claim() {},
      log: (...args) => console.log('[scene]', ...args),
      scene: {
        build: (value) => {
          options = value && typeof value === 'object' ? { ...value } : {};
        }
      }
    }
  };

  if (typeof definition.init === 'function') definition.init(ctx);
  if (!options) {
    throw new Error(`скрипт сцены ${script.file} не вызвал api.scene.build(...)`);
  }

  return { file: script.file, definition, params, options };
}

(async () => {
  try {
    const params = new URLSearchParams(location.search);
    // Без ?scene= берём первую сцену из индекса, а не жёсткий id
    const sceneId = params.get('scene') || (await defaultSceneId());

    scene = await loadScene(sceneId);

    // Скрипт сцены обязателен: он строит кадр через api.scene.build()
    if (!Array.isArray(scene.scripts) || !scene.scripts.length) {
      fail('Сцена требует скрипт сцены (например first-screen.js) для взаимодействия с движком');
      return;
    }

    const sceneBootstrap = await bootstrapSceneScript(scene);
    const build = sceneBootstrap.options;

    // Только то, что скрипт передал в build; корневые поля сцены не читаются
    scene.background = build.background || '#000000';
    scene.scene.background = scene.background;
    scene.scene.hudStyle = build.hudStyle || null;
    scene.scene.loading = { file: build.loadingFile || '', script: build.loadingScript || '' };
    scene.cursor = build.cursor || null;

    // Стили HUD — из скрипта сцены, одни на все слои
    applySceneHudStyle(scene.scene.hudStyle);

    // Загрузочный экран — ассет сцены (HTML + скрипт)
    await startLoadingScreen(scene.scene?.loading);
    setLoadingProgress(0.08);

    // Определения эффектов — данные из public/effects; сцена ссылается на id.
    try {
      const effectList = await fetch('/api/effects', { cache: 'no-store' }).then((response) => response.json());
      for (const definition of effectList.effects || []) {
        effects.registerDefinition(definition.id, definition);
      }
    } catch (err) {
      console.warn('[effects] определения не загружены:', err.message);
    }

    // Материалы — те же данные, что увидит редактор; шейдер берёт uniforms
    try {
      const materialList = await fetch('/api/materials', { cache: 'no-store' }).then((response) => response.json());
      for (const item of materialList.materials || []) {
        try {
          const material = normalizeMaterial(item, item.id);
          materials.set(material.id, material);
        } catch (err) {
          console.warn(`[materials] ${item.id}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[materials] список не загружен:', err.message);
    }

    sceneEntities = await buildScene(gl, scene, {
      effects,
      onProgress: (done, total) => setLoadingProgress(0.08 + 0.52 * (done / total))
    });
    setLoadingProgress(0.6);

    // Skybox: одна панорама на сцену, без тела и без участия в физике
    const skyboxEntity = sceneEntities.find((entity) => entity.type === 'skybox'
      && entity.visible !== false
      && entity.raw?.skybox);
    if (skyboxEntity) {
      skyboxTexture = await loadSkyboxTexture(skyboxEntity.raw.skybox);
      if (skyboxTexture) setLoadingProgress(0.66);
    }

    attachBodies(sceneEntities, physics);
    bindEffectTriggers(sceneEntities, physics, effects);
    asteroids = sceneEntities.filter((entity) => entity.mining);

    // Игрок — просто сущность сцены, которой управляют скрипты.
    // Признак — скрипт input.js на корневом узле; движок корабль не создаёт.
    playerEntity = sceneEntities.find((entity) => !entity.parent
      && Array.isArray(entity.scripts)
      && entity.scripts.some((script) => (script.file || script) === 'input.js')) || null;

    // Ссылка сцены на объект-курсор: пусто — системный указатель
    sceneCursorId = scene.cursor || null;
    sceneCursorEntity = sceneCursorId
      ? sceneEntities.find((entity) => entity.id === sceneCursorId) || null
      : null;

    if (playerEntity) {
      shipModel = modelOfEntity(playerEntity);
      ship.pos = playerEntity.position.slice();
      ship.quat = playerEntity.quaternion.slice();
      ship.vel = playerEntity.body ? playerEntity.body.velocity.slice() : [0, 0, 0];
      // Камера сразу стоит за корпусом: иначе на старте было бы видно рывок
      camera.quat = ship.quat.slice();
    } else {
      // Сцена без игрока: только камера, никакого корабля
      observerMode = true;
      shipModel = null;
      ship.pos = scene.player.position.slice();
      ship.vel = [0, 0, 0];
      ship.quat = eulerToQuat(scene.player.rotation);
    }

    // Без игрока оружие, добыча и скорость не имеют смысла
    if (observerMode) {
      document.querySelectorAll('#weapons, #mining-hud').forEach((el) => el.remove());
    }

    // Снаряды из префабов: пул прогревается до игры, чтобы выстрел не собирал
    // поддерево в момент нажатия. Нет префаба — останется процедурный fallback.
    if (playerEntity) {
      try {
        prefabRuntime = createPrefabRuntime({ gl, physics, effects, entities: sceneEntities });
        const pool = createProjectilePool({ runtime: prefabRuntime, effects, prefab: 'rocket', size: 8 });
        await pool.prewarm();
        projectiles = createProjectileSystem({
          physics,
          effects,
          entities: sceneEntities,
          pool,
          onHit: (event) => scripts?.emit({ type: 'projectile.hit', ...event })
        });
        window.__galaxy.projectiles = projectiles;
      } catch (err) {
        console.warn('[projectiles] пул ракет не собран:', err.message);
        window.__galaxy.projectileError = err.message;
        projectiles = null;
      }
    }

    await loadSceneHud(sceneEntities);
    setLoadingProgress(0.78);

    window.__galaxy.scene = scene;
    window.__galaxy.entities = sceneEntities;
    window.__galaxy.materials = materials;
    window.__galaxy.hud = hudApi;
    window.__galaxy.camera = cameraApi;
    window.__galaxy.setTarget = (target) => {
      hudTargetEntity = typeof target === 'string'
        ? sceneEntities.find((entity) => entity.id === target) || null
        : target || null;
      return hudTargetEntity ? hudTargetEntity.id : null;
    };
    window.__galaxy.asteroids = asteroids;
    window.__galaxy.player = playerEntity;

    // Скрипты сцены: init при загрузке, update каждый кадр
    scripts = new ScriptRuntime({
      scene,
      entities: sceneEntities,
      ship,
      player: playerEntity,
      input: { keys, cursor, mouse, keysDown, cursorRay: () => cursorRay() },
      miningTargets: () => asteroids,
      flight: { aimQuaternion: () => aimQuaternion(), target: () => targetState.world.slice() },
      effects,
      camera: cameraApi,
      hud: hudApi,
      projectiles,
      prefabs: prefabRuntime,
      targets: targetsApi
    });
    await scripts.loadAll('../scripts/', { sceneScriptsReady: true });

    // Скрипт сцены должен реально загрузиться — без него игра не стартует
    const sceneScriptFile = scene.scripts[0]?.file || '';
    if (sceneScriptFile && scripts.errors.some((error) => error.includes(`загрузка ${sceneScriptFile}`))) {
      fail(`Скрипт сцены ${sceneScriptFile} не загрузился`);
      return;
    }

    setLoadingProgress(0.92);
    window.__galaxy.scripts = scripts;

    // Сцена собрана и скрипты инициализированы — движок может начинать
    window.__galaxy.ready = true;
    window.dispatchEvent(new CustomEvent('galaxy:scene-ready', {
      detail: { id: scene.id, entities: sceneEntities.length, player: playerEntity?.id || null }
    }));
    console.log(`[scene] ${scene.id}: сущностей ${sceneEntities.length}, добываемых ${asteroids.length}`);
    if (scene.title) document.title = `${scene.title} — GalaxyDemo`;
    // Камера сцены: если скрипт камеры её не забирает, параметры объекта
    // «camera» становятся настройками камеры игрока
    const sceneCamera = !scriptOwns('camera')
      ? sceneEntities.find((entity) => entity.type === 'camera' && entity.raw.visible !== false)
      : null;

    // Скрипт камеры отключён, но его сохранённые параметры применяем:
    // иначе правки в инспекторе не влияли бы на игру
    const playerCameraParams = !scriptOwns('camera')
      ? (playerEntity?.scripts || [])
        .map((script) => (typeof script === 'string' ? { file: script } : script))
        .find((script) => script.file === 'camera.js' && script.params)?.params || null
      : null;

    // Параметры объекта «камера» — единственный источник кадра без скрипта
    if (sceneCamera) cameraApi.set(sceneCamera.camera || sceneCamera.raw.camera);
    else if (playerCameraParams) cameraApi.set(playerCameraParams);
    sceneCameraAvailable = Boolean(sceneCamera || playerCameraParams);

    currentModelId = shipModel?.id || scene.player.model || 'corinth';
    if (MODEL_SETTINGS[currentModelId]) {
      Object.assign(settings, MODEL_SETTINGS[currentModelId]);
    }

    // Ползунки панели показывают параметры сцены: своих значений у движка нет
    settings.camHeight = cameraTuning.height;
    settings.shipDrop = cameraTuning.drop;
    syncSettingsUI();
    syncCameraUI();
    if (modelSelect && SHIP_MODELS.some((m) => m.id === currentModelId)) {
      modelSelect.value = currentModelId;
    }
    if (shipModel) {
      applyModelBind();
      console.log(`[ship] загружена модель: ${shipModel.name} (${shipModel.source})`);
    }
    setLoadingProgress(1);
    finishLoadingScreen();
    requestAnimationFrame((now) => {
      last = now;
      requestAnimationFrame(frame);
    });
  } catch (err) {
    console.error(err);
    fail(`Не удалось загрузить сцену: ${err.message}`);
  }
})();
