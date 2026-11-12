// Редактор сцен GalaxyDemo.
//
// Работает на том же рантайме, что и игра (scene.js + scene-runtime.js),
// поэтому в редакторе видно ровно то, что потом полетит в игре.
//
// Один файл на оба режима: scene и prefab (editor.html?scene= / ?prefab=).
// ПРАВИЛО: меняешь редактор — проверь оба режима, отдельных копий нет.
// Подробнее — docs/editor.md.

import { M4, quatConjugate, quatFromAxisAngle, quatFromMat4, quatMul, quatNormalize } from '../math.js';
import { createProgram } from '../gl.js';
import { meshVS, meshFS } from '../render/mesh-shader.js';
import { normalizeScene, eulerToQuat, quatToEuler, reassignIds } from '../scene.js';
import { buildScene, updateMatrices, updateScene } from '../scene-runtime.js';
import { EffectSystem } from '../effects.js';
import { bytesToBase64, packAsset, parseGlb } from '../glb.js';
import { pushLine, pushWireBoxCorners, pushWireSphere } from '../wire.js';

/* --------------------------------- DOM ----------------------------------- */

const canvas = document.getElementById('view');
const contextMenu = document.getElementById('context-menu');
const treeEl = document.getElementById('tree');
const treePanel = document.querySelector('.tree-panel');
const inspectorEl = document.getElementById('inspector');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const sceneSelect = document.getElementById('scene-select');
const playLink = document.getElementById('play-link');
const modeTitle = document.getElementById('mode-title');

const btnLoad = document.getElementById('btn-load');
const btnSave = document.getElementById('btn-save');
const btnRestore = document.getElementById('btn-restore');
const saveStateEl = document.getElementById('save-state');
const chkAutoSave = document.getElementById('chk-autosave');
const btnEmpty = document.getElementById('btn-empty');
const btnCamera = document.getElementById('btn-camera');
const btnTrigger = document.getElementById('btn-trigger');
const btnEffect = document.getElementById('btn-effect');
const btnImport = document.getElementById('btn-import');
const glbInput = document.getElementById('glb-input');
const assetSelect = document.getElementById('asset-select');
const btnModel = document.getElementById('btn-model');
const prefabSelect = document.getElementById('prefab-select');
const btnHud = document.getElementById('btn-hud');
const hudPreviewEl = document.getElementById('hud-preview');
const btnPrefabSave = document.getElementById('btn-prefab-save');
const btnPrefabEdit = document.getElementById('btn-prefab-edit');
const btnPrefabInsert = document.getElementById('btn-prefab-insert');
const btnPrefabDelete = document.getElementById('btn-prefab-delete');
const prefabDialog = document.getElementById('prefab-dialog');
const prefabDialogSelect = document.getElementById('prefab-dialog-select');
const btnPrefabDialogInsert = document.getElementById('prefab-dialog-insert');
const btnPrefabDialogCancel = document.getElementById('prefab-dialog-cancel');
const btnPrefabDialogClose = document.getElementById('prefab-dialog-close');
const gizmoRadios = [...document.querySelectorAll('input[name="gizmo"]')];
const btnDuplicate = document.getElementById('btn-duplicate');
const btnDelete = document.getElementById('btn-delete');
const chkGrid = document.getElementById('chk-grid');
const chkColliders = document.getElementById('chk-colliders');

/* --------------------------------- WebGL --------------------------------- */

const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
  || canvas.getContext('webgl', { antialias: true, alpha: false });

if (!gl) {
  statusEl.textContent = 'WebGL недоступен в этом браузере';
  statusEl.classList.add('error');
  throw new Error('WebGL недоступен');
}

const meshProgram = createProgram(gl, meshVS, meshFS);
const meshLoc = {
  u: meshProgram.uniforms,
  a: {
    position: gl.getAttribLocation(meshProgram.program, 'aPosition'),
    normal: gl.getAttribLocation(meshProgram.program, 'aNormal'),
    uv: gl.getAttribLocation(meshProgram.program, 'aUv')
  }
};

