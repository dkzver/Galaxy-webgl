// Редактор модели: предпросмотр меша с коллайдером + физика ассета.
// Физика хранится в public/models/<id>.physics.json и подставляется,
// когда модель добавляют в сцену. Уже добавленные объекты живут своей копией.
//
// Коллайдер compound — это набор частей: боксов и сфер. Состав правится
// вручную (список, поля, перетаскивание в предпросмотре) или строится
// по треугольникам меша кнопкой «Построить по модели».

import { M4 } from '../math.js';
import { createProgram } from '../gl.js';
import { bytesToBase64, packAsset, parseGlb } from '../glb.js';
import { meshVS, meshFS } from '../render/mesh-shader.js';
import { loadBinaryModel } from '../ship.js';
import { extractModel, listObjects } from '../model-split.js';
import { pushLine, pushWireBoxCorners, pushWireSphere } from '../wire.js';
import {
  boxCorners,
  buildBoxCollider,
  buildCompoundCollider,
  buildSphereCollider,
  pickPart,
  raycastMesh,
  simplifyBoxes
} from './collider-fit.js';

const modelSelect = document.getElementById('model-select');
const btnSave = document.getElementById('btn-save');
const btnReimport = document.getElementById('btn-reimport');
const glbInput = document.getElementById('glb-input');
const saveState = document.getElementById('save-state');
const summaryEl = document.getElementById('summary');

const partsTree = document.getElementById('parts-tree');
const partsTotal = document.getElementById('parts-total');
const btnPartsAll = document.getElementById('btn-parts-all');
const btnPartsNone = document.getElementById('btn-parts-none');
const extractId = document.getElementById('extract-id');
const extractCenter = document.getElementById('extract-center');
const btnExtract = document.getElementById('btn-extract');
const extractStatus = document.getElementById('extract-status');

const kindInput = document.getElementById('kind');
const massInput = document.getElementById('mass');
const restitutionInput = document.getElementById('restitution');
const frictionInput = document.getElementById('friction');
const shapeInput = document.getElementById('shape');
const radiusInput = document.getElementById('radius');
const rowRadius = document.getElementById('row-radius');
const rowHalf = document.getElementById('row-half');
const rowOffset = document.getElementById('row-offset');
const colliderState = document.getElementById('collider-state');
const hx = document.getElementById('hx');
const hy = document.getElementById('hy');
const hz = document.getElementById('hz');
const ox = document.getElementById('ox');
const oy = document.getElementById('oy');
const oz = document.getElementById('oz');
const fitDetail = document.getElementById('fit-detail');
const fitDetailValue = document.getElementById('fit-detail-value');
const fitMode = document.getElementById('fit-mode');
const fitLimitLabel = document.getElementById('fit-limit-label');
const fitMax = document.getElementById('fit-max');
const fitStats = document.getElementById('fit-stats');
const btnFit = document.getElementById('btn-fit');
const btnFitSphere = document.getElementById('btn-fit-sphere');
const btnSimplify = document.getElementById('btn-simplify');
const btnClear = document.getElementById('btn-clear');

const compoundPanel = document.getElementById('compound-panel');
const compoundCount = document.getElementById('compound-count');
const partsList = document.getElementById('parts-list');
const btnAddBox = document.getElementById('btn-add-box');
const btnAddSphere = document.getElementById('btn-add-sphere');

const partEditor = document.getElementById('part-editor');
const partTitle = document.getElementById('part-title');
const btnDuplicate = document.getElementById('btn-duplicate');
const btnMirror = document.getElementById('btn-mirror');
const btnDelete = document.getElementById('btn-delete');
const partX = document.getElementById('part-x');
const partY = document.getElementById('part-y');
const partZ = document.getElementById('part-z');
const partHx = document.getElementById('part-hx');
const partHy = document.getElementById('part-hy');
const partHz = document.getElementById('part-hz');
const partRadius = document.getElementById('part-radius');
const rowPartHalf = document.getElementById('row-part-half');
const rowPartRadius = document.getElementById('row-part-radius');

const canvas = document.getElementById('preview');

const state = {
  id: null,
  info: null,
  dirty: false,
  saving: false,
  parts: [],
  selected: -1,
  fitStats: null,
  history: [],
  redo: [],
  assets: [],
  modelManifest: null,
  modelParts: [],
  hiddenGroups: new Set()
};

/* ----------------------------- Предпросмотр ------------------------------- */

const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
const meshProgram = gl ? createProgram(gl, meshVS, meshFS) : null;
const meshLoc = meshProgram ? {
  u: meshProgram.uniforms,
  a: {
    position: gl.getAttribLocation(meshProgram.program, 'aPosition'),
    normal: gl.getAttribLocation(meshProgram.program, 'aNormal'),
    uv: gl.getAttribLocation(meshProgram.program, 'aUv')
  }
} : null;

const LINE_VS = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uViewProj;
varying vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;
const LINE_FS = `
precision mediump float;
varying vec3 vColor;
uniform float uAlpha;
void main() {
  gl_FragColor = vec4(vColor, uAlpha);
}`;

const lineProgram = gl ? createProgram(gl, LINE_VS, LINE_FS) : null;
const lineLoc = lineProgram ? {
  u: lineProgram.uniforms,
  aPos: gl.getAttribLocation(lineProgram.program, 'aPos'),
  aColor: gl.getAttribLocation(lineProgram.program, 'aColor')
} : null;
const lineBuffer = gl ? gl.createBuffer() : null;
let lineCapacity = 0;

const view = { angle: 0.6, pitch: -0.18, zoom: 1, dragging: false, x: 0, y: 0, moved: 0 };
let model = null;
let modelCenter = [0, 0, 0];
let modelRadius = 5;
let lastView = null;

const GREEN = [0.4, 1.0, 0.55];
const AMBER = [1.0, 0.72, 0.25];
const AMBER_HOT = [1.0, 0.86, 0.5];

