// Скрипт загрузочного экрана сцены.
//
// Движок вызывает init/update/dispose в том же цикле, что и игру:
// каждый кадр приходит dt, а прогресс и прошедшее время доступны через api.
//
// ctx.api.loading:
//   getProgress() — 0…1, сколько движок уже загрузил
//   getElapsed()  — секунды с начала загрузки
//   isReady()     — сцена готова, экран сейчас уйдёт
//   getError()    — текст ошибки или null
// ctx.api.root — элемент #overlay, внутри него лежит этот HTML.

const NOTE_STEPS = [
  { at: 0, text: 'подготовка сцены…' },
  { at: 0.06, text: 'читаем сцену…' },
  { at: 0.2, text: 'собираем объекты…' },
  { at: 0.62, text: 'интерфейс…' },
  { at: 0.78, text: 'скрипты…' },
  { at: 0.96, text: 'почти готово…' }
];

function formatTime(seconds) {
  return `${seconds.toFixed(1)} с`;
}

export default {
  init(ctx) {
    const root = ctx.api.root;
    ctx.state.fill = root?.querySelector('#loading-fill') || null;
    ctx.state.percent = root?.querySelector('#loading-percent') || null;
    ctx.state.time = root?.querySelector('#loading-time') || null;
    ctx.state.note = root?.querySelector('#loading-note') || null;
    ctx.state.shown = 0;
    ctx.state.error = null;
  },

  update(ctx, dt) {
    const loading = ctx.api.loading;
    const error = loading.getError();

    // Ошибка важнее прогресса: показываем её и больше ничего не анимируем
    if (error) {
      if (ctx.state.error !== error) {
        ctx.state.error = error;
        if (ctx.state.note) ctx.state.note.textContent = error;
        if (ctx.state.fill) ctx.state.fill.style.width = '100%';
        if (ctx.state.percent) ctx.state.percent.textContent = 'ошибка';
      }
      return;
    }

    const target = Math.max(0, Math.min(1, loading.getProgress()));
    // Плавно догоняем цель, чтобы полоска не прыгала по этапам загрузки
    const k = Math.min(1, dt * 6);
    ctx.state.shown += (target - ctx.state.shown) * k;

    if (ctx.state.fill) ctx.state.fill.style.width = `${(ctx.state.shown * 100).toFixed(1)}%`;
    if (ctx.state.percent) ctx.state.percent.textContent = `${Math.round(ctx.state.shown * 100)}%`;
    if (ctx.state.time) ctx.state.time.textContent = formatTime(loading.getElapsed());

    if (ctx.state.note && ctx.state.note.textContent !== 'ошибка') {
      let text = NOTE_STEPS[0].text;
      for (const step of NOTE_STEPS) {
        if (target >= step.at) text = step.text;
      }
      if (loading.isReady()) text = 'готово';
      if (ctx.state.note.textContent !== text) ctx.state.note.textContent = text;
    }
  },

  dispose(ctx) {
    ctx.state.fill = null;
    ctx.state.percent = null;
    ctx.state.time = null;
    ctx.state.note = null;
  }
};
