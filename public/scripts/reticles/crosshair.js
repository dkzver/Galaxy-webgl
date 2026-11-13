// Прицел «Перекрестие»: дизайн в hud/reticles/crosshair.svg.
//
// Это прицел точки попадания: перекрестие с анимацией, вспышкой на выстрел
// и полосой прогресса очереди/перезарядки внизу. Круговое кольцо с круговым
// прогрессом оставлено для виджета курсора (позже).

const DEFAULTS = {
  file: 'hud/reticles/crosshair.svg',
  spin: 24,
  scan: 4.8,
  breathe: 2.8
};

export const params = {
  file: { label: 'Файл SVG', default: DEFAULTS.file, type: 'text' },
  spin: { label: 'Внешние скобы, с', default: DEFAULTS.spin, min: 2, max: 120, step: 0.5 },
  scan: { label: 'Сканер, с', default: DEFAULTS.scan, min: 0.5, max: 30, step: 0.1 },
  breathe: { label: 'Дыхание ядра, с', default: DEFAULTS.breathe, min: 0.5, max: 20, step: 0.1 }
};

export function design(values = {}) {
  const p = { ...DEFAULTS, ...values };

  return {
    id: 'crosshair',
    kind: 'svg',
    file: p.file,
    vars: {
      '--wr-spin': `${p.spin}s`,
      '--wr-scan': `${p.scan}s`,
      '--wr-breathe': `${p.breathe}s`
    }
  };
}

export default {
  init(ctx) {
    ctx.entity.reticleDesign = design(ctx.params);
  },

  dispose(ctx) {
    ctx.entity.reticleDesign = null;
  }
};