const lineVS = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uViewProj;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const lineFS = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}`;

const lineProgram = createProgram(gl, lineVS, lineFS);
const lineLoc = {
  u: lineProgram.uniforms,
  aPos: gl.getAttribLocation(lineProgram.program, 'aPos'),
  aColor: gl.getAttribLocation(lineProgram.program, 'aColor')
};
const lineBuffer = gl.createBuffer();
let lineCapacity = 0;

/* -------------------------------- Состояние ------------------------------- */

const state = {
  mode: 'scene',          // scene | prefab
  sceneId: 'first-game',
  prefabId: null,
  prefabTitle: '',
  doc: null,
  scene: null,
  sceneRoot: null,       // настройки корневого объекта «Сцена»
  entities: [],
  scripts: [],
  effects: [],
  prefabs: [],
  hudFiles: [],
  hudCache: new Map(),
  scriptSchemas: {},
  selectedId: null,
  gizmo: 'move',
  fileMtime: null,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  showGrid: true,
  showColliders: true,
  camera: { target: [0, 0, 0], distance: 46, yaw: 0.72, pitch: 0.42 },
  pointer: { down: false, moved: false, x: 0, y: 0 },
  drag: null,
  hoverAxis: -1
};

// Корневой объект сцены в дереве редактора: он один и не удаляется
const SCENE_ID = '__scene__';

// Предпросмотр эффектов в редакторе: те же инстансы, что в игре.
const effectPreview = new EffectSystem();
let lastPreviewTime = 0;

const AXES = [
  { dir: [1, 0, 0], color: [1.0, 0.35, 0.32] },
  { dir: [0, 1, 0], color: [0.45, 1.0, 0.5] },
  { dir: [0, 0, 1], color: [0.4, 0.65, 1.0] }
];

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', Boolean(isError));
}

/* -------------------------------- Камера --------------------------------- */

function cameraPosition() {
  const { target, distance, yaw, pitch } = state.camera;
  const cosPitch = Math.cos(pitch);
  return [
    target[0] + Math.sin(yaw) * cosPitch * distance,
    target[1] + Math.sin(pitch) * distance,
    target[2] + Math.cos(yaw) * cosPitch * distance
  ];
}

function viewProjection() {
  const eye = cameraPosition();
  const view = M4.lookAt(eye, state.camera.target, [0, 1, 0]);
  // Плоскости обзора растут вместе с отдалением: фиксированные 0.1/5000
  // срезали сцену дальше 5000 юнитов и теряли точность глубины на дистанции
  const distance = state.camera.distance;
  const near = Math.max(0.1, distance * 0.002);
  const far = Math.max(5000, distance * 4);

  const proj = M4.perspective((50 * Math.PI) / 180, canvas.width / canvas.height, near, far);
  return { eye, view, proj, viewProj: M4.mul(proj, view) };
}

function screenRay(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((clientY - rect.top) / rect.height) * 2;

  const eye = cameraPosition();
  const { target } = state.camera;
  const forward = normalize3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = normalize3(cross3(forward, [0, 1, 0]));
  const up = cross3(right, forward);

  const tan = Math.tan((50 * Math.PI) / 180 / 2);
  const aspect = canvas.width / canvas.height;

  const dir = normalize3([
    forward[0] + right[0] * x * tan * aspect + up[0] * y * tan,
    forward[1] + right[1] * x * tan * aspect + up[1] * y * tan,
    forward[2] + right[2] * x * tan * aspect + up[2] * y * tan
  ]);

  return { origin: eye, direction: dir };
}

function project(point) {
  const { viewProj } = viewProjection();
  const m = viewProj;
  const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
  const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
  const w = m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15];
  if (Math.abs(w) < 1e-6) return null;

  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((x / w) * 0.5 + 0.5) * rect.width,
    y: rect.top + (1 - ((y / w) * 0.5 + 0.5)) * rect.height,
    w
  };
}

/* -------------------------------- Векторы -------------------------------- */

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Ближайшая точка на прямой (origin + t·dir) к лучу мыши. */
function axisParameter(origin, dir, ray) {
  const w0 = [origin[0] - ray.origin[0], origin[1] - ray.origin[1], origin[2] - ray.origin[2]];
  const a = dot3(dir, dir);
  const b = dot3(dir, ray.direction);
  const c = dot3(ray.direction, ray.direction);
  const d = dot3(dir, w0);
  const e = dot3(ray.direction, w0);
  const denom = a * c - b * b;

  if (Math.abs(denom) < 1e-6) return 0;
  return (b * e - c * d) / denom;
}

/* ------------------------------ Документ сцены ---------------------------- */

function findRaw(entities, id, parent = null) {
  for (const raw of entities) {
    if (raw.id === id) return { raw, parent };
    const found = findRaw(raw.children || [], id, raw);
    if (found) return found;
  }
  return null;
}

function selected() {
  if (!state.doc || !state.selectedId) return null;
  return findRaw(state.doc.entities, state.selectedId);
}

function selectedEntity() {
  return state.entities.find((entity) => entity.id === state.selectedId) || null;
}

function collectIds() {
  const taken = new Set();
  const walk = (list) => list.forEach((raw) => { taken.add(raw.id); walk(raw.children || []); });
  walk(state.doc.entities);
  return taken;
}

function uniqueIdFrom(base, taken) {
  let index = 1;
  let id = `${base}-${index}`;

  while (taken.has(id)) {
    index += 1;
    id = `${base}-${index}`;
  }

  taken.add(id);
  return id;
}

function uniqueId(base) {
  return uniqueIdFrom(base, collectIds());
}

function setPath(target, path, value) {
  markDirty();
  const parts = path.split('.');
  let cursor = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (cursor[key] == null || typeof cursor[key] !== 'object') {
      cursor[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cursor = cursor[key];
  }

  cursor[parts[parts.length - 1]] = value;
}

/** Скрипт из строки → объект с params: иначе путь scripts.N.params ломает запись. */
function ensureScriptParams(raw, index) {
  if (!Array.isArray(raw.scripts)) return;

  if (typeof raw.scripts[index] === 'string') {
    raw.scripts[index] = { file: raw.scripts[index] };
  }

  const script = raw.scripts[index];
  if (!script || typeof script !== 'object') return;

  if (!script.params || typeof script.params !== 'object' || Array.isArray(script.params)) {
    script.params = {};
  }
}

function readPath(target, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), target);
}

/* ------------------------------- Загрузка --------------------------------- */

async function loadSceneList() {
  const response = await fetch('/api/scenes', { cache: 'no-store' });
  const data = await response.json();

  sceneSelect.innerHTML = '';
  for (const scene of data.scenes) {
    const option = document.createElement('option');
    option.value = scene.id;
    option.textContent = scene.missing
      ? `${scene.title} — нет файла`
      : `${scene.title} (${scene.id})`;
    option.disabled = Boolean(scene.missing);
    sceneSelect.append(option);
  }

  return data.scenes;
}

/** Развернуть файл сцены: настройки корня — отдельно, дети — в doc.entities. */
function openSceneDoc() {
  const list = Array.isArray(state.doc?.entities) ? state.doc.entities : [];
  const root = list.find((entity) => entity && entity.type === 'scene') || null;

  state.sceneRoot = {
    id: (root && root.id) || 'scene',
    name: (root && root.name) || 'Сцена',
    background: (root && root.background) || state.doc.background || '#000000',
    hudStyle: (root && root.hud && root.hud.style) || '',
    loading: {
      file: (root && root.loading && root.loading.file) || 'hud/loading.html',
      script: (root && root.loading && root.loading.script) || 'scripts/loading.js'
    },
    player: { ...(state.doc.player || {}), ...((root && root.player) || {}) }
  };

  // Все объекты сцены — дети корня; редактор работает с ними как с верхним уровнем
  state.doc.entities = root ? (Array.isArray(root.children) ? root.children : []) : list;
}

async function loadScene(id) {
  if (state.dirty && !confirm('В сцене есть несохранённые изменения. Загрузить другую сцену?')) {
    sceneSelect.value = state.sceneId;
    return;
  }

  state.mode = 'scene';
  state.prefabId = null;
  state.prefabTitle = '';
  setStatus(`Загрузка сцены ${id}…`);

  const response = await fetch(`/api/scene/${id}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Сцена ${id} не найдена`);

  state.doc = await response.json();
  openSceneDoc();
  state.sceneId = id;
  state.selectedId = null;
  state.fileMtime = response.headers.get('x-scene-mtime');

  await rebuild();

  sceneSelect.value = id;
  // Абсолютный путь: относительный «?scene=…» открывался бы в editor.html
  playLink.href = `/?scene=${id}`;
  applyModeUi();
  document.title = 'GalaxyDemo — редактор сцен';
  updateCameraReadout();
  state.dirty = false;
  state.lastSavedAt = null;
  updateSaveUi();
  const drawable = state.entities.filter((entity) => entity.model).length;
  setStatus(drawable
    ? `Сцена ${id} загружена`
    : `Сцена ${id} загружена, но в ней нет объектов — добавьте примитив или импортируйте GLB`);
}

/** В режиме префаба в документе только его ветка, сцена не подмешивается. */
async function loadPrefabDoc(id) {
  if (state.dirty && !confirm('В префабе есть несохранённые изменения. Загрузить заново?')) {
    return;
  }

  setStatus(`Загрузка префаба ${id}…`);

  const response = await fetch(`/api/prefab/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Префаб ${id} не найден`);

  const doc = await response.json();
  state.doc = doc;
  state.mode = 'prefab';
  state.prefabId = id;
  state.prefabTitle = doc.title || doc.id || id;
  state.sceneId = id;
  state.selectedId = null;
  state.fileMtime = null;

  await rebuild();

  state.dirty = false;
  state.lastSavedAt = null;
  updateSaveUi();
  applyModeUi();
  updateCameraReadout();
  document.title = `Префаб ${state.prefabTitle} — GalaxyDemo`;
  setStatus(`Префаб «${state.prefabTitle}» загружен`);
}

function applyModeUi() {
  const prefab = state.mode === 'prefab';
  document.body.classList.toggle('prefab-mode', prefab);

  sceneSelect.hidden = prefab;
  btnRestore.hidden = prefab;
  playLink.hidden = prefab;
  btnPrefabDelete.hidden = prefab;

  if (prefab) {
    modeTitle.textContent = `ПРЕФАБ · ${state.prefabTitle || state.prefabId}`;
    btnLoad.textContent = 'Перечитать';
    if (state.prefabId) prefabSelect.value = state.prefabId;
  } else {
    modeTitle.textContent = '';
    btnLoad.textContent = 'Загрузить';
  }
}

async function rebuild() {
  // Корневой объект — единственный источник общих настроек сцены
  if (state.mode === 'scene' && state.sceneRoot) {
    state.doc.background = state.sceneRoot.background;
    state.doc.player = state.sceneRoot.player;
    state.doc.hud = { style: state.sceneRoot.hudStyle || null };
  }

  const normalized = normalizeScene(state.doc);
  state.scene = normalized;
  state.entities = await buildScene(gl, normalized, { includeHidden: true });
  updateScene(state.entities, 0);

  renderTree();
  renderInspector();
  refreshStats();
  renderHudPreview().catch(() => {});
}

let lastCameraDistance = -1;

function updateCameraReadout() {
  const el = document.getElementById('camera-state');
  if (!el) return;

  const rounded = Math.round(state.camera.distance);
  if (rounded === lastCameraDistance) return;

  lastCameraDistance = rounded;
  el.textContent = `камера ${rounded}`;
}

function refreshStats() {
  statsEl.textContent = `сущностей ${state.entities.length}${state.selectedId ? ` · выбрано ${state.selectedId}` : ''}`;
}

/* --------------------------------- Дерево -------------------------------- */

const TYPE_ICON = {
  model: '◈',
  primitive: '▣',
  empty: '◇',
  hud: '▤',
  trigger: '⌾',
  spawn: '⌖',
  bot: '✦',
  camera: '◉',
  effect: '✧'
};

// Подписи типов в дереве: служебные типы читаются по-русски
const TYPE_LABEL = { empty: 'группа', camera: 'камера', effect: 'эффект' };

let draggedId = null;

function renderTree() {
  treeEl.innerHTML = '';
  if (!state.doc) return;

  // Корень сцены виден всегда и не удаляется: все объекты — его дети
  if (state.mode === 'scene') {
    const sceneRow = document.createElement('div');
    sceneRow.className = 'tree-row scene-row';
    sceneRow.dataset.id = SCENE_ID;
    sceneRow.style.paddingLeft = '12px';
    if (state.selectedId === SCENE_ID) sceneRow.classList.add('selected');
    sceneRow.title = 'Сцена · общие настройки, стили HUD, игрок';
    sceneRow.innerHTML = `<span class="icon">⬢</span>
      <span class="name">${escapeHtml(state.sceneRoot?.name || 'Сцена')}</span>
      <span class="kind">сцена</span>`;
    sceneRow.addEventListener('click', () => selectEntity(SCENE_ID));
    treeEl.append(sceneRow);
  }

  const build = (list, depth) => {
    for (const raw of list) {
      const row = document.createElement('div');
      row.className = 'tree-row';
      row.dataset.id = raw.id;
      row.draggable = true;
      row.style.paddingLeft = `${12 + depth * 14}px`;
      if (raw.id === state.selectedId) row.classList.add('selected');
      if (raw.visible === false) row.classList.add('hidden-object');

      // Тип виден по иконке, в подписи полезнее форма примитива
      // Игрок — тот, на кого движок вешает управление: скрипт input.js
      const isPlayer = Boolean((raw.scripts || []).some((script) => (script?.file || script) === 'input.js'));
      if (isPlayer) row.classList.add('player');

      const baseKind = raw.type === 'primitive'
        ? (raw.shape || 'primitive')
        : (TYPE_LABEL[raw.type] || raw.type || '');
      const kind = isPlayer ? `${baseKind} · игрок` : baseKind;
      row.title = `${raw.name || raw.id} · ${kind}`;
      row.innerHTML = `<span class="icon">${TYPE_ICON[raw.type] || '•'}</span>
        <span class="name">${escapeHtml(raw.name || raw.id)}</span>
        <span class="kind">${kind}</span>
        <button class="eye" type="button" title="${raw.visible === false ? 'Включить в игре' : 'Скрыть из игры'}">${raw.visible === false ? '○' : '◉'}</button>`;

      row.addEventListener('click', () => selectEntity(raw.id));
      row.addEventListener('dblclick', () => {
        const prefabId = prefabIdOf(raw);
        if (prefabId) openPrefabEditor(prefabId);
      });

      row.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectEntity(raw.id);
        showContextMenu(event.clientX, event.clientY, raw);
      });

      row.querySelector('.eye').addEventListener('click', (event) => {
        event.stopPropagation();
        raw.visible = raw.visible === false;
        markDirty();
        rebuild().catch((err) => setStatus(err.message, true));
      });

      // Тянем на пустой — вложим внутрь, на любую строку — поставим следом
      row.addEventListener('dragstart', (event) => {
        draggedId = raw.id;
        row.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', raw.id);
      });
      row.addEventListener('dragend', () => {
        draggedId = null;
        renderTree();
      });
      row.addEventListener('dragover', (event) => {
        if (!canReparent(draggedId, raw.id)) return;
        event.preventDefault();
        event.stopPropagation();
        row.classList.add(raw.type === 'empty' ? 'drop-into' : 'drop-after');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-into', 'drop-after'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove('drop-into', 'drop-after');
        if (draggedId === raw.id) return;

        const reason = reparentBlockedReason(draggedId, raw.id);
        if (reason) {
          setStatus(reason, true);
          return;
        }

        reparent(draggedId, raw.id);
      });

      treeEl.append(row);

      build(raw.children || [], depth + 1);
    }
  };

  build(state.doc.entities || [], state.mode === 'scene' ? 1 : 0);

  // Сброс на пустом месте дерева — вернуть объект в корень сцены
  treeEl.ondragover = (event) => {
    if (!draggedId) return;
    event.preventDefault();
    treeEl.classList.add('drop-root');
  };
  treeEl.ondragleave = (event) => {
    if (event.target === treeEl) treeEl.classList.remove('drop-root');
  };
  treeEl.ondrop = (event) => {
    if (!draggedId) return;
    event.preventDefault();
    treeEl.classList.remove('drop-root');

    const reason = reparentBlockedReason(draggedId, null);
    if (reason) return;
    reparent(draggedId, null);
  };
}

function selectEntity(id) {
  state.selectedId = id;
  renderTree();
  renderInspector();
  refreshStats();
}

/* ---------------------------- Вложенность -------------------------------- */

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(value ?? '').replace(/[&<>"]/g, (ch) => map[ch]);
}

/** Варианты выбора меша из public/models; текущий ассет остаётся в списке. */
function modelAssetOptions(current) {
  const list = state.assets.slice();
  if (current && !list.includes(current)) list.unshift(current);
  return list
    .map((id) => `<option value="${escapeHtml(id)}"${id === current ? ' selected' : ''}>${escapeHtml(id)}</option>`)
    .join('');
}

function containsRaw(raw, id) {
  return (raw.children || []).some((child) => child.id === id || containsRaw(child, id));
}

function hasDynamicBody(raw) {
  if (raw.body?.kind === 'dynamic') return true;
  return (raw.children || []).some(hasDynamicBody);
}

/** Почему перенос запрещён; null — можно. */
function reparentBlockedReason(sourceId, targetId) {
  if (!sourceId) return 'Нечего переносить';
  if (sourceId === targetId) return 'Объект нельзя вложить сам в себя';

  const source = findRaw(state.doc.entities, sourceId);
  if (!source) return 'Объект не найден';
  if (!targetId) return null;

  const target = findRaw(state.doc.entities, targetId);
  if (!target) return 'Цель не найдена';

  // Внутрь собственного поддерева нельзя: получится цикл в графе сцены
  if (containsRaw(source.raw, target.raw.id)) return 'Нельзя вложить объект в собственный дочерний узел';
  if (target.raw.type !== 'empty') return null;

  if (hasDynamicBody(source.raw)) return 'Динамическое тело нельзя вложить в группу — держите его на верхнем уровне';
  return null;
}

function canReparent(sourceId, targetId) {
  return reparentBlockedReason(sourceId, targetId) === null;
}

/** Куда добавится новый объект: выбранный пустой узел или корень сцены. */
function nestTarget() {
  const found = selected();
  return found && found.raw.type === 'empty' ? found : null;
}

function insertRaw(raw, parentFound) {
  if (parentFound) {
    parentFound.raw.children = parentFound.raw.children || [];
    parentFound.raw.children.push(raw);
    return;
  }

  state.doc.entities.push(raw);
}

/** Мировая точка → локальные координаты контейнера. */
function toParentSpace(parentId, point) {
  if (!parentId) return point.slice();

  const parent = state.entities.find((entity) => entity.id === parentId);
  if (!parent) return point.slice();

  return M4.transformPoint(M4.invert(parent.matrix), point);
}

function spawnPosition(parentFound) {
  const point = toParentSpace(parentFound ? parentFound.raw.id : null, state.camera.target);
  return point.map(round);
}

/** Мировая матрица → локальные position / rotation / scale. */
function applyLocalMatrix(raw, matrix) {
  const length = (x, y, z) => Math.hypot(x, y, z) || 1;

  raw.position = [matrix[12], matrix[13], matrix[14]].map(round);
  raw.scale = [
    length(matrix[0], matrix[1], matrix[2]),
    length(matrix[4], matrix[5], matrix[6]),
    length(matrix[8], matrix[9], matrix[10])
  ].map((value) => round(Math.min(100, Math.max(0.02, value))));
  raw.rotation = quatToEuler(quatFromMat4(matrix));
}

/** Перенести сущность в другую группу или в корень, сохранив мировое положение. */
function reparent(sourceId, targetId) {
  const source = findRaw(state.doc.entities, sourceId);
  if (!source) return;

  const target = targetId ? findRaw(state.doc.entities, targetId) : null;
  const entity = state.entities.find((item) => item.id === sourceId);
  const world = entity ? entity.matrix.slice() : null;

  const from = source.parent ? source.parent.children : state.doc.entities;
  const index = from.indexOf(source.raw);
  if (index >= 0) from.splice(index, 1);

  let parentRaw = null;

  if (target && target.raw.type === 'empty') {
    parentRaw = target.raw;
    parentRaw.children = parentRaw.children || [];
    parentRaw.children.push(source.raw);
  } else if (target) {
    const list = target.parent ? target.parent.children : state.doc.entities;
    list.splice(list.indexOf(target.raw) + 1, 0, source.raw);
  } else {
    state.doc.entities.push(source.raw);
  }

  if (world) {
    const parentEntity = parentRaw ? state.entities.find((item) => item.id === parentRaw.id) : null;
    applyLocalMatrix(source.raw, parentEntity ? M4.mul(M4.invert(parentEntity.matrix), world) : world);
  }

  state.selectedId = sourceId;
  markDirty();
  rebuild().catch((err) => setStatus(err.message, true));
}

/* -------------------------------- Инспектор ------------------------------- */

function numberInput(label, path, value, step = 1, min, max) {
  return `<div class="row"><span>${label}</span>
    <input type="number" data-kind="number" data-path="${path}" value="${round(value)}" step="${step}"${min != null ? ` min="${min}"` : ''}${max != null ? ` max="${max}"` : ''}>
  </div>`;
}

function numberTrio(label, path, values, step = 0.1) {
  const [x, y, z] = values;
  return `<div class="row"><span>${label}</span>
    <div class="trio">
      <input type="number" data-kind="number" data-path="${path}.0" value="${round(x)}" step="${step}">
      <input type="number" data-kind="number" data-path="${path}.1" value="${round(y)}" step="${step}">
      <input type="number" data-kind="number" data-path="${path}.2" value="${round(z)}" step="${step}">
    </div>
  </div>`;
}

function colorInput(label, path, value) {
  return `<div class="row"><span>${label}</span>
    <input type="color" data-kind="color" data-path="${path}" value="${value}">
  </div>`;
}

function selectInput(label, path, value, options) {
  const items = options
    .map(([key, text]) => `<option value="${key}"${key === value ? ' selected' : ''}>${text}</option>`)
    .join('');

  return `<div class="row"><span>${label}</span>
    <select data-path="${path}">${items}</select>
  </div>`;
}

/** Варианты для параметра-ссылки: все сущности сцены с отступами по вложенности. */
function entityChoices(current) {
  const options = [['', '— нет —']];
  const seen = new Set();

  const walk = (list, depth) => {
    for (const raw of list || []) {
      options.push([raw.id, `${'· '.repeat(depth)}${raw.name || raw.id} · ${raw.type || '?'}`]);
      seen.add(raw.id);
      walk(raw.children, depth + 1);
    }
  };

  walk(state.doc?.entities, 0);

  // Ссылка из старой сцены могла остаться на удалённый объект
  if (current && !seen.has(current)) options.push([current, `${current} · нет в сцене`]);

  return options;
}

function round(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function asArray3(value, fallback = [0, 0, 0]) {
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3).map((v) => Number(v) || 0);
  if (typeof value === 'number') return [value, value, value];
  return fallback.slice();
}

/** Инспектор корневого объекта «Сцена»: общие настройки и стили HUD. */
function renderSceneInspector() {
  const root = state.sceneRoot || {};
  const player = root.player || {};
  const model = player.model || 'corinth';

  inspectorEl.innerHTML = `
    <div class="row"><span>id</span><input type="text" value="${escapeHtml(root.id || 'scene')}" disabled></div>
    <div class="row"><span>имя</span><input type="text" id="scene-name" value="${escapeHtml(root.name || 'Сцена')}"></div>
    <div class="row"><span>тип</span><input type="text" value="scene · корень сцены" disabled></div>
    <h4>Фон и HUD</h4>
    <div class="row"><span>фон кадра</span><input type="color" id="scene-bg" value="${root.background || '#000000'}"></div>
    <div class="row"><span>стили HUD</span><input type="text" id="scene-style" placeholder="hud/style.css" value="${escapeHtml(root.hudStyle || '')}"></div>
    <p class="hint-inline">Один CSS-файл на все HTML-слои HUD сцены. Путь от <b>public/</b>, например <b>hud/style.css</b>. Подключается один раз при загрузке сцены.</p>
    <h4>Загрузочный экран</h4>
    <div class="row"><span>html</span><input type="text" id="scene-loading-file" placeholder="hud/loading.html" value="${escapeHtml(root.loading?.file || '')}"></div>
    <div class="row"><span>скрипт</span><input type="text" id="scene-loading-script" placeholder="scripts/loading.js" value="${escapeHtml(root.loading?.script || '')}"></div>
    <p class="hint-inline">Скрипт загрузочного экрана получает прогресс (<b>api.loading.getProgress()</b>) и время (<b>api.loading.getElapsed()</b>); цикл init/update — как у основного скрипта сцены.</p>
    <h4>Игрок</h4>
    <div class="row"><span>модель</span><select id="scene-model">
      <option value="corinth"${model === 'corinth' ? ' selected' : ''}>Corinth Cargo Transporter</option>
      <option value="spaceship"${model === 'spaceship' ? ' selected' : ''}>Space Cruiser</option>
    </select></div>
    <p class="hint-inline">Объект «Сцена» один: его нельзя удалить или создать заново, а все объекты сцены добавляются внутрь него.</p>`;

  const name = document.getElementById('scene-name');
  name?.addEventListener('change', () => {
    state.sceneRoot.name = name.value.trim() || 'Сцена';
    markDirty();
    renderTree();
  });

  const bg = document.getElementById('scene-bg');
  bg?.addEventListener('input', () => {
    state.sceneRoot.background = bg.value;
    markDirty();
    rebuild().catch((err) => setStatus(err.message, true));
  });

  const style = document.getElementById('scene-style');
  style?.addEventListener('change', () => {
    state.sceneRoot.hudStyle = style.value.trim();
    renderHudPreview().catch(() => {});
    markDirty();
  });

  const loadingFile = document.getElementById('scene-loading-file');
  loadingFile?.addEventListener('change', () => {
    state.sceneRoot.loading = { ...(state.sceneRoot.loading || {}), file: loadingFile.value.trim() };
    markDirty();
  });

  const loadingScript = document.getElementById('scene-loading-script');
  loadingScript?.addEventListener('change', () => {
    state.sceneRoot.loading = { ...(state.sceneRoot.loading || {}), script: loadingScript.value.trim() };
    markDirty();
  });

  const modelSelect = document.getElementById('scene-model');
  modelSelect?.addEventListener('change', () => {
    state.sceneRoot.player = { ...(state.sceneRoot.player || {}), model: modelSelect.value };
    markDirty();
    rebuild().catch((err) => setStatus(err.message, true));
  });
}

function renderInspector() {
  if (state.mode === 'scene' && state.selectedId === SCENE_ID) {
    renderSceneInspector();
    return;
  }

  const found = selected();

  if (!found) {
    inspectorEl.innerHTML = '<p class="empty">Ничего не выбрано. Выберите объект в дереве слева.</p>';
    return;
  }

  const raw = found.raw;
  const type = raw.type || 'primitive';
  const size = asArray3(raw.size, [2, 2, 2]);
  const position = asArray3(raw.position);
  const rotation = asArray3(raw.rotation);
  const scale = asArray3(raw.scale, [1, 1, 1]);
  const material = raw.material || {};
  const collider = raw.body?.collider;
  const spinSpeed = typeof raw.spin === 'number' ? raw.spin : (raw.spin?.speed ?? 0);

  const parts = [
    `<div class="row"><span>id</span><input type="text" value="${raw.id}" disabled></div>`,
    `<div class="row"><span>имя</span><input type="text" data-path="name" value="${escapeHtml(raw.name || raw.id)}"></div>`,
    `<div class="row"><span>тип</span><input type="text" value="${type}${raw.shape ? ` · ${raw.shape}` : ''}" disabled></div>`
  ];

  // У HTML-слоя нет положения в мире: движок его не позиционирует
  if (type !== 'hud') {
    parts.push(
      '<h4>Трансформ</h4>',
      numberTrio('позиция', 'position', position),
      numberTrio('поворот°', 'rotation', rotation, 1),
      numberTrio('масштаб', 'scale', scale, 0.05),
      numberInput('вращение, рад/с', 'spin.speed', spinSpeed, 0.01)
    );
  }

  parts.push(
    `<div class="row"><span>видимость</span>
      <label class="toggle"><input type="checkbox" data-kind="check" data-path="visible" ${raw.visible === false ? '' : 'checked'}> в игре</label>
    </div>`
  );

  if (type === 'model' || type === 'bot') {
    const currentAsset = raw.asset || (type === 'bot' ? 'spaceship' : '');
    parts.push(
      '<h4>Меш</h4>',
      `<div class="row"><span>модель</span><select data-path="asset">${modelAssetOptions(currentAsset)}</select></div>`,
      '<p class="hint-inline">Смена меша пересобирает объект; физика и коллайдер остаются прежними — их можно поправить ниже или в редакторе модели.</p>'
    );
  }

  if (type === 'primitive') {
    parts.push('<h4>Примитив</h4>', numberTrio('размер', 'size', size, 0.1));
  }

  if (type === 'hud') {
    const hud = raw.hud || {};
    const files = state.hudFiles.length ? state.hudFiles : [''];
    const attached = ['parent', 'entity', 'target'].includes(hud.follow);

    parts.push(
      '<h4>Слой HUD</h4>',
      selectInput('файл', 'hud.file', hud.file || files[0], files.map((file) => [file, file.replace('hud/', '')])),
      selectInput('привязка', 'hud.follow', hud.follow || 'none', [
        ['none', 'нет — в правом верхнем углу'],
        ['parent', 'к родителю (объект-владелец)'],
        ['entity', 'к другому объекту'],
        ['target', 'к маркеру цели']
      ]),
      ...(hud.follow === 'entity'
        ? [selectInput('объект', 'hud.target', hud.target || '', entityChoices(hud.target))]
        : []),
      ...(attached
        ? [
          selectInput('якорь', 'hud.anchor', hud.anchor || 'center', [
            ['top-left', 'слева сверху'], ['top-right', 'справа сверху'],
            ['bottom-left', 'слева снизу'], ['bottom-right', 'справа снизу'], ['center', 'центр']
          ]),
          numberInput('сдвиг X, px', 'hud.offset.0', hud.offset?.[0] ?? 0, 1),
          numberInput('сдвиг Y, px', 'hud.offset.1', hud.offset?.[1] ?? 0, 1),
          numberInput('масштаб', 'hud.scale', hud.scale ?? 1, 0.05, 0.25)
        ]
        : []),
      selectInput('подстановка', 'hud.bind', hud.bind || '', [['', 'нет'], ['model', 'имя модели']]),
      `<div class="row"><span>на старте</span><label class="toggle"><input type="checkbox" data-kind="check" data-path="hud.startHidden" ${hud.startHidden ? 'checked' : ''}> скрыт</label></div>`,
      '<p class="hint-inline">Без привязки слой вставляется в контейнер сцены обычным блоком — от левого верхнего края, положение задаёт HTML/CSS. С привязкой движок проецирует точку объекта в экран и добавляет сдвиг.</p>'
    );
  }

  if (type === 'empty') {
    const inside = (raw.children || []).length;
    parts.push(
      '<h4>Группа</h4>',
      '<p class="hint-inline">Пустой узел: трансформ и скрипты без геометрии. Всё, что лежит внутри, едет и вращается вместе с ним. Модель или другой пустой перетащите на эту строку в дереве.</p>',
      `<div class="row"><span>внутри</span><input type="text" value="${inside}" disabled></div>`
    );
  }

  if (type === 'camera') {
    const camera = raw.camera || {};
    parts.push(
      '<h4>Камера</h4>',
      colorInput('фон камеры', 'camera.background', camera.background || '#000000'),
      '<p class="hint-inline">Движение и обзор задаёт скрипт <b>camera.js</b>: добавьте его в секции «Скрипты» и выберите корабль в поле «Корабль». Здесь остаётся объект-маркер и фон кадра.</p>'
    );
  }

  if (type === 'model' || type === 'primitive') {
    parts.push(
      '<h4>Материал</h4>',
      colorInput('цвет', 'material.color', material.color || '#8a95a6'),
      colorInput('свечение', 'material.emissive', material.emissive || '#000000'),
      numberInput('металл 0–1', 'material.metal', material.metal ?? 0.4, 0.05),
      numberInput('блик', 'material.specular', material.specular ?? 1, 0.05)
    );
  }

  const scriptsList = raw.scripts || [];
  parts.push('<h4>Скрипты</h4>');

  if (scriptsList.length) {
    scriptsList.forEach((script, index) => {
      const file = typeof script === 'string' ? script : script.file;
      parts.push(`<div class="row script-row"><span>${file}</span><button type="button" class="icon-btn" data-remove-script="${file}" title="Убрать скрипт">×</button></div>`);

      // Переменные скрипта: схема лежит в модуле, значения — в сцене
      const schema = state.scriptSchemas[file];
      if (!schema) return;

      for (const [key, meta] of Object.entries(schema)) {
        const value = script?.params?.[key] ?? meta.default ?? 0;
        const path = `scripts.${index}.params.${key}`;

        if (meta.type === 'entity') {
          parts.push(selectInput(meta.label || key, path, value, entityChoices(value)));
          continue;
        }

        if (meta.type === 'text') {
          parts.push(`<div class="row"><span>${meta.label || key}</span><input type="text" data-kind="text" data-path="${path}" value="${escapeHtml(value)}"></div>`);
          continue;
        }

        parts.push(numberInput(
          meta.label || key,
          path,
          value,
          meta.step ?? 0.1,
          meta.min,
          meta.max
        ));
      }
    });
  } else {
    parts.push('<p class="hint-inline">Скриптов нет — объект статичен.</p>');
  }

  if (state.scripts.length) {
    parts.push(
      `<div class="row"><span>добавить</span><select id="script-pick">${state.scripts.map((file) => `<option value="${file}">${file}</option>`).join('')}</select></div>`,
      '<button type="button" class="wide" data-add-script>Добавить скрипт</button>'
    );
  }

  const effectsList = Array.isArray(raw.effects) ? raw.effects : [];
  parts.push('<h4>Эффекты</h4>');

  if (!effectsList.length) {
    parts.push('<p class="hint-inline">Эффектов нет — прикрепите VFX-ассет к объекту.</p>');
  }

  effectsList.forEach((slot, index) => {
    const assetId = typeof slot.effect === 'string' ? slot.effect : '';
    const definition = effectDefinition(assetId);
    const inline = slot.effect && typeof slot.effect === 'object' ? slot.effect : null;
    const schema = definition?.params || inline?.params || {};
    const options = state.effects
      .map((effect) => `<option value="${effect.id}"${effect.id === assetId ? ' selected' : ''}>${escapeHtml(effect.title || effect.id)}</option>`)
      .join('');

    parts.push(
      `<div class="row"><span>эффект</span><select data-path="effects.${index}.effect">${options}</select></div>`,
      `<div class="row"><span>${escapeHtml(definition?.title || assetId || 'inline')}</span>
        <button type="button" data-test-effect="${index}">▶ тест</button>
        <button type="button" class="icon-btn" data-remove-effect="${index}" title="Убрать эффект">×</button>
      </div>`,
      selectInput('запуск', `effects.${index}.trigger`, slot.trigger || 'manual', [
        ['auto', 'auto — при старте'],
        ['manual', 'manual — из скрипта'],
        ['impact', 'impact — при ударе'],
        ['trigger.enter', 'trigger.enter'],
        ['trigger.exit', 'trigger.exit']
      ]),
      `<div class="row"><span>цикл</span><label class="toggle"><input type="checkbox" data-kind="check" data-path="effects.${index}.loop" ${slot.loop ? 'checked' : ''}> повторять</label></div>`,
      numberInput('длительность', `effects.${index}.duration`, slot.duration ?? 1, 0.1, 0.01),
      numberTrio('offset', `effects.${index}.offset`, asArray3(slot.offset, [0, 0, 0]), 0.1),
      numberInput('масштаб', `effects.${index}.scale`, Array.isArray(slot.scale) ? slot.scale[0] : (slot.scale ?? 1), 0.1, 0.01)
    );

    for (const [key, meta] of Object.entries(schema)) {
      const value = slot.params?.[key] ?? meta.default ?? '';
      const path = `effects.${index}.params.${key}`;
      const label = meta.label || key;

      if (meta.type === 'color') {
        parts.push(colorInput(label, path, value));
      } else if (meta.type === 'boolean') {
        parts.push(`<div class="row"><span>${escapeHtml(label)}</span><label class="toggle"><input type="checkbox" data-kind="check" data-path="${path}" ${value ? 'checked' : ''}> да</label></div>`);
      } else if (meta.type === 'text') {
        parts.push(`<div class="row"><span>${escapeHtml(label)}</span><input type="text" data-kind="text" data-path="${path}" value="${escapeHtml(value)}"></div>`);
      } else {
        parts.push(numberInput(label, path, value, meta.step ?? 0.1, meta.min, meta.max));
      }
    }
  });

  if (state.effects.length) {
    parts.push(
      `<div class="row"><span>добавить</span><select id="effect-pick">${state.effects.map((effect) => `<option value="${effect.id}">${escapeHtml(effect.title || effect.id)}</option>`).join('')}</select></div>`,
      '<button type="button" class="wide" data-add-effect>Прикрепить эффект</button>'
    );
  }

  parts.push('<h4>Тело</h4>');

  if (collider) {
    parts.push(
      numberInput('масса', 'body.mass', raw.body?.mass ?? 0, 1, 0),
      numberInput('отскок', 'body.restitution', raw.body?.restitution ?? 0.55, 0.05)
    );

    if (collider.shape === 'sphere') {
      parts.push(
        numberInput('радиус сферы', 'body.collider.radius', collider.radius ?? 1, 0.1, 0.01),
        numberTrio('центр', 'body.collider.offset', asArray3(collider.offset, [0, 0, 0]), 0.1)
      );
    } else if (collider.shape === 'box') {
      parts.push(
        numberTrio('полуразмеры', 'body.collider.halfExtents', asArray3(collider.halfExtents, [1, 1, 1]), 0.1),
        numberTrio('центр', 'body.collider.offset', asArray3(collider.offset, [0, 0, 0]), 0.1)
      );
    } else if (collider.shape === 'compound') {
      const boxes = Array.isArray(collider.boxes) ? collider.boxes.length : 0;
      const spheres = Array.isArray(collider.spheres) ? collider.spheres.length : 0;

      parts.push(
        `<div class="row"><span>состав</span><span>${boxes} боксов · ${spheres} сфер</span></div>`,
        '<p class="hint-inline">Части составного коллайдера правятся в редакторе модели; здесь остаются масса и отскок.</p>'
      );
    }
  } else {
    parts.push('<p class="hint-inline">У сущности нет физического тела. Коллайдер добавится на следующем шаге.</p>');
  }

  if (type === 'trigger') {
    const trigger = raw.trigger || {};
    const shape = trigger.shape === 'sphere' ? 'sphere' : 'box';

    parts.push(
      '<h4>Триггер</h4>',
      selectInput('форма', 'trigger.shape', shape, [['box', 'бокс'], ['sphere', 'сфера']])
    );

    if (shape === 'sphere') {
      parts.push(numberInput('радиус', 'trigger.radius', trigger.radius ?? 5, 0.5, 0.1));
    } else {
      parts.push(numberTrio('размер зоны', 'trigger.size', asArray3(trigger.size, [10, 10, 10]), 0.5));
    }

    parts.push(
      `<div class="row"><span>сработать раз</span>
        <label class="toggle"><input type="checkbox" data-kind="check" data-path="trigger.once" ${trigger.once ? 'checked' : ''}> один раз</label>
      </div>`,
      `<div class="row"><span>метка</span><input type="text" data-path="trigger.tag" value="${trigger.tag || raw.id}"></div>`,
      '<p class="hint-inline">События enter/exit придут скриптам триггера, когда добавлю рантайм скриптов.</p>'
    );
  }

  if (type === 'spawn') {
    parts.push(
      '<h4>Точка появления</h4>',
      `<div class="row"><span>метка</span><input type="text" data-path="spawn.tag" value="${raw.spawn?.tag || raw.tag || 'start'}"></div>`,
      selectInput('для кого', 'spawn.for', raw.spawn?.for || 'ship', [['ship', 'корабль игрока'], ['bot', 'бот']])
    );
  }

  if (type === 'bot') {
    const bot = raw.bot || {};
    parts.push(
      '<h4>Бот</h4>',
      numberInput('радиус круга', 'bot.radius', bot.radius ?? 14, 0.5, 0),
      numberInput('скорость, рад/с', 'bot.speed', bot.speed ?? 0.35, 0.05, 0),
      numberInput('покачивание', 'bot.height', bot.height ?? 2, 0.1, 0)
    );
  }

  parts.push('<p class="hint-inline">Изменения применяются сразу. Сохранение — Ctrl+S или кнопка вверху.</p>');

  inspectorEl.innerHTML = parts.join('');
}

/* ------------------------------ Применение правок ------------------------- */

const TRANSFORM_PATHS = ['position', 'rotation', 'scale', 'visible', 'spin', 'size', 'trigger'];

// Допустимые диапазоны параметров камеры: те же, что в инспекторе и scene.js
const CAMERA_RANGES = {
  height: [0, 200],
  distance: [0, 120],
  drop: [0, 15],
  tilt: [0, 360],
  fov: [5, 120],
  near: [0.01, 10000],
  far: [1, 1000000]
};

function clampCamera(camera = {}) {
  const next = { ...camera };

  for (const [key, [min, max]] of Object.entries(CAMERA_RANGES)) {
    const value = Number(next[key]);
    if (Number.isFinite(value)) next[key] = Math.min(max, Math.max(min, value));
  }

  return next;
}

/* Форма и размеры триггера живут в разных полях: при переключении переносим
   объём, иначе сфера рождается с чужим радиусом по умолчанию */
function matchTriggerShape(raw, shape) {
  const trigger = raw.trigger || (raw.trigger = {});

  if (shape === 'sphere') {
    if (!(trigger.radius > 0)) {
      const size = asArray3(trigger.size, [10, 10, 10]);
      trigger.radius = Math.round((Math.max(...size) / 2) * 100) / 100;
    }
    return;
  }

  if (!Array.isArray(trigger.size)) {
    const radius = trigger.radius > 0 ? trigger.radius : 5;
    trigger.size = [radius * 2, radius * 2, radius * 2];
  }
}

function applyChange(path) {
  const found = selected();
  if (!found) return;

  const root = path.split('.')[0];
  const entity = selectedEntity();

  // Параметры камеры живут в raw: маркер читает их напрямую, пересборка не нужна
  if (root === 'camera') {
    const camera = clampCamera(found.raw.camera);
    found.raw.camera = camera;
    if (entity) entity.raw.camera = camera;
    return;
  }

  if (TRANSFORM_PATHS.includes(root) && root !== 'size' && root !== 'trigger') {
    if (entity) {
      entity.position = asArray3(found.raw.position, entity.position);
      entity.rotation = asArray3(found.raw.rotation, entity.rotation);
      entity.scale = asArray3(found.raw.scale, entity.scale);
      entity.scaleUniform = Math.max(entity.scale[0], entity.scale[1], entity.scale[2]);
      entity.quaternion = eulerToQuat(entity.rotation);
      entity.baseQuaternion = entity.quaternion;
      entity.visible = found.raw.visible !== false;
      updateMatrices(state.entities);
    }
    refreshStats();
    return;
  }

  rebuild().catch((err) => setStatus(err.message, true));
}

function scheduleRebuild(delay = 0) {
  clearTimeout(scheduleRebuild.timer);
  scheduleRebuild.timer = setTimeout(() => {
    rebuild().catch((err) => setStatus(err.message, true));
  }, delay);
}

function hexToRgb(hex, fallback = [1, 1, 1]) {
  if (typeof hex !== 'string') return fallback.slice();
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (full.length !== 6) return fallback.slice();
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return fallback.slice();
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

// Цвет меняется без пересборки сцены: пересоздавать буферы на каждый
// пиксель палитры слишком дорого для моделей на несколько мегабайт
function applyColorFast(path, value) {
  const entity = selectedEntity();
  if (!entity?.model) return false;

  const rgb = hexToRgb(value);
  const key = path === 'material.emissive' ? 'emissive' : 'color';
  for (const part of entity.model.parts) part[key] = rgb.slice();
  return true;
}

/* ------------------------------ Ввод в инспекторе ------------------------- */

inspectorEl.addEventListener('input', (event) => {
  const input = event.target.closest('[data-path]');
  if (!input) return;

  // Текст (имя, метка) применяем на change: пересборка на каждый символ — дорого
  if (input.type === 'text') return;

  const found = selected();
  if (!found) return;

  const path = input.dataset.path;
  let value;

  if (input.dataset.kind === 'check') value = input.checked;
  else if (input.dataset.kind === 'number') {
    value = Number(input.value);

    // HTML max не мешает ввести число больше лимита — режем вручную
    if (Number.isFinite(value)) {
      const min = input.min === '' ? -Infinity : Number(input.min);
      const max = input.max === '' ? Infinity : Number(input.max);
      value = Math.min(max, Math.max(min, value));
      if (String(value) !== input.value) input.value = String(value);
    }
  } else value = input.value;

  // Параметры скрипта пишутся в scripts.N.params: запись-строка должна стать объектом
  const scriptParam = path.match(/^scripts\.(\d+)\.params\./);
  if (scriptParam) ensureScriptParams(found.raw, Number(scriptParam[1]));

  setPath(found.raw, path, value);

  if ((path === 'material.color' || path === 'material.emissive') && applyColorFast(path, value)) return;

  applyChange(path);
});

inspectorEl.addEventListener('change', (event) => {
  const input = event.target.closest('[data-path]');
  if (!input) return;

  const found = selected();
  if (!found) return;

  if (input.tagName === 'SELECT') {
    if (input.dataset.path === 'trigger.shape') matchTriggerShape(found.raw, input.value);

    // Ссылка на объект тоже может прийти из записи-строки
    const scriptParam = input.dataset.path.match(/^scripts\.(\d+)\.params\./);
    if (scriptParam) ensureScriptParams(found.raw, Number(scriptParam[1]));

    setPath(found.raw, input.dataset.path, input.value);
    applyChange(input.dataset.path);
    return;
  }

  if (input.dataset.kind !== 'color' && input.type !== 'text') return;

  const scriptParam = input.dataset.path.match(/^scripts\.(\d+)\.params\./);
  if (scriptParam) ensureScriptParams(found.raw, Number(scriptParam[1]));

  setPath(found.raw, input.dataset.path, input.value);
  applyChange(input.dataset.path);
});

inspectorEl.addEventListener('click', (event) => {
  const found = selected();
  if (!found) return;

  const removeBtn = event.target.closest('[data-remove-script]');
  const addBtn = event.target.closest('[data-add-script]');
  const removeEffectBtn = event.target.closest('[data-remove-effect]');
  const testEffectBtn = event.target.closest('[data-test-effect]');
  const addEffectBtn = event.target.closest('[data-add-effect]');

  if (removeEffectBtn) {
    const index = Number(removeEffectBtn.dataset.removeEffect);
    if (Array.isArray(found.raw.effects)) found.raw.effects.splice(index, 1);
    if (!found.raw.effects?.length) delete found.raw.effects;
    rebuild().catch((err) => setStatus(err.message, true));
    return;
  }

  if (testEffectBtn) {
    const index = Number(testEffectBtn.dataset.testEffect);
    const slot = (found.raw.effects || [])[index];
    const entity = state.entities.find((item) => item.id === found.raw.id);
    if (!slot || !entity) return;

    for (const definition of state.effects) effectPreview.registerDefinition(definition.id, definition);
    const id = effectPreview.play(entity, slot.id);
    setStatus(id ? `Эффект «${slot.id}» запущен в предпросмотре` : 'Не удалось запустить эффект', !id);
    return;
  }

  if (addEffectBtn) {
    const pick = document.getElementById('effect-pick');
    if (!pick) return;

    const list = Array.isArray(found.raw.effects) ? found.raw.effects.slice() : [];
    const used = new Set(list.map((slot) => slot.id));
    let id = 'effect-1';
    let suffix = 2;
    while (used.has(id)) id = `effect-${suffix++}`;
    const definition = effectDefinition(pick.value);

    list.push({
      id,
      effect: pick.value,
      trigger: 'manual',
      loop: Boolean(definition?.loop),
      duration: Number(definition?.duration) || 1,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      params: {}
    });

    found.raw.effects = list;
    rebuild().catch((err) => setStatus(err.message, true));
    return;
  }

  if (removeBtn) {
    const file = removeBtn.dataset.removeScript;
    found.raw.scripts = (found.raw.scripts || [])
      .filter((script) => (typeof script === 'string' ? script : script.file) !== file);

    if (!found.raw.scripts.length) delete found.raw.scripts;
    rebuild().catch((err) => setStatus(err.message, true));
    return;
  }

  if (addBtn) {
    const pick = document.getElementById('script-pick');
    if (!pick) return;

    const list = Array.isArray(found.raw.scripts) ? found.raw.scripts.slice() : [];
    const exists = list.some((script) => (typeof script === 'string' ? script : script.file) === pick.value);
    if (!exists) list.push({ file: pick.value });

    found.raw.scripts = list;
    rebuild().catch((err) => setStatus(err.message, true));
  }
});

/* --------------------------------- Отрисовка ------------------------------ */

function drawMeshPart(part, matrix, emissive = part.emissive) {
  const u = meshLoc.u;
  const a = meshLoc.a;

  gl.uniformMatrix4fv(u.uModel, false, matrix);
  gl.uniformMatrix3fv(u.uNormalMat, false, M4.normalMatrix(matrix));
  gl.uniform3fv(u.uColor, part.color);
  gl.uniform3fv(u.uTint, part.tint || [1, 1, 1]);
  gl.uniform3fv(u.uEmissive, emissive);
  gl.uniform1f(u.uSpecular, part.specular ?? 1);
  gl.uniform1f(u.uMetal, part.metal ?? 0);
  gl.uniform1f(u.uTextureColor, part.textureColor ? 1 : 0);

  if (part.material) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, part.material.albedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, part.material.rough);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, part.material.metal);
    gl.uniform1f(u.uTextured, 1);
  } else {
    gl.uniform1f(u.uTextured, 0);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.positionBuffer);
  gl.enableVertexAttribArray(a.position);
  gl.vertexAttribPointer(a.position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.normalBuffer);
  gl.enableVertexAttribArray(a.normal);
  gl.vertexAttribPointer(a.normal, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, part.mesh.uvBuffer);
  gl.enableVertexAttribArray(a.uv);
  gl.vertexAttribPointer(a.uv, 2, gl.FLOAT, false, 0, 0);

  if (part.mesh.indexBuffer) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.mesh.indexBuffer);
    gl.drawElements(gl.TRIANGLES, part.mesh.count, part.mesh.indexType, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, part.mesh.count);
  }
}

// Каркасные примитивы берём из общего модуля wire.js

function drawLines(vertices, depthTest) {
  if (!vertices.length) return;

  const data = new Float32Array(vertices);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  if (data.byteLength > lineCapacity) {
    lineCapacity = data.byteLength * 2;
    gl.bufferData(gl.ARRAY_BUFFER, lineCapacity, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);

  gl.useProgram(lineProgram.program);
  gl.uniformMatrix4fv(lineLoc.u.uViewProj, false, state.viewProj);

  if (depthTest) gl.enable(gl.DEPTH_TEST);
  else gl.disable(gl.DEPTH_TEST);

  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.enableVertexAttribArray(lineLoc.aPos);
  gl.vertexAttribPointer(lineLoc.aPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(lineLoc.aColor);
  gl.vertexAttribPointer(lineLoc.aColor, 3, gl.FLOAT, false, 24, 12);
  gl.drawArrays(gl.LINES, 0, vertices.length / 6);

  gl.enable(gl.DEPTH_TEST);
}

function gridVertices() {
  const vertices = [];

  // На дальнем отдалении клетки по 10 юнитов превращаются в точку и ориентир
  // пропадает, поэтому шаг сетки переключается на декаду вместе с зумом
  // (10 -> 100 -> 1000 ...): линии остаются на месте, просто мельчают
  const scale = Math.max(1, Math.pow(10, Math.round(Math.log10(state.camera.distance / 46))));
  const size = 120 * scale;
  const step = 10 * scale;

  for (let i = -size; i <= size; i += step) {
    const major = i === 0;
    const color = major ? [0.35, 0.42, 0.52] : [0.14, 0.18, 0.24];
    pushLine(vertices, [-size, 0, i], [size, 0, i], color);
    pushLine(vertices, [i, 0, -size], [i, 0, size], color);
  }

  pushLine(vertices, [-size, 0, 0], [size, 0, 0], [0.55, 0.2, 0.2]);
  pushLine(vertices, [0, 0, -size], [0, 0, size], [0.2, 0.35, 0.6]);
  return vertices;
}

function entityBox(entity) {
  const raw = entity.raw;

  if (raw.type === 'model' && entity.model?.bounds) {
    return { min: entity.model.bounds.min, max: entity.model.bounds.max };
  }

  if (raw.type === 'primitive') {
    const half = raw.size.map((value) => Math.abs(value) / 2);
    return { min: [-half[0], -half[1], -half[2]], max: [half[0], half[1], half[2]] };
  }

  if (raw.type === 'trigger') {
    const trigger = raw.trigger || {};

    // Сфера задана радиусом, а не размером зоны: иначе выбор мышью и
    // подсветка попадали бы в габариты прежнего бокса
    if (trigger.shape === 'sphere') {
      const radius = Math.abs(trigger.radius ?? 5);
      return { min: [-radius, -radius, -radius], max: [radius, radius, radius] };
    }

    const half = asArray3(trigger.size, [10, 10, 10]).map((value) => Math.abs(value) / 2);
    return { min: [-half[0], -half[1], -half[2]], max: [half[0], half[1], half[2]] };
  }

  if (raw.type === 'camera') {
    return { min: [-1.2, -1.2, -1.2], max: [1.2, 1.2, 1.2] };
  }

  if (raw.type === 'spawn') {
    return { min: [-1, -1, -1], max: [1, 1, 1] };
  }

  return { min: [-1, -1, -1], max: [1, 1, 1] };
}

function worldCorners(entity) {
  const { min, max } = entityBox(entity);
  const corners = [];

  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        corners.push(M4.transformPoint(entity.matrix, [x, y, z]));
      }
    }
  }

  return corners;
}

/** Оси пустого узла: без геометрии объект иначе не найти в сцене. */
function pushEmptyMarker(vertices, entity, color) {
  const center = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
  const length = Math.max(1.5, state.camera.distance * 0.045);
  const axes = [
    [color || [1, 0.42, 0.42], [length, 0, 0]],
    [color || [0.45, 1, 0.5], [0, length, 0]],
    [color || [0.45, 0.65, 1], [0, 0, length]]
  ];

  for (const [tone, offset] of axes) {
    pushLine(vertices, center, [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]], tone);
  }
}

/** Маркер камеры: конус обзора смотрит в −Z, как нос корабля. */
function pushCameraMarker(vertices, entity, color) {
  const camera = entity.raw.camera || {};
  const tone = color || [0.95, 0.75, 0.35];
  const fov = ((Number(camera.fov) || 50) * Math.PI) / 180;
  const length = Math.min(14, Math.max(2, state.camera.distance * 0.06));
  const half = Math.tan(fov / 2) * length;
  const aspect = 16 / 9;

  const corners = [
    [-half * aspect, -half, -length],
    [half * aspect, -half, -length],
    [half * aspect, half, -length],
    [-half * aspect, half, -length]
  ].map((point) => M4.transformPoint(entity.matrix, point));

  const apex = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
  for (const corner of corners) pushLine(vertices, apex, corner, tone);
  for (let i = 0; i < corners.length; i++) {
    pushLine(vertices, corners[i], corners[(i + 1) % corners.length], tone);
  }
}

/** Маркер узла эффекта: сфера привязки и направление. */
function pushEffectMarker(vertices, entity, color) {
  const slot = (entity.raw.effects || [])[0] || entity.raw;
  const offset = Array.isArray(slot.offset) ? slot.offset : [0, 0, 0];
  const center = M4.transformPoint(entity.matrix, offset);
  const scale = Math.max(
    Math.abs(entity.scale[0]), Math.abs(entity.scale[1]), Math.abs(entity.scale[2]), 0.1
  );
  const radius = 0.45 * scale;

  pushWireSphere(vertices, center, radius, color);

  const forward = M4.transformPoint(entity.matrix, [
    offset[0], offset[1], offset[2] - 1
  ]);
  const dx = forward[0] - center[0];
  const dy = forward[1] - center[1];
  const dz = forward[2] - center[2];
  const length = Math.hypot(dx, dy, dz) || 1;
  pushLine(vertices, center, [
    center[0] + (dx / length) * radius * 4,
    center[1] + (dy / length) * radius * 4,
    center[2] + (dz / length) * radius * 4
  ], color);
}

/** Каркас по форме: сфера триггера — сфера, остальное — бокс. */
function pushEntityOutline(vertices, entity, color) {
  const trigger = entity.raw.trigger;

  if (entity.raw.type === 'empty') {
    pushEmptyMarker(vertices, entity, color);
    return;
  }

  if (entity.raw.type === 'camera') {
    pushCameraMarker(vertices, entity, color);
    return;
  }

  if (entity.raw.type === 'effect') {
    pushEffectMarker(vertices, entity, color);
    return;
  }

  if (entity.raw.type === 'trigger' && trigger?.shape === 'sphere') {
    const center = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
    const scale = Math.max(entity.scale[0], entity.scale[1], entity.scale[2]) || 1;
    pushWireSphere(vertices, center, Math.abs(trigger.radius ?? 5) * scale, color);
    return;
  }

  pushWireBoxCorners(vertices, worldCorners(entity), color);
}

function entityWorldAabb(entity) {
  const corners = worldCorners(entity);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (const corner of corners) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], corner[i]);
      max[i] = Math.max(max[i], corner[i]);
    }
  }

  return { min, max };
}

function rayAabb(ray, min, max) {
  let tmin = -Infinity;
  let tmax = Infinity;

  for (let i = 0; i < 3; i++) {
    const origin = ray.origin[i];
    const dir = ray.direction[i];

    if (Math.abs(dir) < 1e-8) {
      if (origin < min[i] || origin > max[i]) return null;
      continue;
    }

    const t1 = (min[i] - origin) / dir;
    const t2 = (max[i] - origin) / dir;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));

    if (tmin > tmax) return null;
  }

  return tmax < 0 ? null : Math.max(tmin, 0);
}

function pickEntity(clientX, clientY) {
  const ray = screenRay(clientX, clientY);
  let best = null;
  let bestDistance = Infinity;

  for (const entity of state.entities) {
    if (entity.raw.type === 'spawn' || entity.raw.type === 'hud') continue;

    // У пустого узла нет габаритов: ловим по экранному расстоянию до центра
    if (entity.raw.type === 'empty') {
      const center = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
      const onScreen = project(center);

      if (onScreen && Math.hypot(clientX - onScreen.x, clientY - onScreen.y) <= 16) {
        const distance = Math.hypot(
          center[0] - ray.origin[0], center[1] - ray.origin[1], center[2] - ray.origin[2]
        );

        if (distance < bestDistance) {
          bestDistance = distance;
          best = entity;
        }
      }
      continue;
    }

    const { min, max } = entityWorldAabb(entity);
    const distance = rayAabb(ray, min, max);

    if (distance != null && distance < bestDistance) {
      bestDistance = distance;
      best = entity;
    }
  }

  return best;
}

function gizmoLength() {
  return Math.max(2.5, state.camera.distance * 0.12);
}

function hitRotationRing(clientX, clientY, entity) {
  const origin = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
  const ringRadius = gizmoLength() * 0.8;
  const segments = 48;
  const mouse = { x: clientX, y: clientY };
  let bestAxis = -1;
  let bestDistance = 10;

  AXES.forEach((axis, index) => {
    const u = AXES[(index + 1) % 3].dir;
    const v = AXES[(index + 2) % 3].dir;
    let previous = null;

    for (let step = 0; step <= segments; step++) {
      const angle = (step / segments) * Math.PI * 2;
      const point = project([
        origin[0] + (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)) * ringRadius,
        origin[1] + (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)) * ringRadius,
        origin[2] + (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)) * ringRadius
      ]);

      if (previous && point) {
        const distance = pointSegmentDistance(mouse, previous, point);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestAxis = index;
        }
      }

      previous = point;
    }
  });

  return bestAxis;
}

function hitScaleCenter(clientX, clientY, entity) {
  const origin = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
  const onScreen = project(origin);
  if (!onScreen) return false;

  return Math.hypot(clientX - onScreen.x, clientY - onScreen.y) <= 14;
}

function hitGizmoAxis(clientX, clientY, entity) {
  const origin = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
  const length = gizmoLength();
  const mouse = { x: clientX, y: clientY };
  let bestAxis = -1;
  let bestDistance = 12;

  AXES.forEach((axis, index) => {
    // Ось начинается не с центра: иначе ручка центра недоступна
    const from = project([
      origin[0] + axis.dir[0] * length * 0.18,
      origin[1] + axis.dir[1] * length * 0.18,
      origin[2] + axis.dir[2] * length * 0.18
    ]);
    const to = project([
      origin[0] + axis.dir[0] * length,
      origin[1] + axis.dir[1] * length,
      origin[2] + axis.dir[2] * length
    ]);
    if (!from || !to) return;

    const distance = pointSegmentDistance(mouse, from, to);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAxis = index;
    }
  });

  return bestAxis;
}

function pointSegmentDistance(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq))
    : 0;

  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

/* -------------------------------- Рендер --------------------------------- */

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
}

function render() {
  resize();
  updateCameraReadout();

  const now = performance.now() / 1000;
  const previewDt = lastPreviewTime ? Math.min(0.1, now - lastPreviewTime) : 0;
  lastPreviewTime = now;
  effectPreview.update(previewDt);

  const { viewProj, eye } = viewProjection();
  state.viewProj = viewProj;

  const backgroundEntity = state.entities.find((entity) => entity.raw.type === 'camera' && entity.raw.visible !== false);
  const background = hexToRgb(
    backgroundEntity?.raw?.camera?.background || state.scene?.background || '#000000',
    [0, 0, 0]
  );
  gl.clearColor(background[0], background[1], background[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  const u = meshLoc.u;
  gl.useProgram(meshProgram.program);
  gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
  gl.uniform3fv(u.uCamera, eye);
  gl.uniform3fv(u.uLightDir, [0.35, 0.55, 0.76]);
  gl.uniform1f(u.uRoughness, 1.0);
  gl.uniform1i(u.uAlbedoMap, 0);
  gl.uniform1i(u.uRoughMap, 1);
  gl.uniform1i(u.uMetalMap, 2);

  const drawable = state.entities.filter((entity) => entity.model && entity.visible !== false);

  for (const entity of drawable) {
    for (const part of entity.model.parts) {
      if (part.blend === 'additive') continue;
      drawMeshPart(part, M4.mul(entity.matrix, part.matrix));
    }
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.depthMask(false);

  for (const entity of drawable) {
    for (const part of entity.model.parts) {
      if (part.blend !== 'additive') continue;
      drawMeshPart(part, M4.mul(entity.matrix, part.matrix));
    }
  }

  gl.depthMask(true);
  gl.disable(gl.BLEND);

  if (state.showGrid) drawLines(gridVertices(), true);

  const overlay = [];

  if (state.showColliders) {
    for (const entity of state.entities) {
      const body = entity.raw.body;
      if (!body?.collider) continue;

      const collider = body.collider;
      const center = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];

      if (collider.shape === 'sphere') {
        pushWireSphere(overlay, center, collider.radius * entity.scaleUniform, [0.3, 0.8, 1.0]);
      } else if (collider.shape === 'box') {
        const corners = worldCorners({ ...entity, raw: { type: 'primitive', size: collider.halfExtents.map((v) => v * 2) } });
        pushWireBoxCorners(overlay, corners, [0.3, 0.8, 1.0]);
      } else if (collider.shape === 'compound') {
        for (const sphere of collider.spheres || []) {
          const offset = M4.transformPoint(entity.matrix, sphere.offset);
          pushWireSphere(overlay, offset, sphere.radius * entity.scaleUniform, [0.3, 0.8, 1.0]);
        }

        for (const box of collider.boxes || []) {
          const corners = [];

          for (let index = 0; index < 8; index++) {
            const sign = [
              index & 1 ? 1 : -1,
              index & 2 ? 1 : -1,
              index & 4 ? 1 : -1
            ];

            corners.push(M4.transformPoint(entity.matrix, [
              box.offset[0] + sign[0] * box.halfExtents[0],
              box.offset[1] + sign[1] * box.halfExtents[1],
              box.offset[2] + sign[2] * box.halfExtents[2]
            ]));
          }

          pushWireBoxCorners(overlay, corners, [0.3, 0.8, 1.0]);
        }
      }
    }
  }

  for (const entity of state.entities) {
    if (entity.raw.type !== 'trigger') continue;
    pushEntityOutline(overlay, entity, [0.35, 0.95, 0.6]);
  }

  // Пустые узлы видно всегда; выбранный рисуется оранжевым в блоке выделения
  for (const entity of state.entities) {
    if (entity.raw.type !== 'empty' || entity.raw.id === state.selectedId) continue;
    if (entity.raw.visible === false) continue;
    pushEmptyMarker(overlay, entity, null);
  }

  // Точки появления видно всегда: жёлтый крест и стрелка вверх
  for (const spawn of state.entities) {
    if (spawn.raw.type !== 'spawn') continue;

    const base = [spawn.matrix[12], spawn.matrix[13], spawn.matrix[14]];
    const color = spawn.raw.id === state.selectedId ? [1.0, 0.85, 0.3] : [0.85, 0.7, 0.2];

    pushLine(overlay, base, [base[0], base[1] + 3, base[2]], color);
    pushLine(overlay, [base[0] - 1.5, base[1], base[2]], [base[0] + 1.5, base[1], base[2]], color);
    pushLine(overlay, [base[0], base[1], base[2] - 1.5], [base[0], base[1], base[2] + 1.5], color);
    pushLine(overlay, [base[0], base[1] + 3, base[2]], [base[0] - 0.6, base[1] + 2, base[2]], color);
    pushLine(overlay, [base[0], base[1] + 3, base[2]], [base[0] + 0.6, base[1] + 2, base[2]], color);
  }

  // Узлы эффектов видно в вьюпорте: точка привязки и направление
  for (const effectEntity of state.entities) {
    if (effectEntity.raw.type !== 'effect') continue;
    if (effectEntity.raw.visible === false) continue;
    if (effectEntity.raw.id === state.selectedId) continue;
    pushEffectMarker(overlay, effectEntity, [0.45, 0.85, 1.0]);
  }

  // Камеры видны всегда: конус обзора показывает, куда она смотрит
  for (const cameraEntity of state.entities) {
    if (cameraEntity.raw.type !== 'camera') continue;
    if (cameraEntity.raw.visible === false) continue;
    if (cameraEntity.raw.id === state.selectedId) continue;
    pushCameraMarker(overlay, cameraEntity, [0.8, 0.68, 0.35]);
  }

  // Активные инстансы предпросмотра: пульсирующая сфера в точке привязки
  for (const instance of effectPreview.instances.values()) {
    const radius = 0.6 + (instance.progress || 0) * 2.4;
    pushWireSphere(overlay, instance.position, radius, [1.0, 0.78, 0.3]);
  }

  const entity = selectedEntity();
  if (entity) {
    pushEntityOutline(overlay, entity, [1.0, 0.62, 0.25]);

    const origin = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
    const length = gizmoLength();

    if (state.gizmo === 'rotate') {
      const ringRadius = length * 0.8;
      const segments = 48;

      AXES.forEach((axis, index) => {
        const color = index === state.hoverAxis ? [1, 1, 1] : axis.color;
        const u = AXES[(index + 1) % 3].dir;
        const v = AXES[(index + 2) % 3].dir;
        let previous = null;

        for (let step = 0; step <= segments; step++) {
          const angle = (step / segments) * Math.PI * 2;
          const point = [
            origin[0] + (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)) * ringRadius,
            origin[1] + (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)) * ringRadius,
            origin[2] + (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)) * ringRadius
          ];

          if (previous) pushLine(overlay, previous, point, color);
          previous = point;
        }
      });
    } else if (state.gizmo === 'scale') {
      // Кольцо-центр и оси с квадратными наконечниками: тянем ось — растёт только она,
      // тянем центр — объект масштабируется равномерно
      const tick = length * 0.12;

      AXES.forEach((axis, index) => {
        const color = index === state.hoverAxis ? [1, 1, 1] : axis.color;
        const end = [
          origin[0] + axis.dir[0] * length * 0.75,
          origin[1] + axis.dir[1] * length * 0.75,
          origin[2] + axis.dir[2] * length * 0.75
        ];

        pushLine(overlay, origin, end, color);

        for (const other of AXES) {
          if (other === axis) continue;
          pushLine(overlay, end, [
            end[0] + other.dir[0] * tick,
            end[1] + other.dir[1] * tick,
            end[2] + other.dir[2] * tick
          ], color);
          pushLine(overlay, end, [
            end[0] - other.dir[0] * tick,
            end[1] - other.dir[1] * tick,
            end[2] - other.dir[2] * tick
          ], color);
        }
      });

      const centerColor = state.hoverAxis === 3 ? [1, 1, 1] : [1.0, 0.9, 0.35];
      for (const axis of AXES) {
        pushLine(overlay, [
          origin[0] - axis.dir[0] * tick,
          origin[1] - axis.dir[1] * tick,
          origin[2] - axis.dir[2] * tick
        ], [
          origin[0] + axis.dir[0] * tick,
          origin[1] + axis.dir[1] * tick,
          origin[2] + axis.dir[2] * tick
        ], centerColor);
      }
    } else {
      AXES.forEach((axis, index) => {
        const color = index === state.hoverAxis ? [1, 1, 1] : axis.color;
        pushLine(overlay, origin, [
          origin[0] + axis.dir[0] * length,
          origin[1] + axis.dir[1] * length,
          origin[2] + axis.dir[2] * length
        ], color);
      });
    }
  }

  drawLines(overlay, false);

  requestAnimationFrame(render);
}

/* --------------------------------- Мышь ---------------------------------- */

function cameraNormal() {
  const eye = cameraPosition();
  const { target } = state.camera;
  return normalize3([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
}

/** Пересечение луча с плоскостью, проходящей через точку. */
function planeHit(ray, point, normal) {
  const denom = dot3(ray.direction, normal);
  if (Math.abs(denom) < 1e-6) return null;

  const t = dot3([
    point[0] - ray.origin[0],
    point[1] - ray.origin[1],
    point[2] - ray.origin[2]
  ], normal) / denom;

  if (t < 0) return null;

  return [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t
  ];
}

const GIZMO_MODES = ['move', 'rotate', 'scale'];

function setGizmoMode(mode) {
  state.gizmo = GIZMO_MODES.includes(mode) ? mode : 'move';

  for (const radio of gizmoRadios) {
    radio.checked = radio.value === state.gizmo;
  }

  state.hoverAxis = -1;
  renderInspector();
}

for (const radio of gizmoRadios) {
  radio.addEventListener('change', () => {
    if (radio.checked) setGizmoMode(radio.value);
  });
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  state.pointer.down = true;
  state.pointer.moved = false;
  state.pointer.x = event.clientX;
  state.pointer.y = event.clientY;

  const entity = selectedEntity();

  if (event.button === 0 && entity && state.gizmo === 'rotate') {
    const axis = hitRotationRing(event.clientX, event.clientY, entity);

    if (axis >= 0) {
      const center = project([entity.matrix[12], entity.matrix[13], entity.matrix[14]]);

      state.drag = {
        mode: 'rotate',
        axis,
        entity,
        startQuat: entity.quaternion.slice(),
        center,
        lastAngle: Math.atan2(event.clientY - center.y, event.clientX - center.x),
        total: 0
      };
      return;
    }
  }

  if (event.button === 0 && entity && state.gizmo === 'scale') {
    // Сначала оси: иначе на близкой дистанции центр перекрывает наконечники
    const axis = hitGizmoAxis(event.clientX, event.clientY, entity);
    const uniform = axis < 0 && hitScaleCenter(event.clientX, event.clientY, entity);

    if (uniform || axis >= 0) {
      state.drag = {
        mode: 'scale',
        axis: uniform ? 3 : axis,
        entity,
        startScale: entity.scale.slice(),
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY
      };
      return;
    }
  }

  if (event.button === 0 && entity && state.gizmo === 'move') {
    const axis = hitGizmoAxis(event.clientX, event.clientY, entity);

    if (axis >= 0) {
      const ray = screenRay(event.clientX, event.clientY);
      const origin = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];
      const t = axisParameter(origin, AXES[axis].dir, ray);

      state.drag = {
        axis,
        entity,
        startT: t,
        startWorld: [entity.matrix[12], entity.matrix[13], entity.matrix[14]],
        startPosition: entity.position.slice(),
        startRotation: entity.rotation.slice(),
        startScale: entity.scale.slice()
      };
      return;
    }
  }

  // Тянуть можно только уже выбранный в дереве объект: сцена не меняет выбор
  if (event.button === 0 && state.gizmo === 'move') {
    const picked = pickEntity(event.clientX, event.clientY);
    const entity = selectedEntity();

    if (picked && entity && picked.id === entity.id) {
      const ray = screenRay(event.clientX, event.clientY);
      const normal = cameraNormal();
      const world = [picked.matrix[12], picked.matrix[13], picked.matrix[14]];
      const startHit = planeHit(ray, world, normal);

      state.drag = {
        mode: 'move',
        entity: picked,
        startWorld: world,
        startPosition: picked.position.slice(),
        planePoint: world,
        normal,
        startHit,
        lastX: event.clientX,
        lastY: event.clientY
      };
      return;
    }
  }

  if (event.button === 0) {
    state.drag = { mode: 'orbit', lastX: event.clientX, lastY: event.clientY };
  } else {
    state.drag = { mode: 'pan', lastX: event.clientX, lastY: event.clientY };
  }
});

canvas.addEventListener('pointermove', (event) => {
  const entity = selectedEntity();

  if (!state.pointer.down) {
    if (!entity) {
      state.hoverAxis = -1;
    } else if (state.gizmo === 'rotate') {
      state.hoverAxis = hitRotationRing(event.clientX, event.clientY, entity);
    } else if (state.gizmo === 'scale') {
      state.hoverAxis = hitGizmoAxis(event.clientX, event.clientY, entity);
      if (state.hoverAxis < 0 && hitScaleCenter(event.clientX, event.clientY, entity)) state.hoverAxis = 3;
    } else {
      state.hoverAxis = hitGizmoAxis(event.clientX, event.clientY, entity);
    }

    if (state.hoverAxis >= 0) {
      canvas.style.cursor = 'grab';
    } else {
      canvas.style.cursor = pickEntity(event.clientX, event.clientY) ? 'move' : 'crosshair';
    }
    return;
  }

  const drag = state.drag;
  if (!drag) return;

  const dx = event.clientX - drag.lastX;
  const dy = event.clientY - drag.lastY;
  state.pointer.moved = true;

  if (drag.mode === 'rotate') {
    const found = findRaw(state.doc.entities, drag.entity.id);
    if (!found || !drag.center) return;

    const angle = Math.atan2(event.clientY - drag.center.y, event.clientX - drag.center.x);
    let delta = angle - drag.lastAngle;

    // Переход через ±180° не должен дёргать объект
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;

    drag.lastAngle = angle;
    drag.total += delta;

    // У ребёнка поворот локальный: мировую ось переводим в оси родителя
    const parentQuat = drag.entity.parent ? quatFromMat4(drag.entity.parent.matrix) : [0, 0, 0, 1];
    const worldQuaternion = quatMul(
      quatFromAxisAngle(AXES[drag.axis].dir, drag.total),
      quatMul(parentQuat, drag.startQuat)
    );
    const quaternion = quatNormalize(quatMul(quatConjugate(parentQuat), worldQuaternion));

    found.raw.rotation = quatToEuler(quaternion);
    drag.entity.quaternion = quaternion;
    drag.entity.baseQuaternion = quaternion;

    markDirty();
    updateMatrices(state.entities);
    renderInspector();
    return;
  }

  if (drag.mode === 'scale') {
    const found = findRaw(state.doc.entities, drag.entity.id);
    if (!found) return;

    // Вертикальное движение мыши: 250 px вверх ≈ десятикратное увеличение
    const factor = Math.exp((drag.startY - event.clientY) * 0.0092);
    const raw = found.raw;
    const isUniform = drag.axis === 3;

    raw.scale = Array.isArray(raw.scale)
      ? raw.scale.slice()
      : [Number(raw.scale) || 1, Number(raw.scale) || 1, Number(raw.scale) || 1];

    for (let i = 0; i < 3; i++) {
      const base = drag.startScale[i];
      const next = isUniform || i === drag.axis ? base * factor : base;
      raw.scale[i] = Math.round(Math.min(100, Math.max(0.02, next)) * 1000) / 1000;
    }

    drag.entity.scale = raw.scale.slice();
    drag.entity.scaleUniform = Math.max(raw.scale[0], raw.scale[1], raw.scale[2]);
    markDirty();
    updateMatrices(state.entities);
    renderInspector();
    return;
  }

  if (drag.mode === 'move') {
    const found = findRaw(state.doc.entities, drag.entity.id);
    if (!found || !drag.startHit) return;

    const hit = planeHit(screenRay(event.clientX, event.clientY), drag.planePoint, drag.normal);
    if (!hit) return;

    const world = drag.startWorld.map((value, index) => value + hit[index] - drag.startHit[index]);
    const local = toParentSpace(drag.entity.parent ? drag.entity.parent.id : null, world);

    const raw = found.raw;
    raw.position = local.map(round);

    drag.entity.position = raw.position.slice();
    markDirty();
    updateMatrices(state.entities);
    renderInspector();
    return;
  }

  if (drag.mode === 'orbit') {
    state.camera.yaw -= dx * 0.008;
    state.camera.pitch = Math.max(-1.35, Math.min(1.35, state.camera.pitch + dy * 0.006));
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    return;
  }

  if (drag.mode === 'pan') {
    const eye = cameraPosition();
    const forward = normalize3([
      state.camera.target[0] - eye[0],
      state.camera.target[1] - eye[1],
      state.camera.target[2] - eye[2]
    ]);
    const right = normalize3(cross3(forward, [0, 1, 0]));
    const up = cross3(right, forward);
    const scale = state.camera.distance * 0.0016;

    for (let i = 0; i < 3; i++) {
      state.camera.target[i] += (-right[i] * dx + up[i] * dy) * scale;
    }

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    return;
  }

  if (drag.axis != null) {
    // Пишем в документ сцены, а не в нормализованную копию: иначе сохраняется старое
    const found = findRaw(state.doc.entities, drag.entity.id);
    if (!found) return;

    const ray = screenRay(event.clientX, event.clientY);
    // Ось тянем от точки захвата, иначе объект «уезжает» сам от себя
    const origin = drag.startWorld.slice();
    const t = axisParameter(origin, AXES[drag.axis].dir, ray);
    const delta = t - drag.startT;

    // Мировое смещение переводим в оси родителя: у ребёнка position локальная
    const world = origin.map((value, index) => value + AXES[drag.axis].dir[index] * delta);
    const local = toParentSpace(drag.entity.parent ? drag.entity.parent.id : null, world);

    const raw = found.raw;
    raw.position = local.map(round);

    drag.entity.position = raw.position.slice();
    markDirty();
    updateMatrices(state.entities);
    renderInspector();
  }
});

canvas.addEventListener('pointerup', () => {
  state.drag = null;
  state.pointer.down = false;
});

// Правый клик по сцене не открывает меню и не выделяет объект.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

contextMenu.addEventListener('pointerdown', (event) => event.stopPropagation());
contextMenu.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const prefabId = contextMenu.dataset.prefabId;
  hideContextMenu();

  if (action === 'edit' && prefabId) {
    openPrefabEditor(prefabId);
    return;
  }

  if (action === 'create') {
    savePrefab().catch((err) => setStatus(err.message, true));
    return;
  }

  if (action === 'add-empty') addEmpty();
  if (action === 'add-hud') addHud();
  if (action === 'add-trigger') addTrigger();
  if (action === 'add-camera') addCamera();
  if (action === 'add-prefab') openPrefabDialog().catch((err) => setStatus(err.message, true));
});

document.addEventListener('pointerdown', hideContextMenu);
window.addEventListener('blur', hideContextMenu);

treePanel?.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.tree-row')) return;

  event.preventDefault();
  selectEntity(null);
  showContextMenu(event.clientX, event.clientY, null);
});

const CAMERA_MIN = 4;
const CAMERA_MAX = 40000;   // в 10 раз дальше прежних 4000

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();

  // Шаг растёт вместе с отдалением: у корпуса ~13% за щелчок,
  // на дальнем краю — не больше двух раз, иначе дистанцию не поймать
  const step = Math.max(0.0012, Math.min(0.007, 0.0006 + state.camera.distance / 2000000));
  const factor = Math.exp(event.deltaY * step);

  state.camera.distance = Math.max(CAMERA_MIN, Math.min(CAMERA_MAX, state.camera.distance * factor));
  updateCameraReadout();
}, { passive: false });

/* --------------------------- Параметры скриптов --------------------------- */

/** У каждого скрипта может быть экспорт params — по нему строим поля. */
async function loadScriptSchemas() {
  state.scriptSchemas = {};

  await Promise.all(state.scripts.map(async (file) => {
    try {
      const module = await import(`/scripts/${file}`);
      if (module?.params && typeof module.params === 'object') {
        state.scriptSchemas[file] = module.params;
      }
    } catch {
      // скрипт без схемы или с ошибкой — полей не будет
    }
  }));

  renderInspector();
}

/* --------------------------------- HUD ----------------------------------- */

async function loadHudFiles() {
  try {
    const data = await fetch('/api/hud', { cache: 'no-store' }).then((response) => response.json());
    state.hudFiles = data.hud || [];
  } catch {
    state.hudFiles = [];
  }
}

async function hudHtml(file) {
  if (!state.hudCache.has(file)) {
    const text = await fetch(file, { cache: 'no-store' })
      .then((response) => (response.ok ? response.text() : ''))
      .catch(() => '');

    state.hudCache.set(file, text);
  }

  return state.hudCache.get(file);
}

/** Превью слоёв HUD в изолированном iframe: стили сцены не протекают в редактор. */
async function renderHudPreview() {
  const frame = hudPreviewEl;
  if (!frame) return;

  if (!state.doc) {
    frame.srcdoc = '';
    return;
  }

  const items = [];
  const walk = (list) => {
    for (const raw of list) {
      if (raw.type === 'hud' && raw.visible !== false) items.push(raw);
      walk(raw.children || []);
    }
  };
  walk(state.doc.entities);

  const layers = [];
  for (const raw of items) {
    const hud = raw.hud || {};
    const html = hud.file ? await hudHtml(hud.file) : '';
    layers.push(`<div class="hud-layer-preview${hud.startHidden ? ' is-hidden' : ''}">${html}</div>`);
  }

  const style = state.sceneRoot?.hudStyle
    ? `<link rel="stylesheet" href="/${state.sceneRoot.hudStyle}">`
    : '';

  frame.srcdoc = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<link rel="stylesheet" href="/editor.css">
${style}
<style>
  html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
  body { pointer-events: none; }
  .hud-preview {
    position: absolute; inset: 0; padding: 10px 12px; overflow: hidden;
  }
</style>
</head><body><div class="hud-preview">${layers.join('')}</div></body></html>`;
}