function number(value, fallback = 0) {
  if (value === '' || value === null || value === undefined) return fallback;
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function round(value, digits = 2) {
  const k = 10 ** digits;
  return Math.round((Number(value) || 0) * k) / k;
}

/**
 * Смещение простого коллайдера (сфера/бокс) в локальных осях модели.
 * @returns {number[]}
 */
function simpleOffset() {
  return [ox, oy, oz].map((input) => number(input.value, 0));
}

async function loadPreview(id) {
  if (!gl) return;

  model = null;
  modelCenter = [0, 0, 0];
  modelRadius = 5;

  try {
    const loaded = await loadBinaryModel(gl, `models/${id}.json`, `models/${id}.mesh.bin`, id, { triangles: true });
    if (!loaded) return;

    model = loaded;
    const bounds = loaded.bounds;
    if (bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
      modelCenter = [0, 1, 2].map((i) => (bounds.min[i] + bounds.max[i]) / 2);
      modelRadius = Math.max(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2]
      ) / 2 || 5;
    }
  } catch (err) {
    console.warn('[preview]', err);
    model = null;
  }
}

function drawMeshPart(part, matrix) {
  const u = meshLoc.u;
  const a = meshLoc.a;

  gl.uniformMatrix4fv(u.uModel, false, matrix);
  gl.uniformMatrix3fv(u.uNormalMat, false, M4.normalMatrix(matrix));
  gl.uniform3fv(u.uColor, part.color);
  gl.uniform3fv(u.uTint, part.tint || [1, 1, 1]);
  gl.uniform3fv(u.uEmissive, part.emissive);
  gl.uniform1f(u.uSpecular, part.specular ?? 1);
  gl.uniform1f(u.uMetal, part.metal ?? 0);
  gl.uniform1f(u.uRoughness, 1);
  gl.uniform1f(u.uTextureColor, part.textureColor ? 1 : 0);
  gl.uniform3fv(u.uLightDir, [0.35, 0.55, 0.76]);

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

function pushBox(vertices, part, color) {
  pushWireBoxCorners(vertices, boxCorners(part), color);
}

function colliderLines() {
  const green = [];
  const amber = [];
  const shape = shapeInput.value;

  if (shape === 'sphere') {
    pushWireSphere(green, simpleOffset(), Math.max(0.01, number(radiusInput.value, 2)), GREEN);
    return { green, amber };
  }

  if (shape === 'box') {
    const half = [hx, hy, hz].map((input) => Math.max(0.01, Math.abs(number(input.value, 1))));
    pushBox(green, { offset: simpleOffset(), halfExtents: half }, GREEN);
    return { green, amber };
  }

  for (let index = 0; index < state.parts.length; index++) {
    const part = state.parts[index];
    const target = index === state.selected ? amber : green;

    if (part.kind === 'sphere') {
      pushWireSphere(target, part.offset, Math.max(0.01, part.radius), index === state.selected ? AMBER : GREEN);
    } else {
      pushBox(target, part, index === state.selected ? AMBER : GREEN);
    }
  }

  // Крестик в центре выбранной части — видно даже внутри меша.
  const selected = state.parts[state.selected];
  if (selected) {
    const size = selected.kind === 'sphere'
      ? selected.radius
      : Math.min(selected.halfExtents[0], selected.halfExtents[1], selected.halfExtents[2]);
    const arm = Math.max(0.05, size * 0.6);
    const [cx, cy, cz] = selected.offset;

    pushLine(amber, [cx - arm, cy, cz], [cx + arm, cy, cz], AMBER_HOT);
    pushLine(amber, [cx, cy - arm, cz], [cx, cy + arm, cz], AMBER_HOT);
    pushLine(amber, [cx, cy, cz - arm], [cx, cy, cz + arm], AMBER_HOT);
  }

  return { green, amber };
}

function drawLines(vertices, matrix, viewProj, alpha = 1) {
  if (!vertices.length) return;

  const data = new Float32Array(vertices);
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  if (data.byteLength > lineCapacity) {
    lineCapacity = data.byteLength * 2;
    gl.bufferData(gl.ARRAY_BUFFER, lineCapacity, gl.DYNAMIC_DRAW);
  }
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);

  gl.useProgram(lineProgram.program);
  gl.uniformMatrix4fv(lineLoc.u.uViewProj, false, viewProj);
  gl.uniform1f(lineLoc.u.uAlpha, alpha);

  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuffer);
  gl.enableVertexAttribArray(lineLoc.aPos);
  gl.vertexAttribPointer(lineLoc.aPos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(lineLoc.aColor);
  gl.vertexAttribPointer(lineLoc.aColor, 3, gl.FLOAT, false, 24, 12);

  gl.drawArrays(gl.LINES, 0, vertices.length / 6);
}

function drawPreview() {
  if (!gl) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, width, height);
  gl.clearColor(0.02, 0.035, 0.06, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  if (!model) {
    requestAnimationFrame(drawPreview);
    return;
  }

  const dist = (modelRadius * 3.0) / Math.max(0.4, view.zoom);
  const eye = [
    Math.sin(view.angle) * Math.cos(view.pitch) * dist,
    Math.sin(view.pitch) * dist,
    Math.cos(view.angle) * Math.cos(view.pitch) * dist
  ];
  const proj = M4.perspective((45 * Math.PI) / 180, width / height, 0.05, 20000);
  const viewMatrix = M4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const viewProj = M4.mul(proj, viewMatrix);

  lastView = { eye, viewProj };

  // Модель стоит в начале координат: сдвигаем её центр в ноль, камера облетает
  const modelMatrix = M4.translation(-modelCenter[0], -modelCenter[1], -modelCenter[2]);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(meshProgram.program);
  gl.uniformMatrix4fv(meshLoc.u.uViewProj, false, viewProj);
  gl.uniform3fv(meshLoc.u.uCamera, eye);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(meshLoc.u.uAlbedoMap, 0);
  gl.uniform1i(meshLoc.u.uRoughMap, 1);
  gl.uniform1i(meshLoc.u.uMetalMap, 2);
  gl.uniform1i(meshLoc.u.uEmissiveMap, 3);

  // Скрытые части не рисуем: галочки в дереве частей
  model.parts.forEach((part, index) => {
    if (state.hiddenGroups.has(index)) return;
    drawMeshPart(part, modelMatrix);
  });

  // Зелёные боксы — полупрозрачным каркасом поверх корпуса: так видно весь
  // коллайдер, а не только рёбра, торчащие из меша. Выбранный — ярко.
  const lines = colliderLines();
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  drawLines(lines.green, modelMatrix, viewProj, shapeInput.value === 'compound' ? 0.4 : 0.95);
  drawLines(lines.amber, modelMatrix, viewProj, 1);
  gl.disable(gl.BLEND);
  gl.enable(gl.DEPTH_TEST);

  requestAnimationFrame(drawPreview);
}

