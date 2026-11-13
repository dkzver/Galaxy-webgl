// Окно материала: предпросмотр сферы и параметры из схемы.
//
// Материал — данные public/materials/<id>.material.json. Здесь его можно
// подкрутить и увидеть результат: шейдер shield рисует оболочку и пятно,
// остальные материалы — обычной программой mesh.

import { createMesh, createProgram } from '../gl.js';
import { sphereGeometry } from '../geometry.js';
import { M4 } from '../math.js';
import { meshVS, meshFS } from '../render/mesh-shader.js';
import { shieldVS, shieldFS } from '../render/shield-shader.js';
import { normalizeMaterial } from '../materials.js';

const canvas = document.getElementById('preview');
const select = document.getElementById('material-select');
const paramsEl = document.getElementById('params');
const statusEl = document.getElementById('status');
const saveState = document.getElementById('save-state');
const btnSave = document.getElementById('btn-save');
const btnTest = document.getElementById('btn-test');

const gl = canvas.getContext('webgl2', { antialias: true })
  || canvas.getContext('webgl', { antialias: true });

if (!gl) {
  statusEl.textContent = 'WebGL недоступен';
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

const shieldProgram = createProgram(gl, shieldVS, shieldFS);
const shieldLoc = {
  u: shieldProgram.uniforms,
  a: {
    position: gl.getAttribLocation(shieldProgram.program, 'aPosition'),
    normal: gl.getAttribLocation(shieldProgram.program, 'aNormal')
  }
};

const geometry = sphereGeometry(2.4, 2.4, 2.4, 36, 24);
const mesh = createMesh(gl, geometry);

const state = {
  id: null,
  material: null,
  uniforms: {},
  hits: [],
  view: { yaw: 0.6, pitch: 0.2, zoom: 1 },
  dragging: false,
  lastX: 0,
  lastY: 0
};

function setStatus(text) {
  statusEl.textContent = text;
}

function markDirty() {
  saveState.textContent = '● не сохранено';
  saveState.classList.add('dirty');
}

function hexToRgb(hex, fallback = [0.6, 0.7, 0.85]) {
  if (typeof hex !== 'string') return fallback.slice();
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-f]{6}$/i.test(full)) return fallback.slice();
  const value = Number.parseInt(full, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/* ------------------------------- Параметры -------------------------------- */

function buildParams() {
  paramsEl.innerHTML = '';

  const params = state.material?.params || {};
  const entries = Object.entries(params);

  if (!entries.length) {
    paramsEl.innerHTML = '<p class="hint-inline">У материала нет схемы параметров.</p>';
    return;
  }

  for (const [key, meta] of entries) {
    const row = document.createElement('label');
    row.className = 'param-row';

    const title = document.createElement('span');
    title.textContent = meta.label || key;
    row.append(title);

    const input = document.createElement('input');
    input.dataset.param = key;

    if (meta.type === 'color') {
      input.type = 'color';
      input.value = state.uniforms[key] || meta.default || '#ffffff';
    } else if (meta.type === 'number') {
      input.type = 'number';
      input.min = String(meta.min ?? '');
      input.max = String(meta.max ?? '');
      input.step = String(meta.step ?? 0.1);
      input.value = String(state.uniforms[key] ?? meta.default ?? 0);
    } else {
      input.type = 'text';
      input.value = String(state.uniforms[key] ?? meta.default ?? '');
    }

    input.addEventListener('input', () => {
      if (meta.type === 'number') {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        const min = Number.isFinite(meta.min) ? meta.min : -Infinity;
        const max = Number.isFinite(meta.max) ? meta.max : Infinity;
        state.uniforms[key] = Math.min(max, Math.max(min, value));
      } else {
        state.uniforms[key] = input.value;
      }
      markDirty();
    });

    row.append(input);
    paramsEl.append(row);
  }
}

/* ------------------------------ Предпросмотр ------------------------------ */

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, width, height);
  return { width, height };
}