function addHud() {
  markDirty();

  const raw = {
    id: uniqueId('hud'),
    type: 'hud',
    name: 'HUD',
    position: [50, 10, 0],
    rotation: [0, 0, 0],
    scale: 1,
    hud: {
      file: state.hudFiles[0] || null,
      bind: null
    }
  };

  state.doc.entities.push(raw);
  state.selectedId = raw.id;
  rebuild().catch((err) => setStatus(err.message, true));
}

btnHud.addEventListener('click', addHud);

/* -------------------------------- Префабы -------------------------------- */

async function loadPrefabs(selectId) {
  try {
    const data = await fetch('/api/prefabs', { cache: 'no-store' }).then((response) => response.json());
    state.prefabs = data.prefabs || [];
  } catch {
    state.prefabs = [];
  }

  prefabSelect.innerHTML = state.prefabs.length
    ? state.prefabs.map((prefab) => `<option value="${prefab.id}">${escapeHtml(prefab.title)}</option>`).join('')
    : '<option value="">— нет префабов —</option>';

  if (selectId) prefabSelect.value = selectId;
}

function prefabIdOf(raw) {
  return raw?.prefabId || raw?.prefab?.id || null;
}

function openPrefabEditor(id) {
  if (!id) return;
  window.open(`editor.html?prefab=${encodeURIComponent(id)}`, '_blank', 'noopener');
}