/* ------------------------------- Луч и выбор ------------------------------ */

function unproject(matrix, x, y, z) {
  const px = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const py = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const pz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const pw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (Math.abs(pw) < 1e-9) return null;
  return [px / pw, py / pw, pz / pw];
}

function screenRay(clientX, clientY) {
  if (!lastView) return null;

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;

  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
  const inverse = M4.invert(lastView.viewProj);
  if (!inverse) return null;

  const near = unproject(inverse, ndcX, ndcY, -1);
  const far = unproject(inverse, ndcX, ndcY, 1);
  if (!near || !far) return null;

  const dx = far[0] - near[0];
  const dy = far[1] - near[1];
  const dz = far[2] - near[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) return null;

  return {
    // near/far — в системе предпросмотра (модель сдвинута в ноль).
    origin: near,
    originModel: [near[0] + modelCenter[0], near[1] + modelCenter[1], near[2] + modelCenter[2]],
    direction: [dx / length, dy / length, dz / length]
  };
}

function pickAt(clientX, clientY) {
  if (shapeInput.value !== 'compound' || !state.parts.length) return -1;
  const ray = screenRay(clientX, clientY);
  if (!ray) return -1;
  return pickPart(ray.originModel, ray.direction, state.parts);
}

if (canvas) {
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;

    view.moved = 0;
    view.x = event.clientX;
    view.y = event.clientY;

    const hit = pickAt(event.clientX, event.clientY);

    if (hit >= 0) {
      selectPart(hit);
    }

    view.dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
  });

  window.addEventListener('pointermove', (event) => {
    if (!view.dragging) return;

    const dx = event.clientX - view.x;
    const dy = event.clientY - view.y;
    view.x = event.clientX;
    view.y = event.clientY;
    view.moved += Math.abs(dx) + Math.abs(dy);
    view.angle -= dx * 0.008;
    view.pitch = Math.max(-1.1, Math.min(1.1, view.pitch + dy * 0.006));
  });

  window.addEventListener('pointerup', (event) => {
    if (view.dragging && view.moved < 4 && shapeInput.value === 'compound') {
      const hit = pickAt(event.clientX, event.clientY);
      if (hit !== state.selected) selectPart(hit);
    }

    view.dragging = false;
  });

  canvas.addEventListener('dblclick', (event) => {
    if (shapeInput.value !== 'compound' || !model || !model.triangles) return;

    const ray = screenRay(event.clientX, event.clientY);
    if (!ray) return;

    const t = raycastMesh(ray.originModel, ray.direction, model.triangles);
    if (t == null) return;

    const point = [
      ray.originModel[0] + ray.direction[0] * t,
      ray.originModel[1] + ray.direction[1] * t,
      ray.originModel[2] + ray.direction[2] * t
    ];

    addBox(point);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    view.zoom = Math.max(0.4, Math.min(4, view.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
  }, { passive: false });

  drawPreview();
}

/* --------------------------------- Форма ---------------------------------- */

function setStatus(text, dirty = false) {
  saveState.textContent = text;
  saveState.className = `save-state ${dirty ? 'dirty' : 'saved'}`;
}

function markDirty() {
  state.dirty = true;
  setStatus('● не сохранено', true);
}

function meters(value, digits = 2) {
  return `${round(value, digits)} м`;
}

function renderSummary(info) {
  const bounds = info.bounds;
  const size = Array.isArray(info.size) ? info.size : null;

  const sizeMeters = size ? size.map((value) => round(value)).join(' × ') : '—';
  const sizeCm = size
    ? size.map((value) => Math.round((Number(value) || 0) * 100)).join(' × ')
    : null;

  const lines = [
    ['модель', info.id],
    ['название', info.name],
    ['габариты', sizeCm ? `${sizeMeters} м (${sizeCm} см)` : '—'],
    ['групп', String(info.groups || 0)],
    ['bounds min', bounds ? `${bounds.min.map((v) => meters(v)).join(', ')}` : '—'],
    ['bounds max', bounds ? `${bounds.max.map((v) => meters(v)).join(', ')}` : '—']
  ];

  summaryEl.innerHTML = lines
    .map(([label, value]) => `<div class="line"><span>${label}</span><span>${value}</span></div>`)
    .join('');
}

function countParts() {
  let boxes = 0;
  let spheres = 0;
  for (const part of state.parts) {
    if (part.kind === 'sphere') spheres++;
    else boxes++;
  }
  return { boxes, spheres };
}

function updateColliderState(note = '') {
  if (!colliderState) return;

  const shape = shapeInput.value;
  let kind = shape;

  if (shape === 'compound') {
    const { boxes, spheres } = countParts();
    const parts = [];
    if (boxes) parts.push(`${boxes} боксов`);
    if (spheres) parts.push(`${spheres} сфер`);
    kind = `compound · ${parts.length ? parts.join(' + ') : 'пусто'}`;
  }

  const text = [`модель ${state.id || '—'}`, kind];
  if (note) text.push(note);

  colliderState.textContent = text.join(' · ');
  colliderState.className = `collider-state ${note.includes('ошибка') ? 'warn' : 'ok'}`;

  renderFitStats();
}

function renderFitStats() {
  if (!fitStats) return;

  const stats = state.fitStats;
  if (!stats) {
    fitStats.textContent = '—';
    return;
  }

  const boxes = Number(stats.boxes) || 0;
  const spheres = Number(stats.spheres) || 0;
  const parts = Number.isFinite(stats.parts) ? stats.parts : boxes + spheres;

  fitStats.textContent = [
    `режим ${stats.mode || 'boxes'}`,
    `сетка ${stats.grid.join(' × ')}`,
    `ячейка ${round(stats.cell, 2)} м`,
    `частей ${parts}`,
    boxes ? `боксов ${boxes}` : null,
    spheres ? `сфер ${spheres}` : null,
    `заполнение ${Math.round((stats.fill || 0) * 100)}%`,
    stats.passes ? `огрублений ${stats.passes}` : null
  ].filter(Boolean).join(' · ');
}

/* ------------------------------- История ---------------------------------- */

function snapshot() {
  return JSON.stringify({
    parts: state.parts,
    selected: state.selected,
    shape: shapeInput.value
  });
}

function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 60) state.history.shift();
  state.redo.length = 0;
}

