// Прицел: общие правила отображения и данные сущности.
//
// Дизайн прицела — не код движка, а HTML/SVG-файл (public/hud/reticles/*.svg)
// или canvas-отрисовка из скрипта-дизайна (public/scripts/reticles/*.js).
// Движок интерпретирует разметку по ролям:
//
//   data-role="outer"          — медленное вращение (var --wr-spin)
//   data-role="mid"            — обратное вращение (var --wr-counter)
//   data-role="scan"           — бегущая дуга-сканер (var --wr-scan)
//   data-role="core"           — «дыхание» ядра и вспышка выстрела
//   data-role="progress-group" — слой кольца прогресса (очередь/перезарядка)
//   data-role="progress"       — само кольцо: длину задаёт движок
//
// Скрипт-дизайн возвращает дескриптор { id, kind, file|markup|draw, vars }.
// Цвета и размер живут в блоке `reticle` сущности, чтобы менять их без скрипта.

export const RETICLE_DEFAULTS = {
  size: 34,
  color: '#68daff',
  aimColor: '#ffc857'
};

/** Если у сущности нет скрипта-дизайна — рисуем перекрестие. */
export const DEFAULT_DESIGN = {
  id: 'crosshair',
  kind: 'svg',
  file: 'hud/reticles/crosshair.svg',
  vars: {}
};

const svgCache = new Map();

function colorOr(value, fallback) {
  const text = String(value ?? '').trim();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  return fallback;
}

function numberOr(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Блок `reticle` сущности: размер и цвета. Неизвестные поля отбрасываются. */
export function normalizeReticleConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    size: Math.round(numberOr(source.size, RETICLE_DEFAULTS.size, 16, 120)),
    color: colorOr(source.color, RETICLE_DEFAULTS.color),
    aimColor: colorOr(source.aimColor, RETICLE_DEFAULTS.aimColor)
  };
}

/**
 * Классы состояния. У прицела сейчас одно состояние — наведение на модель;
 * перезарядка и очередь убраны до возврата к курсору.
 * @param {{aimed?:boolean}} state
 * @returns {string[]}
 */
export function reticleStateClasses(state = {}) {
  const classes = ['visible'];
  if (state.aimed) classes.push('aimed');
  return classes;
}

/** Активный цвет прицела: наведение → покой. */
export function reticleColor(config, state = {}) {
  const colors = normalizeReticleConfig(config);
  return state.aimed ? colors.aimColor : colors.color;
}

/** Передать переменные дизайна в CSS (только --wr-*). */
export function applyDesignVars(element, vars) {
  if (!element || !vars) return;

  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith('--wr-')) continue;
    element.style.setProperty(key, String(value));
  }
}

function svgInner(text) {
  if (typeof DOMParser === 'undefined') return String(text || '');
  const doc = new DOMParser().parseFromString(String(text || ''), 'image/svg+xml');
  const root = doc.documentElement;
  return root && root.tagName.toLowerCase() === 'svg' ? root.innerHTML : String(text || '');
}

/**
 * Прочитать SVG-дизайн из public (кэшируется).
 * @param {string} file путь вида hud/reticles/crosshair.svg
 * @returns {Promise<string>} внутренняя разметка svg
 */
export function loadReticleSvg(file) {
  const path = String(file || DEFAULT_DESIGN.file).replace(/^\/+/, '');
  if (!svgCache.has(path)) {
    svgCache.set(path, fetch(`/${path}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`SVG прицела не найден: ${path}`);
        return response.text();
      })
      .then(svgInner)
      .catch((error) => {
        svgCache.delete(path);
        throw error;
      }));
  }

  return svgCache.get(path);
}

/** Сбросить кэш SVG (редактор — после правки файла, тесты — между кейсами). */
export function resetReticleCache() {
  svgCache.clear();
}