async function openPrefabDialog() {
  await loadPrefabs(prefabSelect.value || undefined);

  if (!state.prefabs.length) {
    setStatus('Нет доступных префабов — сначала создайте префаб', true);
    return;
  }

  prefabDialogSelect.innerHTML = state.prefabs
    .map((prefab) => `<option value="${prefab.id}">${escapeHtml(prefab.title)} (${prefab.id})</option>`)
    .join('');

  prefabDialogSelect.value = state.prefabs.some((prefab) => prefab.id === prefabSelect.value)
    ? prefabSelect.value
    : state.prefabs[0].id;
  prefabDialog.hidden = false;
}

function closePrefabDialog() {
  prefabDialog.hidden = true;
}

function hideContextMenu() {
  contextMenu.hidden = true;
  contextMenu.innerHTML = '';
  delete contextMenu.dataset.prefabId;
}

function showContextMenu(x, y, raw = null) {
  const prefabId = raw ? prefabIdOf(raw) : null;
  const items = [];

  if (raw) {
    if (prefabId) {
      items.push(['edit', `Редактировать префаб «${raw.prefabTitle || prefabId}»`]);
    } else {
      items.push(['create', 'Создать префаб']);
    }
  }

  items.push(
    ['add-empty', 'Добавить пустой'],
    ['add-hud', 'Добавить HUD'],
    ['add-trigger', 'Добавить триггер'],
    ['add-camera', 'Добавить камеру'],
    ['add-prefab', 'Добавить префаб']
  );

  contextMenu.dataset.prefabId = prefabId || '';
  contextMenu.innerHTML = items
    .map(([action, label], index) => {
      const separator = raw && index === 1 ? '<div class="context-sep"></div>' : '';
      return `${separator}<button type="button" data-action="${action}">${escapeHtml(label)}</button>`;
    })
    .join('');
  contextMenu.hidden = false;

  const width = contextMenu.offsetWidth || 220;
  const height = contextMenu.offsetHeight || 80;
  contextMenu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - width - 8))}px`;
  contextMenu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - height - 8))}px`;
}