function applySnapshot(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }

  state.parts = Array.isArray(data.parts) ? data.parts : [];
  state.selected = Number.isInteger(data.selected) ? data.selected : -1;
  if (state.selected >= state.parts.length) state.selected = state.parts.length - 1;

  if (['sphere', 'box', 'compound'].includes(data.shape)) shapeInput.value = data.shape;

  syncVisibility();
  renderParts();
  syncPartEditor();
  markDirty();
}

function undo() {
  if (!state.history.length) return;
  state.redo.push(snapshot());
  applySnapshot(state.history.pop());
}

function redo() {
  if (!state.redo.length) return;
  state.history.push(snapshot());
  applySnapshot(state.redo.pop());
}

/* ----------------------------- Список частей ------------------------------ */

function partSize(part) {
  return part.kind === 'sphere'
    ? `⌀ ${round(part.radius * 2)}`
    : part.halfExtents.map((value) => round(value * 2)).join(' × ');
}

function renderParts() {
  const { boxes, spheres } = countParts();
  compoundCount.textContent = `${boxes} боксов · ${spheres} сфер`;

  if (!state.parts.length) {
    partsList.innerHTML = '<p class="parts-empty">пусто — добавьте бокс или постройте по модели</p>';
    return;
  }

  partsList.innerHTML = state.parts.map((part, index) => {
    const active = index === state.selected ? ' active' : '';
    const icon = part.kind === 'sphere' ? '●' : '▭';
    const name = part.kind === 'sphere' ? 'сфера' : 'бокс';
    return `<button type="button" class="part${active}" data-part="${index}" role="option" aria-selected="${index === state.selected}">`
      + `<span class="part-ico">${icon}</span>`
      + `<span class="part-name">${name} ${index + 1}</span>`
      + `<span class="part-size">${partSize(part)}</span>`
      + '</button>';
  }).join('');
}

function currentPart() {
  return state.parts[state.selected] || null;
}

function selectPart(index) {
  state.selected = Number.isInteger(index) && index >= 0 && index < state.parts.length ? index : -1;
  renderParts();
  syncPartEditor();

  const row = partsList.querySelector(`[data-part="${state.selected}"]`);
  row?.scrollIntoView({ block: 'nearest' });
}

function syncPartInputs() {
  const part = currentPart();
  if (!part) return;

  partX.value = String(round(part.offset[0], 3));
  partY.value = String(round(part.offset[1], 3));
  partZ.value = String(round(part.offset[2], 3));

  if (part.kind === 'sphere') {
    partRadius.value = String(round(part.radius, 3));
  } else {
    partHx.value = String(round(part.halfExtents[0], 3));
    partHy.value = String(round(part.halfExtents[1], 3));
    partHz.value = String(round(part.halfExtents[2], 3));
  }
}

function syncPartEditor() {
  const part = currentPart();

  partEditor.hidden = !part;
  if (!part) return;

  partTitle.textContent = `${part.kind === 'sphere' ? 'сфера' : 'бокс'} ${state.selected + 1}`;
  rowPartHalf.hidden = part.kind !== 'box';
  rowPartRadius.hidden = part.kind !== 'sphere';
  syncPartInputs();
}

function defaultCenter() {
  const bounds = state.info?.bounds;
  if (!bounds) return [0, 0, 0];
  return [0, 1, 2].map((axis) => round((bounds.min[axis] + bounds.max[axis]) / 2, 3));
}

function defaultHalf() {
  const size = state.info?.size;
  const maxDim = Array.isArray(size) && size.length === 3 ? Math.max(...size) : 10;
  const half = Math.max(0.15, maxDim / 40);
  return [half, half, half];
}

function addBox(point = defaultCenter()) {
  if (countParts().boxes >= 32) {
    setStatus('движок принимает не больше 32 боксов', true);
    return;
  }

  pushHistory();

  state.parts.push({
    kind: 'box',
    offset: point.map((value) => round(value, 3)),
    halfExtents: defaultHalf()
  });
  state.selected = state.parts.length - 1;

  if (shapeInput.value !== 'compound') shapeInput.value = 'compound';
  syncVisibility();
  renderParts();
  syncPartEditor();
  markDirty();
}

function addSphere(point = defaultCenter()) {
  if (countParts().spheres >= 32) {
    setStatus('движок принимает не больше 32 сфер', true);
    return;
  }

  pushHistory();

  const size = state.info?.size;
  const maxDim = Array.isArray(size) && size.length === 3 ? Math.max(...size) : 10;

  state.parts.push({
    kind: 'sphere',
    offset: point.map((value) => round(value, 3)),
    radius: round(Math.max(0.15, maxDim / 24), 3)
  });
  state.selected = state.parts.length - 1;

  if (shapeInput.value !== 'compound') shapeInput.value = 'compound';
  syncVisibility();
  renderParts();
  syncPartEditor();
  markDirty();
}

function deleteSelected() {
  if (!currentPart()) return;

  pushHistory();
  state.parts.splice(state.selected, 1);
  state.selected = Math.min(state.selected, state.parts.length - 1);

  renderParts();
  syncPartEditor();
  markDirty();
}

function duplicateSelected() {
  const part = currentPart();
  if (!part) return;

  if (part.kind === 'sphere' && countParts().spheres >= 32) {
    setStatus('движок принимает не больше 32 сфер', true);
    return;
  }

  if (part.kind === 'box' && countParts().boxes >= 32) {
    setStatus('движок принимает не больше 32 боксов', true);
    return;
  }

  pushHistory();
  const copy = part.kind === 'sphere'
    ? { kind: 'sphere', offset: part.offset.slice(), radius: part.radius }
    : { kind: 'box', offset: part.offset.slice(), halfExtents: part.halfExtents.slice() };

  const shift = part.kind === 'sphere' ? part.radius * 2 + 0.1 : part.halfExtents[0] * 2 + 0.1;
  copy.offset[0] = round(copy.offset[0] + shift, 3);

  state.parts.push(copy);
  state.selected = state.parts.length - 1;

  renderParts();
  syncPartEditor();
  markDirty();
}