function drawMeshSphere() {
  const { width, height } = resize();
  const distance = 7.5 / state.view.zoom;
  const eye = [
    Math.sin(state.view.yaw) * Math.cos(state.view.pitch) * distance,
    Math.sin(state.view.pitch) * distance + 0.4,
    Math.cos(state.view.yaw) * Math.cos(state.view.pitch) * distance
  ];
  const viewProj = M4.mul(
    M4.perspective((45 * Math.PI) / 180, width / height, 0.05, 200),
    M4.lookAt(eye, [0, 0, 0], [0, 1, 0])
  );

  gl.clearColor(0.02, 0.035, 0.06, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);

  if (state.material?.shader === 'shield') {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    gl.useProgram(shieldProgram.program);

    gl.uniformMatrix4fv(shieldLoc.u.uViewProj, false, viewProj);
    gl.uniform3fv(shieldLoc.u.uCamera, eye);
    gl.uniform3fv(shieldLoc.u.uColor, hexToRgb(state.uniforms.color, [0.35, 0.85, 1]));
    gl.uniform3fv(shieldLoc.u.uHitColor, hexToRgb(state.uniforms.hitColor, [0.92, 1, 1]));
    gl.uniform1f(shieldLoc.u.uBase, Number(state.uniforms.base) || 0);
    gl.uniform1f(shieldLoc.u.uFresnel, Number(state.uniforms.fresnel) || 3);
    gl.uniform1f(shieldLoc.u.uHitRadius, Number(state.uniforms.hitRadius) || 1.4);
    gl.uniform1f(shieldLoc.u.uHexScale, Number(state.uniforms.hexScale) || 6);
    gl.uniform1f(shieldLoc.u.uPatchLife, Number(state.uniforms.patchLife) || 0.35);
    gl.uniform1f(shieldLoc.u.uRingLife, Number(state.uniforms.ringLife) || 0.3);

    const hitData = new Float32Array(16);
    for (let i = 0; i < 4; i++) hitData[i * 4 + 3] = -1;
    for (let i = 0; i < Math.min(4, state.hits.length); i++) {
      const hit = state.hits[i];
      hitData[i * 4] = hit.position[0];
      hitData[i * 4 + 1] = hit.position[1];
      hitData[i * 4 + 2] = hit.position[2];
      hitData[i * 4 + 3] = Math.max(0, hit.age);
    }
    gl.uniform4fv(shieldLoc.u.uHits, hitData);

    gl.uniformMatrix4fv(shieldLoc.u.uModel, false, M4.identity());
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
    gl.enableVertexAttribArray(shieldLoc.a.position);
    gl.vertexAttribPointer(shieldLoc.a.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
    gl.enableVertexAttribArray(shieldLoc.a.normal);
    gl.vertexAttribPointer(shieldLoc.a.normal, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    return;
  }

  gl.disable(gl.BLEND);
  gl.useProgram(meshProgram.program);
  const u = meshLoc.u;
  const a = meshLoc.a;

  gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
  gl.uniformMatrix4fv(u.uModel, false, M4.identity());
  gl.uniformMatrix3fv(u.uNormalMat, false, M4.normalMatrix(M4.identity()));
  gl.uniform3fv(u.uCamera, eye);
  gl.uniform3fv(u.uLightDir, [0.35, 0.55, 0.76]);
  gl.uniform1f(u.uRoughness, 1);
  gl.uniform3fv(u.uColor, hexToRgb(state.uniforms.color, [0.62, 0.68, 0.78]));
  gl.uniform3fv(u.uTint, [1, 1, 1]);
  gl.uniform3fv(u.uEmissive, [0, 0, 0]);
  gl.uniform1f(u.uSpecular, Number(state.uniforms.specular) || 1);
  gl.uniform1f(u.uMetal, Number(state.uniforms.metal) || 0);
  gl.uniform1f(u.uTextureColor, 0);
  gl.uniform1f(u.uTextured, 0);
  gl.uniform1i(u.uAlbedoMap, 0);
  gl.uniform1i(u.uRoughMap, 1);
  gl.uniform1i(u.uMetalMap, 2);
  gl.uniform1i(u.uEmissiveMap, 3);

  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
  gl.enableVertexAttribArray(a.position);
  gl.vertexAttribPointer(a.position, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
  gl.enableVertexAttribArray(a.normal);
  gl.vertexAttribPointer(a.normal, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuffer);
  gl.enableVertexAttribArray(a.uv);
  gl.vertexAttribPointer(a.uv, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
}

let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;

  for (const hit of state.hits) hit.age += dt;
  while (state.hits.length && state.hits[state.hits.length - 1].age > 2) state.hits.pop();

  drawMeshSphere();
  requestAnimationFrame(frame);
}

/* ------------------------------- Загрузка --------------------------------- */

async function loadMaterial(id) {
  const response = await fetch(`/api/material/${encodeURIComponent(id)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`материал «${id}» не найден`);

  const raw = await response.json();
  state.id = id;
  state.material = normalizeMaterial(raw, id);
  state.uniforms = { ...state.material.uniforms };
  state.hits = [];

  buildParams();
  saveState.textContent = 'без изменений';
  saveState.classList.remove('dirty');
  setStatus(`${state.material.title}: шейдер ${state.material.shader}, ${Object.keys(state.material.uniforms).length} параметров`);
  document.title = `Материал ${state.material.title || id} — GalaxyDemo`;
  history.replaceState(null, '', `?material=${encodeURIComponent(id)}`);
}

async function loadList() {
  const data = await fetch('/api/materials', { cache: 'no-store' }).then((response) => response.json());
  const list = Array.isArray(data.materials) ? data.materials : [];

  if (!list.length) throw new Error('в public/materials нет ни одного материала');

  select.innerHTML = list.map((material) => `<option value="${material.id}">${material.title || material.id}</option>`).join('');

  const requested = new URLSearchParams(location.search).get('material');
  const id = list.some((material) => material.id === requested) ? requested : list[0].id;
  select.value = id;
  await loadMaterial(id);
}

async function save() {
  if (!state.material) return;

  setStatus('сохранение…');

  try {
    const body = { ...state.material, uniforms: state.uniforms };
    const response = await fetch(`/api/material/${encodeURIComponent(state.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) throw new Error(await response.text());

    saveState.textContent = 'сохранено';
    saveState.classList.remove('dirty');
    setStatus(`сохранено: public/materials/${state.id}.material.json`);
  } catch (err) {
    setStatus(`ошибка сохранения: ${err.message}`);
  }
}

/* ------------------------------- События ---------------------------------- */

select.addEventListener('change', () => {
  loadMaterial(select.value).catch((err) => setStatus(err.message));
});

btnSave.addEventListener('click', () => save());
btnTest.addEventListener('click', () => {
  // Точка на правом борту сферы: так видно и пятно, и кольцо
  const direction = [0.92, 0.18, 0.35];
  const length = Math.hypot(...direction);
  state.hits.unshift({
    position: direction.map((value) => (value / length) * 2.4),
    age: 0
  });
  if (state.hits.length > 4) state.hits.length = 4;
});

canvas.addEventListener('pointerdown', (event) => {
  state.dragging = true;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener('pointermove', (event) => {
  if (!state.dragging) return;

  state.view.yaw -= (event.clientX - state.lastX) * 0.008;
  state.view.pitch = Math.min(1.2, Math.max(-1.2, state.view.pitch + (event.clientY - state.lastY) * 0.006));
  state.lastX = event.clientX;
  state.lastY = event.clientY;
});

canvas.addEventListener('pointerup', () => { state.dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.view.zoom = Math.min(3, Math.max(0.5, state.view.zoom * Math.exp(-event.deltaY * 0.001)));
}, { passive: false });

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});

loadList()
  .then(() => requestAnimationFrame(frame))
  .catch((err) => setStatus(err.message));