async function savePrefab() {
  const found = selected();
  if (!found) {
    setStatus('Выберите объект — группу с детьми тоже можно', true);
    return;
  }

  const name = prompt('Название префаба', found.raw.name || found.raw.id);
  if (!name) return;

  const id = slugify(name) || 'prefab';
  if (state.prefabs.some((prefab) => prefab.id === id) && !confirm(`Префаб «${id}» уже есть. Перезаписать?`)) return;

  const body = {
    version: 1,
    id,
    title: name,
    entities: [JSON.parse(JSON.stringify(found.raw))]
  };

  try {
    const response = await fetch(`/api/prefab/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(await response.text());

    // Помечаем исходный объект: теперь из контекстного меню его можно открыть
    found.raw.prefabId = id;
    found.raw.prefabTitle = name;
    markDirty();
    await rebuild();

    await loadPrefabs(id);
    setStatus(`Префаб «${name}» сохранён: public/prefabs/${id}.json`);
  } catch (err) {
    setStatus(`Не удалось сохранить префаб: ${err.message}`, true);
  }
}

async function insertPrefab(id) {
  if (!id) return;

  try {
    const prefab = await fetch(`/api/prefab/${id}`, { cache: 'no-store' }).then((response) => response.json());
    const roots = Array.isArray(prefab.entities) ? prefab.entities : [];
    if (!roots.length) throw new Error('в префабе нет сущностей');

    markDirty();

    // Динамическому телу внутри группы не место (это ломает трансформ
    // и физику), поэтому такой префаб ставим в корень сцены
    const group = nestTarget();
    const parent = group && roots.some(hasDynamicBody) ? null : group;
    const taken = collectIds();
    const clones = reassignIds(JSON.parse(JSON.stringify(roots)), (oldId) =>
      uniqueIdFrom(String(oldId || 'node').replace(/-\d+$/, '') || 'node', taken)
    );

    // Запоминаем, из какого префаба вставлена ветка — для контекстного меню
    for (const raw of clones) {
      raw.prefabId = id;
      raw.prefabTitle = prefab.title || id;
    }

    // Префаб встаёт в точку камеры: корни сдвигаем одним вектором,
    // относительные смещения внутри группы сохраняются
    const anchor = asArray3(clones[0].position, [0, 0, 0]);
    const target = toParentSpace(parent ? parent.raw.id : null, state.camera.target);
    const shift = [target[0] - anchor[0], target[1] - anchor[1], target[2] - anchor[2]];

    for (const raw of clones) {
      raw.position = asArray3(raw.position, [0, 0, 0]).map((value, index) => round(value + shift[index]));
      insertRaw(raw, parent);
    }

    state.selectedId = clones[0].id;
    await rebuild();
    setStatus(`Вставлен префаб «${prefab.title || id}»${
      group && !parent ? ' — в корень сцены: внутри группы нельзя держать динамическое тело' : ''
    }`);
  } catch (err) {
    setStatus(`Не удалось вставить префаб: ${err.message}`, true);
  }
}

async function deletePrefab() {
  const id = prefabSelect.value;
  if (!id) return;
  if (!confirm(`Удалить префаб «${id}»?`)) return;

  try {
    const response = await fetch(`/api/prefab/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await response.text());

    await loadPrefabs();
    setStatus(`Префаб «${id}» удалён`);
  } catch (err) {
    setStatus(`Не удалось удалить префаб: ${err.message}`, true);
  }
}