function mirrorSelected() {
  const part = currentPart();
  if (!part) return;

  if (part.kind === 'sphere' && countParts().spheres >= 32) {
    setStatus('движок принимает не больше 32 сфер', true);
    return;
  }

  if (part.kind === 'box' && countParts().boxes >= 32) {
    setStatus('движок принимает не больше 32 боксов', true);
    return;
  }

  pushHistory();
  const cx = defaultCenter()[0];
  const copy = part.kind === 'sphere'
    ? { kind: 'sphere', offset: part.offset.slice(), radius: part.radius }
    : { kind: 'box', offset: part.offset.slice(), halfExtents: part.halfExtents.slice() };

  copy.offset[0] = round(cx * 2 - part.offset[0], 3);

  state.parts.push(copy);
  state.selected = state.parts.length - 1;

  renderParts();
  syncPartEditor();
  markDirty();
}

/* ------------------------------ Автоколлайдер ----------------------------- */

// Даём браузеру перерисовать статус до тяжёлого расчёта. setTimeout, а не
// requestAnimationFrame: в фоновой вкладке rAF может не вызываться вовсе.
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 16));

async function fitColliderAsync() {
  if (!model || !model.triangles || !model.triangles.length) {
    setStatus('у модели нет треугольников для расчёта', true);
    return;
  }

  if (state.parts.length) {
    const { boxes, spheres } = countParts();
    const what = [boxes ? `${boxes} боксов` : '', spheres ? `${spheres} сфер` : ''].filter(Boolean).join(' + ');
    if (!confirm(`Заменить текущий коллайдер (${what}) новым разбиением по мешу?`)) return;
  }

  pushHistory();

  const detail = Math.max(8, Math.min(48, Math.round(number(fitDetail.value, 24))));
  const limit = Math.max(1, Math.min(32, Math.round(number(fitMax.value, 32))));
  const mode = ['boxes', 'spheres', 'hybrid'].includes(fitMode.value) ? fitMode.value : 'boxes';

  setStatus('расчёт коллайдера…');
  await nextFrame();

  let result;
  try {
    if (mode === 'spheres') {
      result = buildSphereCollider(model.triangles, { detail, maxSpheres: limit, margin: 0.2 });
    } else if (mode === 'hybrid') {
      result = buildCompoundCollider(model.triangles, { mode: 'hybrid', maxParts: limit, detail, margin: 0.25 });
    } else {
      result = buildBoxCollider(model.triangles, { detail, maxBoxes: limit, margin: 0.35 });
    }
  } catch (err) {
    setStatus(`ошибка расчёта: ${err.message}`, true);
    return;
  }

  const boxes = Array.isArray(result.boxes) ? result.boxes : [];
  const spheres = Array.isArray(result.spheres) ? result.spheres : [];

  if (!boxes.length && !spheres.length) {
    setStatus('не получилось разложить модель на части', true);
    return;
  }

  state.parts = [
    ...boxes.map((box) => ({
      kind: 'box',
      offset: box.offset,
      halfExtents: box.halfExtents
    })),
    ...spheres.map((sphere) => ({
      kind: 'sphere',
      offset: sphere.offset,
      radius: sphere.radius
    }))
  ];
  state.selected = -1;
  state.fitStats = { ...result.stats, mode, boxes: boxes.length, spheres: spheres.length, parts: state.parts.length };

  shapeInput.value = 'compound';
  syncVisibility();
  renderParts();
  syncPartEditor();
  markDirty();

  const saved = await save();
  if (saved) {
    updateColliderState(`сохранён ${new Date().toLocaleTimeString('ru-RU', { hour12: false })}`);
    const summary = [`${state.parts.length} частей`];
    if (boxes.length) summary.push(`${boxes.length} боксов`);
    if (spheres.length) summary.push(`${spheres.length} сфер`);
    setStatus(`коллайдер построен: ${summary.join(', ')}`);
  }
}

async function simplifyCollider() {
  const boxes = state.parts.filter((part) => part.kind === 'box');
  if (!boxes.length) {
    setStatus('в коллайдере нет боксов', true);
    return;
  }

  const limit = Math.max(1, Math.min(32, Math.round(number(fitMax.value, 32))));
  if (boxes.length <= limit) {
    setStatus(`боксов уже ${boxes.length} — упрощать нечего`);
    return;
  }

  pushHistory();
  const simplified = simplifyBoxes(boxes, limit);
  const spheres = state.parts.filter((part) => part.kind === 'sphere');

  state.parts = [
    ...spheres,
    ...simplified.map((box) => ({ kind: 'box', offset: box.offset, halfExtents: box.halfExtents }))
  ];
  state.selected = -1;
  state.fitStats = null;

  renderParts();
  syncPartEditor();
  markDirty();

  const saved = await save();
  if (saved) setStatus(`упрощено до ${simplified.length} боксов`);
}

function clearCollider() {
  if (!state.parts.length) return;
  if (!confirm(`Удалить все части коллайдера (${state.parts.length})?`)) return;

  pushHistory();
  state.parts = [];
  state.selected = -1;
  state.fitStats = null;

  renderParts();
  syncPartEditor();
  markDirty();
}

async function fitSingleSphere() {
  if (!model || !model.bounds) return;

  const bounds = model.bounds;
  const size = [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  ];
  const radius = Math.max(size[0], size[1], size[2]) / 2;

  pushHistory();
  shapeInput.value = 'sphere';
  radiusInput.value = String(round(radius, 2));
  ox.value = '0';
  oy.value = '0';
  oz.value = '0';
  syncVisibility();
  markDirty();

  const saved = await save();
  if (saved) updateColliderState(`сохранён ${new Date().toLocaleTimeString('ru-RU', { hour12: false })}`);
}

function parsePart(part) {
  if (part.kind === 'sphere') {
    return {
      offset: part.offset.map((value) => number(value, 0)),
      radius: Math.max(0.01, number(part.radius, 1))
    };
  }

  return {
    offset: part.offset.map((value) => number(value, 0)),
    halfExtents: part.halfExtents.map((value) => Math.max(0.01, number(value, 1)))
  };
}

