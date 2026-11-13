// Хост прицела: один DOM-элемент, в который монтируется дизайн.
//
// Дизайн приходит дескриптором от скрипта (public/scripts/reticles/*.js):
//   { id, kind: 'svg', file, vars }  — SVG из public/hud/reticles
//   { id, kind: 'canvas', draw }     — отрисовка на canvas
//
// Общие правила (роли слоёв, цвета состояний, кольцо прогресса) живут в
// public/hud/reticle.css и одинаковы для всех дизайнов. Здесь — только
// монтирование, позиция на экране и передача состояния.

import {
  DEFAULT_DESIGN,
  applyDesignVars,
  loadReticleSvg,
  normalizeReticleConfig,
  reticleColor,
  reticleStateClasses
} from './reticles.js';

const STATE_CLASSES = ['visible', 'aimed', 'can-hit', 'reloading', 'bursting'];
const FIRE_MS = 420;
const VIEW = 120;

function designKey(design) {
  return [design.kind || 'svg', design.id || '', design.file || '', design.revision || ''].join('|');
}

/**
 * @param {{mount?: HTMLElement, config?: object}} [options]
 */
export function createReticleView({ mount = document.body, config = null } = {}) {
  const element = document.createElement('div');
  element.className = 'weapon-reticle';

  const stage = document.createElement('div');
  stage.className = 'weapon-reticle__stage';
  element.append(stage);
  mount.append(element);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  let current = normalizeReticleConfig(config);
  let state = { aimed: false, canHit: false, reloading: false, bursting: false, progress: 0 };
  let position = { x: 0, y: 0, visible: false };
  let mountedKey = '';
  let designToken = 0;
  let progressNodes = [];
  let canvas = null;
  let canvasCtx = null;
  let canvasDesign = null;
  let raf = 0;
  let startedAt = 0;
  let pulseAt = 0;
  let fireTimer = 0;

  function applyColors() {
    element.style.setProperty('--reticle-size', `${current.size}px`);
    element.style.setProperty('--reticle-color', current.color);
    element.style.setProperty('--reticle-aim-color', current.aimColor);
  }

  function applyStateClasses() {
    for (const name of STATE_CLASSES) {
      element.classList.toggle(name, reticleStateClasses(state).includes(name));
    }
  }

  function applyProgress() {
    const progress = Math.min(1, Math.max(0, Number(state.progress) || 0));
    for (const node of progressNodes) node.style.strokeDashoffset = String(1 - progress);
  }

  function stopCanvas() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    canvas = null;
    canvasCtx = null;
    canvasDesign = null;
  }

  function drawFrame(now) {
    raf = requestAnimationFrame(drawFrame);
    if (!canvasCtx || !canvasDesign || !position.visible) return;
    if (!startedAt) startedAt = now;

    const pulse = pulseAt ? Math.max(0, 1 - (now - pulseAt) / FIRE_MS) : 0;
    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvasCtx.clearRect(0, 0, VIEW, VIEW);

    canvasDesign.draw(canvasCtx, {
      size: VIEW,
      time: (now - startedAt) / 1000,
      progress: Math.min(1, Math.max(0, Number(state.progress) || 0)),
      color: reticleColor(current, state),
      aimed: Boolean(state.aimed),
      canHit: Boolean(state.canHit),
      pulse
    });
  }

  function mountCanvas(design) {
    canvas = document.createElement('canvas');
    canvas.width = Math.round(VIEW * dpr);
    canvas.height = Math.round(VIEW * dpr);
    stage.append(canvas);

    canvasCtx = canvas.getContext('2d');
    canvasDesign = design;
    startedAt = 0;
    raf = requestAnimationFrame(drawFrame);
  }

  async function mountDesign(design) {
    const token = ++designToken;
    mountedKey = designKey(design);

    stopCanvas();
    stage.replaceChildren();
    progressNodes = [];

    // Класс-модификатор (например, виджет курсора) ставится снаружи — сохраняем
    const modifier = element.classList.contains('weapon-reticle--cursor') ? ' weapon-reticle--cursor' : '';
    element.className = `weapon-reticle wr-${design.id || 'custom'}${modifier}`;
    applyDesignVars(element, design.vars);
    applyStateClasses();

    if (design.kind === 'canvas' && typeof design.draw === 'function') {
      mountCanvas(design);
      return;
    }

    const markup = typeof design.markup === 'string' && design.markup
      ? design.markup
      : await loadReticleSvg(design.file || DEFAULT_DESIGN.file).catch(() => '');
    if (token !== designToken) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${VIEW} ${VIEW}`);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.35');
    svg.setAttribute('stroke-linecap', 'round');
    svg.innerHTML = markup;

    stage.append(svg);
    progressNodes = [...svg.querySelectorAll('[data-role="progress"]')];
    applyProgress();
  }

  applyColors();
  applyStateClasses();

  // Конфиг может прийти сразу с дизайном — тогда монтируем без ожидания кадра
  if (config?.design) mountDesign(config.design).catch(() => {});

  return {
    element,

    /**
     * Конфиг сущности + дизайн из скрипта.
     * @param {object|null} raw блок `reticle` с полем design
     */
    setConfig(raw) {
      const design = raw?.design && typeof raw.design === 'object' ? raw.design : DEFAULT_DESIGN;
      current = normalizeReticleConfig(raw);
      applyColors();

      const key = designKey(design);
      if (key !== mountedKey) mountDesign(design).catch(() => {});
    },

    getConfig() {
      return { ...current };
    },

    setState(next = {}) {
      state = {
        aimed: Boolean(next.aimed),
        canHit: Boolean(next.canHit),
        reloading: Boolean(next.reloading),
        bursting: Boolean(next.bursting),
        progress: Math.min(1, Math.max(0, Number(next.progress) || 0))
      };

      applyStateClasses();
      applyProgress();
    },

    setPosition(x, y, visible = true) {
      position = { x: Number(x) || 0, y: Number(y) || 0, visible: Boolean(visible) };

      if (!position.visible) {
        element.classList.remove('visible');
        return;
      }

      element.style.left = `${position.x}px`;
      element.style.top = `${position.y}px`;
      element.classList.add('visible');
    },

    /** Вспышка на выстрел: класс для SVG, таймер для canvas. */
    pulse() {
      element.classList.remove('fire');
      void element.offsetWidth;
      element.classList.add('fire');

      clearTimeout(fireTimer);
      fireTimer = setTimeout(() => element.classList.remove('fire'), FIRE_MS);
      pulseAt = performance.now();
    },

    hide() {
      position.visible = false;
      element.classList.remove('visible');
    },

    dispose() {
      clearTimeout(fireTimer);
      stopCanvas();
      element.remove();
    }
  };
}