btnPrefabSave.addEventListener('click', () => savePrefab().catch((err) => setStatus(err.message, true)));
btnPrefabEdit.addEventListener('click', () => {
  const id = prefabSelect.value;
  if (!id) {
    setStatus('Выберите префаб для редактирования', true);
    return;
  }

  openPrefabEditor(id);
});
btnPrefabInsert.addEventListener('click', () => insertPrefab(prefabSelect.value).catch((err) => setStatus(err.message, true)));

btnPrefabDialogInsert.addEventListener('click', () => {
  const id = prefabDialogSelect.value;
  closePrefabDialog();
  if (id) insertPrefab(id).catch((err) => setStatus(err.message, true));
});
btnPrefabDialogCancel.addEventListener('click', closePrefabDialog);
btnPrefabDialogClose.addEventListener('click', closePrefabDialog);
prefabDialog.addEventListener('click', (event) => {
  if (event.target === prefabDialog) closePrefabDialog();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !prefabDialog.hidden) closePrefabDialog();
});
btnPrefabDelete.addEventListener('click', () => deletePrefab().catch((err) => setStatus(err.message, true)));

/* ------------------------------- Кнопки ---------------------------------- */

function addEmpty() {
  markDirty();

  const parent = nestTarget();
  const raw = {
    id: uniqueId('empty'),
    type: 'empty',
    name: 'Пустой',
    position: spawnPosition(parent),
    rotation: [0, 0, 0],
    scale: 1,
    children: []
  };

  insertRaw(raw, parent);
  state.selectedId = raw.id;
  rebuild().catch((err) => setStatus(err.message, true));
}