function applyPhysics(physics) {
  const collider = physics.collider || {};
  const kind = physics.kind === 'dynamic' ? 'dynamic' : 'static';

  kindInput.value = kind;
  massInput.value = physics.mass || 12;
  restitutionInput.value = physics.restitution ?? 0.55;
  frictionInput.value = physics.friction ?? 0.2;
  shapeInput.value = ['box', 'compound'].includes(collider.shape) ? collider.shape : 'sphere';
  radiusInput.value = collider.radius ?? 2;

  const half = Array.isArray(collider.halfExtents) ? collider.halfExtents : [1, 1, 1];
  hx.value = half[0];
  hy.value = half[1];
  hz.value = half[2];

  const offset = Array.isArray(collider.offset) ? collider.offset : [0, 0, 0];
  ox.value = offset[0] ?? 0;
  oy.value = offset[1] ?? 0;
  oz.value = offset[2] ?? 0;

  state.parts = [];
  state.selected = -1;
  state.fitStats = null;
  state.history.length = 0;
  state.redo.length = 0;

  for (const sphere of collider.spheres || []) {
    state.parts.push({
      kind: 'sphere',
      offset: Array.isArray(sphere.offset) ? sphere.offset.slice(0, 3) : [0, 0, 0],
      radius: Math.max(0.01, Number(sphere.radius) || 1)
    });
  }

  for (const box of collider.boxes || []) {
    state.parts.push({
      kind: 'box',
      offset: Array.isArray(box.offset) ? box.offset.slice(0, 3) : [0, 0, 0],
      halfExtents: Array.isArray(box.halfExtents) ? box.halfExtents.slice(0, 3) : [1, 1, 1]
    });
  }

  if (state.parts.length) state.selected = 0;

  syncVisibility();
  renderParts();
  syncPartEditor();
  updateColliderState('загружен');
}

function syncVisibility() {
  const dynamic = kindInput.value === 'dynamic';
  massInput.disabled = !dynamic;

  const shape = shapeInput.value;
  rowRadius.hidden = shape !== 'sphere';
  rowHalf.hidden = shape !== 'box';
  rowOffset.hidden = shape === 'compound';
  compoundPanel.hidden = shape !== 'compound';

  updateColliderState();
}

/* ------------------------------ Импорт/сохранение ------------------------- */

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
    console.warn('[reimport] текстура не сжата:', err.message);
    return bytesToBase64(bytes);
  }
}

/** Заменить меш модели из GLB, сохранив id и физику. */
async function reimport(file) {
  if (!state.id || !file) return;

  if (state.dirty && !confirm('Несохранённые изменения физики будут потеряны. Продолжить?')) return;

  if (!confirm(`Заменить модель «${state.id}» мешем из «${file.name}»?\nСцены, использующие её, обновятся сразу.`)) return;

  setStatus('импорт…');

  try {
    const parsed = parseGlb(await file.arrayBuffer());
    const { manifest, bin, textures } = packAsset(parsed, {
      name: file.name.replace(/\.glb$/i, '') || state.info?.name || state.id
    });

    const textureSets = [];
    for (const [index, texture] of (textures || []).entries()) {
      textureSets.push({
        name: index === 0 ? state.id : `${state.id}-${index + 1}`,
        base64: await shrinkTexture(texture.bytes, texture.mime)
      });
    }

    for (const group of manifest.groups || []) {
      if (!group.texture) continue;
      const index = (textures || []).findIndex((texture) => texture.name === group.texture);
      if (index >= 0) group.texture = index === 0 ? state.id : `${state.id}-${index + 1}`;
    }

    const response = await fetch(`/api/asset/${encodeURIComponent(state.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest, binBase64: bytesToBase64(bin), textures: textureSets })
    });

    if (!response.ok) throw new Error(await response.text());

    await loadModel(state.id);
    setStatus(`модель заменена: частей ${manifest.groups.length}, текстур ${textureSets.length} · проверьте коллайдер`, true);
  } catch (err) {
    setStatus(`ошибка импорта: ${err.message}`, true);
  }
}

async function loadModel(id) {
  state.id = id;
  state.dirty = false;
  setStatus('загрузка…');

  try {
    const info = await fetch(`/api/model/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`модель ${id} не найдена`);
        return response.json();
      });

    state.info = info;
    renderSummary(info);
    applyPhysics(info.physics || {});
    await loadModelManifest(id);
    await loadPreview(id);

    setStatus('без изменений');
    document.title = `Модель ${info.name || id} — GalaxyDemo`;
    history.replaceState(null, '', `?model=${encodeURIComponent(id)}`);
  } catch (err) {
    summaryEl.innerHTML = `<div class="line"><span>ошибка</span><span>${err.message}</span></div>`;
    setStatus('ошибка', true);
  }
}

async function loadModels() {
  const data = await fetch('/api/assets', { cache: 'no-store' })
    .then((response) => response.json())
    .catch(() => ({ assets: [] }));

  const assets = Array.isArray(data.assets) ? data.assets : [];
  state.assets = assets;
  modelSelect.innerHTML = assets.map((id) => `<option value="${id}">${id}</option>`).join('');

  const requested = new URLSearchParams(location.search).get('model');
  const id = assets.includes(requested) ? requested : assets[0];
  if (!id) throw new Error('в public/models нет ни одного ассета');

  modelSelect.value = id;
  await loadModel(id);
}

/* ----------------------------- Части модели ------------------------------- */

function escapeHtml(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(value ?? '').replace(/[&<>"]/g, (ch) => map[ch]);
}

function suggestId(id) {
  const slug = String(id || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'model'}-part`;
}

async function loadModelManifest(id) {
  state.modelManifest = null;
  state.modelParts = [];
  state.hiddenGroups = new Set();

  try {
    const response = await fetch(`models/${encodeURIComponent(id)}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`манифест ${id} не найден`);

    state.modelManifest = await response.json();
    state.modelParts = listObjects(state.modelManifest);
    extractId.value = suggestId(id);
    extractStatus.textContent = '—';
    renderModelParts();
  } catch (err) {
    partsTree.innerHTML = '<p class="hint-inline">части не загружены</p>';
    partsTotal.textContent = '—';
    extractStatus.textContent = `части недоступны: ${err.message}`;
  }
}

function renderModelParts() {
  const groups = state.modelManifest?.groups || [];
  if (!state.modelManifest) return;

  if (!groups.length) {
    partsTree.innerHTML = '<p class="hint-inline">в модели нет групп</p>';
    partsTotal.textContent = '—';
    return;
  }

  partsTree.innerHTML = state.modelParts.map((part, objectIndex) => {
    const visible = part.indices.filter((index) => !state.hiddenGroups.has(index)).length;
    const rows = part.indices.map((index) => {
      const group = groups[index];
      return `<label class="parts-group"><input type="checkbox" data-group="${index}"${state.hiddenGroups.has(index) ? '' : ' checked'}><span>${escapeHtml(group.name)}</span><em>${Math.round((group.indexCount || 0) / 3)} тр.</em></label>`;
    }).join('');

    return `<label class="parts-object"><input type="checkbox" data-object="${objectIndex}"${visible ? ' checked' : ''}><span>${escapeHtml(part.name)}</span><em>${part.triangles} тр.</em></label>${rows}`;
  }).join('');

  syncModelPartChecks();
}

