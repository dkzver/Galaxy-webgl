// Виджет «Круг»: дизайн в hud/reticles/circle.svg.
// Используется курсором; параметры — только внешний вид.

const DEFAULTS = {
  file: 'hud/reticles/circle.svg',
  spin: 18,
  scan: 4.5,
  breathe: 2.6
};

export const params = {
  file: { label: 'Файл SVG', default: DEFAULTS.file, type: 'text' },
  spin: { label: 'Кольцо, с', default: DEFAULTS.spin, min: 2, max: 90, step: 0.5 },
  scan: { label: 'Сканер, с', default: DEFAULTS.scan, min: 0.5, max: 30, step: 0.1 },
  breathe: { label: 'Дыхание ядра, с', default: DEFAULTS.breathe, min: 0.5, max: 20, step: 0.1 }
};

export function design(values = {}) {
  const p = { ...DEFAULTS, ...values };

  return {
    id: 'circle',
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