function firstModelId() {
  let found = '';

  const walk = (list) => {
    for (const raw of list || []) {
      if (!found && raw.type === 'model') found = raw.id;
      walk(raw.children);
    }
  };

  walk(state.doc?.entities);
  return found;
}

function addCamera() {
  markDirty();

  const parent = nestTarget();
  const raw = {
    id: uniqueId('camera'),
    type: 'camera',
    name: 'Камера',
    position: spawnPosition(parent),
    rotation: [0, 0, 0],
    scale: 1,
    camera: { height: 20, distance: 120, drop: 0, tilt: 0, fov: 50, near: 0.1, far: 5000 },
    scripts: [{
      file: 'camera.js',
      params: { body: firstModelId(), height: 20, distance: 120, drop: 0, tilt: 0, side: 0, fov: 55, lag: 6 }
    }],
    children: []
  };

  insertRaw(raw, parent);
  state.selectedId = raw.id;
  rebuild().catch((err) => setStatus(err.message, true));
}

function addTrigger() {
  markDirty();
  const raw = {
    id: uniqueId('trigger'),
    type: 'trigger',
    position: state.camera.target.slice(),
    trigger: { shape: 'box', size: [14, 10, 14], once: false }
  };

  state.doc.entities.push(raw);
  state.selectedId = raw.id;
  rebuild().catch((err) => setStatus(err.message, true));
}

function firstEffectId() {
  return state.effects.find((effect) => effect.id === 'smoke-trail')?.id
    || state.effects[0]?.id
    || 'smoke-trail';
}

function addEffectNode() {
  markDirty();

  const parent = nestTarget();
  const raw = {
    id: uniqueId('effect'),
    type: 'effect',
    name: 'Эффект',
    position: spawnPosition(parent),
    rotation: [0, 0, 0],
    scale: 1,
    effects: [{
      id: 'main',
      effect: firstEffectId(),
      trigger: 'auto',
      loop: true,
      duration: 1,
      offset: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      params: {}
    }],
    children: []
  };

  insertRaw(raw, parent);
  state.selectedId = raw.id;
  rebuild().catch((err) => setStatus(err.message, true));
}

btnEmpty.addEventListener('click', addEmpty);
btnCamera.addEventListener('click', addCamera);
btnTrigger.addEventListener('click', addTrigger);
btnEffect.addEventListener('click', addEffectNode);
btnImport.addEventListener('click', () => glbInput.click());

async function loadAssets() {
  try {
    const data = await fetch('/api/assets', { cache: 'no-store' }).then((response) => response.json());
    state.assets = data.assets || [];
    assetSelect.innerHTML = state.assets.map((id) => `<option value="${id}">${id}</option>`).join('');
  } catch {
    state.assets = [];
    assetSelect.innerHTML = '';
  }
}

async function loadEffects() {
  try {
    const data = await fetch('/api/effects', { cache: 'no-store' }).then((response) => response.json());
    state.effects = Array.isArray(data.effects) ? data.effects : [];
    for (const definition of state.effects) effectPreview.registerDefinition(definition.id, definition);
  } catch {
    state.effects = [];
  }
}

function effectDefinition(id) {
  return state.effects.find((effect) => effect.id === id) || null;
}