/** Согласовать галочки объектов и групп после изменения выбора. */
function syncModelPartChecks() {
  for (const input of partsTree.querySelectorAll('input[data-group]')) {
    input.checked = !state.hiddenGroups.has(Number(input.dataset.group));
  }

  for (const input of partsTree.querySelectorAll('input[data-object]')) {
    const part = state.modelParts[Number(input.dataset.object)];
    if (!part) continue;

    const visible = part.indices.filter((index) => !state.hiddenGroups.has(index)).length;
    input.checked = visible > 0;
    input.indeterminate = visible > 0 && visible < part.indices.length;
  }

  updateModelPartsTotal();
}

function updateModelPartsTotal() {
  const groups = state.modelManifest?.groups || [];
  let visible = 0;
  let triangles = 0;

  for (const [index, group] of groups.entries()) {
    if (state.hiddenGroups.has(index)) continue;
    visible += 1;
    triangles += Math.round((group.indexCount || 0) / 3);
  }

  partsTotal.textContent = `${visible} из ${groups.length} частей · ${triangles} тр.`;
}

async function extractSelected() {
  if (!state.id || !state.modelManifest) {
    extractStatus.textContent = 'модель не загружена';
    return;
  }

  const indices = (state.modelManifest.groups || [])
    .map((_, index) => index)
    .filter((index) => !state.hiddenGroups.has(index));

  if (!indices.length) {
    extractStatus.textContent = 'отметьте хотя бы одну часть';
    return;
  }

  const id = extractId.value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    extractStatus.textContent = 'id: латиница, цифры и дефис, начиная с буквы или цифры';
    return;
  }

  if (state.assets.includes(id) && !confirm(`Модель «${id}» уже есть. Заменить её?`)) return;

  btnExtract.disabled = true;
  extractStatus.textContent = 'извлечение…';

  try {
    const buffer = await fetch(`models/${encodeURIComponent(state.id)}.mesh.bin`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('бинарник модели не найден');
        return response.arrayBuffer();
      });

    const result = extractModel(state.modelManifest, buffer, {
      id,
      indices,
      recenter: extractCenter.checked
    });

    const response = await fetch(`/api/asset/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: result.manifest, binBase64: bytesToBase64(result.bin), textures: [] })
    });

    if (!response.ok) throw new Error(await response.text());

    const data = await fetch('/api/assets', { cache: 'no-store' }).then((item) => item.json());
    state.assets = data.assets || [];
    modelSelect.innerHTML = state.assets.map((asset) => `<option value="${asset}">${asset}</option>`).join('');
    modelSelect.value = id;

    await loadModel(id);
    extractStatus.textContent = `готово: ${result.stats.groups} частей, ${Math.round(result.stats.triangles)} тр., ${(result.bin.length / 1024).toFixed(0)} КБ · модель «${id}»`;
  } catch (err) {
    extractStatus.textContent = `ошибка: ${err.message}`;
  } finally {
    btnExtract.disabled = false;
  }
}

partsTree.addEventListener('change', (event) => {
  const group = event.target.closest('input[data-group]');
  if (group) {
    const index = Number(group.dataset.group);
    if (group.checked) state.hiddenGroups.delete(index);
    else state.hiddenGroups.add(index);
    syncModelPartChecks();
    return;
  }

  const object = event.target.closest('input[data-object]');
  if (!object) return;

  const part = state.modelParts[Number(object.dataset.object)];
  if (!part) return;

  for (const index of part.indices) {
    if (object.checked) state.hiddenGroups.delete(index);
    else state.hiddenGroups.add(index);
  }

  renderModelParts();
});

btnPartsAll.addEventListener('click', () => {
  state.hiddenGroups.clear();
  renderModelParts();
});

btnPartsNone.addEventListener('click', () => {
  const groups = state.modelManifest?.groups || [];
  state.hiddenGroups = new Set(groups.map((_, index) => index));
  renderModelParts();
});

btnExtract.addEventListener('click', () => {
  extractSelected().catch((err) => {
    extractStatus.textContent = `ошибка: ${err.message}`;
  });
});

function collectPhysics() {
  const kind = kindInput.value === 'dynamic' ? 'dynamic' : 'static';
  const shape = shapeInput.value;

  let collider;
  if (shape === 'box') {
    collider = {
      shape: 'box',
      offset: simpleOffset(),
      halfExtents: [hx, hy, hz].map((input) => Math.max(0.01, Math.abs(number(input.value, 1))))
    };
  } else if (shape === 'compound') {
    const spheres = [];
    const boxes = [];

    for (const part of state.parts) {
      const parsed = parsePart(part);
      if (part.kind === 'sphere') spheres.push(parsed);
      else boxes.push(parsed);
    }

    collider = { shape: 'compound', spheres, boxes };
  } else {
    collider = {
      shape: 'sphere',
      offset: simpleOffset(),
      radius: Math.max(0.01, number(radiusInput.value, 2))
    };
  }

  return {
    kind,
    mass: kind === 'dynamic' ? Math.max(0.1, number(massInput.value, 12)) : 0,
    restitution: Math.min(1, Math.max(0, number(restitutionInput.value, 0.55))),
    friction: Math.max(0, number(frictionInput.value, 0.2)),
    collider
  };
}

async function save() {
  if (!state.id || state.saving) return false;

  state.saving = true;
  btnSave.disabled = true;
  setStatus('сохранение…');

  try {
    const payload = collectPhysics();

    const response = await fetch(`/api/model/${encodeURIComponent(state.id)}/physics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(await response.text());

    // Проверяем, что сервер действительно записал то, что мы отправили
    const check = await fetch(`/api/model/${encodeURIComponent(state.id)}`, { cache: 'no-store' })
      .then((res) => res.json());
    const saved = check.physics?.collider;

    const sameShape = saved && saved.shape === payload.collider.shape;
    const sameCount = payload.collider.shape !== 'compound'
      || ((Array.isArray(saved?.spheres) ? saved.spheres.length : 0) === payload.collider.spheres.length
        && (Array.isArray(saved?.boxes) ? saved.boxes.length : 0) === payload.collider.boxes.length);

    if (!sameShape || !sameCount) {
      throw new Error('сервер не сохранил коллайдер');
    }

    state.dirty = false;
    setStatus(`сохранено ${new Date().toLocaleTimeString('ru-RU', { hour12: false })}`);
    updateColliderState(`сохранён ${new Date().toLocaleTimeString('ru-RU', { hour12: false })}`);
    return true;
  } catch (err) {
    setStatus(`ошибка: ${err.message}`, true);
    return false;
  } finally {
    state.saving = false;
    btnSave.disabled = false;
  }
}