async function addModel(assetId) {
  if (!assetId) return;

  markDirty();
  const parent = nestTarget();

  // Физика по умолчанию — из редактора модели (public/models/<id>.physics.json);
  // если его нет, сервер отдаёт сферу по габаритам модели.
  let physics = null;
  try {
    const response = await fetch(`/api/model/${encodeURIComponent(assetId)}`, { cache: 'no-store' });
    if (response.ok) physics = (await response.json()).physics || null;
  } catch {
    physics = null;
  }

  if (!physics) {
    let radius = 2;
    try {
      const manifest = await fetch(`models/${assetId}.json`, { cache: 'no-store' }).then((response) => response.json());
      const bounds = manifest.bounds;
      radius = bounds
        ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2
        : (manifest.radius || 2);
    } catch {
      // без манифеста оставим радиус по умолчанию
    }

    physics = {
      kind: 'static',
      mass: 0,
      restitution: 0.55,
      friction: 0.2,
      collider: { shape: 'sphere', radius: Math.max(0.3, radius) }
    };
  }

  const raw = {
    id: uniqueId(assetId),
    type: 'model',
    name: assetId,
    asset: assetId,
    position: spawnPosition(parent),
    rotation: [0, 0, 0],
    scale: 1,
    body: {
      kind: physics.kind === 'dynamic' ? 'dynamic' : 'static',
      mass: physics.kind === 'dynamic' ? physics.mass : 0,
      restitution: physics.restitution,
      friction: physics.friction,
      collider: { ...physics.collider }
    }
  };

  insertRaw(raw, parent);
  state.selectedId = raw.id;
  await rebuild();
  setStatus(`Добавлена модель ${assetId}`);
}

btnModel.addEventListener('click', () => {
  addModel(assetSelect.value).catch((err) => setStatus(err.message, true));
});

// Редактор модели — отдельное окно: тип, масса и коллайдер ассета
const btnModelEdit = document.getElementById('btn-model-edit');
btnModelEdit?.addEventListener('click', () => {
  const id = assetSelect.value;
  if (!id) {
    setStatus('Сначала выберите модель в списке', true);
    return;
  }

  window.open(`/model-editor.html?model=${encodeURIComponent(id)}`, '_blank', 'noopener');
});

function slugify(fileName) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya'
  };

  const slug = fileName
    .toLowerCase()
    .replace(/\.glb$/i, '')
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug || 'imported';
}

/** Сжать картинку материала: большой PNG из GLB не влезет в лимит запроса. */
async function shrinkTexture(bytes, mime, maxSize = 1024, quality = 0.86) {
  try {
    const blob = new Blob([bytes], { type: mime || 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return dataUrl.split(',')[1];
  } catch (err) {
    // Не получилось перекодировать — отправляем как есть, вдруг небольшая
    console.warn('[import] текстура не сжата:', err.message);
    return bytesToBase64(bytes);
  }
}

async function uniqueAssetId(fileName) {
  const base = slugify(fileName);
  let taken = new Set();

  try {
    const response = await fetch('/api/assets', { cache: 'no-store' });
    const data = await response.json();
    taken = new Set(data.assets || []);
  } catch {
    // без списка просто перезапишем одноимённый ассет
  }

  let id = base;
  let index = 2;
  while (taken.has(id)) id = `${base}-${index++}`;
  return id;
}

glbInput.addEventListener('change', async () => {
  const file = glbInput.files?.[0];
  if (!file) return;

  glbInput.value = '';
  setStatus(`Импорт ${file.name}…`);

  try {
    const parsed = parseGlb(await file.arrayBuffer());
    const { manifest, bin, textures } = packAsset(parsed, { name: file.name.replace(/\.glb$/i, '') });

    // Если такой ассет уже есть — предлагаем заменить, чтобы сцена не потеряла ссылку
    const baseId = slugify(file.name) || 'imported';
    const existing = state.assets.includes(baseId);
    const replaced = existing && confirm(`Ассет «${baseId}» уже есть. Заменить его?`);
    const assetId = existing && !replaced ? await uniqueAssetId(file.name) : baseId;

    setStatus(`Импорт ${file.name}: текстур ${textures?.length || 0}…`);

    // Наборы текстур: первый называется по ассету, остальные — с суффиксом.
    // Картинки сжимаем в JPEG: PNG из GLB бывают по 5–9 МБ каждая.
    const textureSets = [];
    for (const [index, texture] of (textures || []).entries()) {
      textureSets.push({
        name: index === 0 ? assetId : `${assetId}-${index + 1}`,
        base64: await shrinkTexture(texture.bytes, texture.mime)
      });
    }

    // Имена в манифесте должны совпадать с папками textures/<name>
    for (const group of manifest.groups) {
      if (!group.texture) continue;
      const index = (textures || []).findIndex((texture) => texture.name === group.texture);
      if (index >= 0) group.texture = index === 0 ? assetId : `${assetId}-${index + 1}`;
    }

    const response = await fetch(`/api/asset/${assetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, binBase64: bytesToBase64(bin), textures: textureSets })
    });

    if (!response.ok) throw new Error(await response.text());

    // Замена: сцена уже ссылается на этот ассет — новую сущность не плодим
    if (replaced) {
      await loadAssets();
      assetSelect.value = assetId;
      setStatus(`Ассет models/${assetId}.json заменён: частей ${manifest.groups.length}, текстур ${textureSets.length}`);
      return;
    }

    const bounds = manifest.bounds;
    const radius = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2]
    ) / 2;

    const parent = nestTarget();

    const raw = {
      id: uniqueId(assetId),
      type: 'model',
      name: file.name.replace(/\.glb$/i, ''),
      asset: assetId,
      position: spawnPosition(parent),
      rotation: [0, 0, 0],
      scale: 1,
      body: {
        kind: 'static',
        collider: { shape: 'sphere', radius: Math.max(0.5, radius) }
      }
    };

    insertRaw(raw, parent);
    state.selectedId = raw.id;
    await rebuild();

    await loadAssets();
    assetSelect.value = assetId;
    setStatus(`Импортировано: models/${assetId}.json, частей ${manifest.groups.length}, ${bin.length} байт`);
  } catch (err) {
    setStatus(`Импорт не удался: ${err.message}`, true);
  }
});

btnDuplicate.addEventListener('click', () => {
  if (state.mode === 'scene' && state.selectedId === SCENE_ID) {
    setStatus('Объект «Сцена» не копируется — он один на сцену', true);
    return;
  }

  const found = selected();
  if (!found) return;

  const clone = JSON.parse(JSON.stringify(found.raw));

  // Новые id на всех уровнях: копии нельзя занимать один и тот же номер
  const taken = collectIds();
  reassignIds([clone], (oldId) => uniqueIdFrom(String(oldId || 'copy').replace(/-\d+$/, '') || 'copy', taken));

  clone.position = asArray3(clone.position).map((value, index) => value + (index === 0 ? 6 : 0));

  if (found.parent) found.parent.children.push(clone);
  else state.doc.entities.push(clone);

  state.selectedId = clone.id;
  markDirty();
  rebuild().catch((err) => setStatus(err.message, true));
});

function deleteSelected() {
  if (state.mode === 'scene' && state.selectedId === SCENE_ID) {
    setStatus('Объект «Сцена» удалить нельзя — это корень сцены', true);
    return;
  }

  const found = selected();
  if (!found) return;

  markDirty();

  const list = found.parent ? found.parent.children : state.doc.entities;
  const index = list.indexOf(found.raw);
  if (index >= 0) list.splice(index, 1);

  // Ссылка на точку спавна не должна оставаться битой
  if (state.doc.player?.spawn === found.raw.id) delete state.doc.player.spawn;
  if (state.sceneRoot?.player?.spawn === found.raw.id) delete state.sceneRoot.player.spawn;

  state.selectedId = null;
  rebuild().catch((err) => setStatus(err.message, true));
}

btnDelete.addEventListener('click', deleteSelected);

const SAVE_HINT = 'обновите вкладку игры (F5)';

function updateSaveUi() {
  if (!saveStateEl) return;

  if (state.saving) {
    saveStateEl.textContent = 'Сохранение…';
    saveStateEl.className = 'save-state saving';
    return;
  }

  if (state.dirty) {
    saveStateEl.textContent = '● не сохранено';
    saveStateEl.className = 'save-state dirty';
    return;
  }

  saveStateEl.textContent = state.lastSavedAt ? `сохранено ${state.lastSavedAt}` : 'без изменений';
  saveStateEl.className = 'save-state saved';
}

function markDirty() {
  state.dirty = true;
  updateSaveUi();
  scheduleAutoSave();
}

function scheduleAutoSave() {
  if (!chkAutoSave?.checked) return;
  clearTimeout(scheduleAutoSave.timer);
  scheduleAutoSave.timer = setTimeout(() => saveScene(), 1500);
}

/** Файл сцены: корень «Сцена» с общими настройками, объекты — его дети. */
function buildScenePayload() {
  const root = state.sceneRoot || {};

  return {
    version: state.doc.version || 1,
    id: state.doc.id,
    title: state.doc.title,
    entities: [{
      id: root.id || 'scene',
      type: 'scene',
      name: root.name || 'Сцена',
      background: root.background || '#000000',
      hud: root.hudStyle ? { style: root.hudStyle } : {},
      loading: { ...(root.loading || {}) },
      player: { ...(root.player || {}) },
      children: state.doc.entities || []
    }]
  };
}

async function saveScene() {
  if (state.saving) return;

  if (!Array.isArray(state.doc?.entities) || !state.doc.entities.length) {
    setStatus('В сцене нет ни одной сущности — сохранять нечего', true);
    return;
  }

  const expected = state.doc.entities.length;
  const isPrefab = state.mode === 'prefab';
  const payload = isPrefab ? state.doc : buildScenePayload();
  const snapshot = JSON.stringify(payload);
  const targetUrl = isPrefab
    ? `/api/prefab/${state.prefabId}`
    : `/api/scene/${state.sceneId}`;

  state.saving = true;
  btnSave.disabled = true;
  updateSaveUi();
  setStatus('Сохранение…');

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(isPrefab ? {} : { 'X-Scene-Mtime': state.fileMtime || '' })
      },
      body: snapshot
    });

    if (!isPrefab && response.status === 409) {
      const conflict = await response.json().catch(() => ({}));
      state.conflict = true;

      if (confirm('Файл сцены изменился в другой вкладке. Загрузить версию с диска? Несохранённые правки пропадут.')) {
        await loadScene(state.sceneId);
        setStatus('Загружена версия с диска');
      } else {
        setStatus('Конфликт версий: файл изменён в другой вкладке', true);
      }
      return;
    }

    if (!response.ok) throw new Error(await response.text());

    state.fileMtime = response.headers.get('x-scene-mtime') || state.fileMtime;

    // Проверяем, что на диске действительно записалось то, что отправили
    const check = await fetch(targetUrl, { cache: 'no-store' });
    if (!check.ok) throw new Error('файл не читается после записи');

    const saved = await check.json();
    const savedList = Array.isArray(saved.entities) ? saved.entities : [];
    const savedRoot = savedList.find((entity) => entity && entity.type === 'scene') || null;
    const savedCount = savedRoot
      ? (Array.isArray(savedRoot.children) ? savedRoot.children.length : 0)
      : savedList.length;
    if (savedCount !== expected) {
      throw new Error(`на диске ${savedCount} сущностей вместо ${expected}`);
    }

    state.lastSavedAt = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    if (!isPrefab) {
      // Ссылка «Играть» всегда открывает свежую версию сцены
      playLink.href = `/?scene=${state.sceneId}&t=${Date.now()}`;
    }
    state.dirty = false;
    setStatus(`${isPrefab ? 'Префаб сохранён' : 'Сохранено'} ${state.lastSavedAt} · ${expected} сущностей${isPrefab ? '' : ` · ${SAVE_HINT}`}`);
  } catch (err) {
    setStatus(`Не удалось сохранить: ${err.message}`, true);
  } finally {
    state.saving = false;
    btnSave.disabled = false;
    updateSaveUi();
  }
}

btnSave.addEventListener('click', () => saveScene());

btnRestore.addEventListener('click', async () => {
  if (state.mode === 'prefab') {
    setStatus('У префаба нет резервной копии — откат доступен только сценам', true);
    return;
  }

  if (!confirm(`Вернуть предыдущую версию сцены «${state.sceneId}»?`)) return;

  try {
    const response = await fetch(`/api/scene/${state.sceneId}/restore`, { method: 'POST' });
    if (!response.ok) throw new Error(await response.text());

    await loadScene(state.sceneId);
    setStatus('Вернул предыдущую версию сцены');
  } catch (err) {
    setStatus(`Откат не удался: ${err.message}`, true);
  }
});

btnLoad.addEventListener('click', () => {
  const task = state.mode === 'prefab'
    ? loadPrefabDoc(state.prefabId)
    : loadScene(sceneSelect.value);
  task.catch((err) => setStatus(err.message, true));
});
sceneSelect.addEventListener('change', () => {
  loadScene(sceneSelect.value).catch((err) => setStatus(err.message, true));
});

chkGrid.addEventListener('change', () => { state.showGrid = chkGrid.checked; });
chkColliders.addEventListener('change', () => { state.showColliders = chkColliders.checked; });

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target && target.matches && target.matches('input, select, textarea')) return;

  if (event.key === 'Delete') {
    event.preventDefault();
    deleteSelected();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveScene();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    btnDuplicate.click();
  }

  if (event.key === 'Escape') selectEntity(null);

  if (event.key === 'g' || event.key === 'G' || event.key === 'п' || event.key === 'П') {
    setGizmoMode('move');
  }

  if (event.key === 'r' || event.key === 'R' || event.key === 'к' || event.key === 'К') {
    setGizmoMode('rotate');
  }

  if (event.key === 's' || event.key === 'S' || event.key === 'ы' || event.key === 'Ы') {
    setGizmoMode('scale');
  }
});

/* --------------------------------- Старт --------------------------------- */

// Отладочный доступ: удобно проверять сцену из консоли браузера
window.__editor = { state, selectEntity, rebuild, loadScene, project, hitGizmoAxis, screenRay, axisParameter };
updateSaveUi();


(async () => {
  try {
    const params = new URLSearchParams(location.search);
    const prefabId = params.get('prefab');

    try {
      const scripts = await fetch('/api/scripts', { cache: 'no-store' }).then((response) => response.json());
      state.scripts = scripts.scripts || [];
    } catch {
      state.scripts = [];
    }

    await loadScriptSchemas();
    await loadAssets();
    await loadEffects();
    await loadHudFiles();

    if (prefabId) {
      await loadPrefabs(prefabId);
      await loadPrefabDoc(prefabId);
    } else {
      await loadPrefabs();
      const scenes = await loadSceneList();
      const available = scenes.filter((scene) => !scene.missing);
      const requested = params.get('scene');
      const id = requested && available.some((scene) => scene.id === requested)
        ? requested
        : (available[0]?.id || 'first-game');

      await loadScene(id);
    }

    requestAnimationFrame(render);
  } catch (err) {
    setStatus(`Ошибка: ${err.message}`, true);
    console.error(err);
  }
})();