/* -------------------------------- События --------------------------------- */

const FIT_KEY = 'galaxy.model-editor.fit';

try {
  const saved = JSON.parse(localStorage.getItem(FIT_KEY) || 'null');
  if (saved && Number.isFinite(Number(saved.detail))) {
    fitDetail.value = String(Math.min(48, Math.max(8, Number(saved.detail))));
  }
  if (saved && Number.isFinite(Number(saved.max))) {
    fitMax.value = String(Math.min(32, Math.max(1, Number(saved.max))));
  }
  if (saved && ['boxes', 'spheres', 'hybrid'].includes(saved.mode)) {
    fitMode.value = saved.mode;
  }
} catch {
  // настройки генератора — не критично
}

fitDetailValue.textContent = fitDetail.value;

function syncFitMode() {
  const labels = {
    boxes: 'лимит боксов',
    spheres: 'лимит сфер',
    hybrid: 'лимит частей'
  };
  fitLimitLabel.textContent = labels[fitMode.value] || labels.boxes;
}

function rememberFit() {
  fitDetailValue.textContent = fitDetail.value;
  syncFitMode();
  try {
    localStorage.setItem(FIT_KEY, JSON.stringify({
      detail: fitDetail.value,
      max: fitMax.value,
      mode: fitMode.value
    }));
  } catch {
    // приватный режим — просто не запоминаем
  }
}

kindInput.addEventListener('change', () => {
  syncVisibility();
  markDirty();
});

shapeInput.addEventListener('change', () => {
  if (shapeInput.value === 'compound' && !state.parts.length) {
    pushHistory();
    state.parts.push({ kind: 'box', offset: defaultCenter(), halfExtents: defaultHalf() });
    state.selected = 0;
  }

  syncVisibility();
  renderParts();
  syncPartEditor();
  markDirty();
});

fitDetail.addEventListener('input', rememberFit);
fitMax.addEventListener('input', rememberFit);
fitMode.addEventListener('change', rememberFit);
syncFitMode();

btnFit.addEventListener('click', fitColliderAsync);
btnFitSphere.addEventListener('click', fitSingleSphere);
btnSimplify.addEventListener('click', simplifyCollider);
btnClear.addEventListener('click', clearCollider);

btnAddBox.addEventListener('click', () => addBox());
btnAddSphere.addEventListener('click', () => addSphere());
btnDuplicate.addEventListener('click', duplicateSelected);
btnMirror.addEventListener('click', mirrorSelected);
btnDelete.addEventListener('click', deleteSelected);

partsList.addEventListener('click', (event) => {
  const row = event.target.closest('[data-part]');
  if (!row) return;
  selectPart(Number(row.dataset.part));
});

for (const input of [massInput, restitutionInput, frictionInput, radiusInput, hx, hy, hz, ox, oy, oz]) {
  input.addEventListener('input', markDirty);
}

// Поля выбранной части: один снимок истории на серию правок в поле.
// focus/pointerdown/keydown — на случай, если браузер не пришлёт focus
// (например, окно не в фокусе), но значение уже меняют.
let partEditArmed = false;

function armPartEdit() {
  if (partEditArmed || !currentPart()) return;
  partEditArmed = true;
  pushHistory();
}

for (const input of [partX, partY, partZ, partHx, partHy, partHz, partRadius]) {
  input.addEventListener('focus', armPartEdit);
  input.addEventListener('pointerdown', armPartEdit);
  input.addEventListener('keydown', (event) => {
    if (['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    armPartEdit();
  });
  input.addEventListener('blur', () => {
    partEditArmed = false;
  });
}

[[partX, 0], [partY, 1], [partZ, 2]].forEach(([input, axis]) => {
  input.addEventListener('input', () => {
    const part = currentPart();
    if (!part) return;
    armPartEdit();
    part.offset[axis] = number(input.value, part.offset[axis]);
    markDirty();
    renderParts();
  });
});

[[partHx, 0], [partHy, 1], [partHz, 2]].forEach(([input, axis]) => {
  input.addEventListener('input', () => {
    const part = currentPart();
    if (!part || part.kind !== 'box') return;
    armPartEdit();
    part.halfExtents[axis] = Math.max(0.01, number(input.value, part.halfExtents[axis]));
    markDirty();
    renderParts();
  });
});

partRadius.addEventListener('input', () => {
  const part = currentPart();
  if (!part || part.kind !== 'sphere') return;
  armPartEdit();
  part.radius = Math.max(0.01, number(partRadius.value, part.radius));
  markDirty();
  renderParts();
});

btnSave.addEventListener('click', save);

btnReimport?.addEventListener('click', () => glbInput?.click());

glbInput?.addEventListener('change', () => {
  const file = glbInput.files?.[0];
  glbInput.value = '';
  reimport(file).catch((err) => setStatus(`ошибка импорта: ${err.message}`, true));
});

modelSelect.addEventListener('change', () => {
  if (state.dirty && !confirm('Есть несохранённые изменения. Открыть другую модель?')) {
    modelSelect.value = state.id;
    return;
  }
  loadModel(modelSelect.value).catch((err) => setStatus(err.message, true));
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement
    && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.code === 'KeyS') {
    event.preventDefault();
    save();
    return;
  }

  if (mod && !typing && event.code === 'KeyZ') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }

  if (mod && !typing && event.code === 'KeyY') {
    event.preventDefault();
    redo();
    return;
  }

  if (!typing && !mod && (event.key === 'Delete' || event.key === 'Backspace')) {
    if (state.selected >= 0) {
      event.preventDefault();
      deleteSelected();
    }
    return;
  }

  if (!typing && event.key === 'Escape') {
    selectPart(-1);
  }
});

loadModels().catch((err) => {
  summaryEl.innerHTML = `<div class="line"><span>ошибка</span><span>${err.message}</span></div>`;
  setStatus('ошибка', true);
});
