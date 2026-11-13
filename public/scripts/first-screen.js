// Пользовательский скрипт сцены: описывает кадр и загрузку.
//
// В init он вызывает api.scene.build(...) — единственную точку входа движка.
// Только переданные туда поля используются:
//   background    — фон кадра;
//   hudStyle      — один CSS-файл на все HTML-слои HUD;
//   loadingFile   — HTML загрузочного экрана;
//   loadingScript — скрипт загрузочного экрана;
//   cursor        — ссылка на объект-курсор (пусто — системный).
//
// Без скрипта на объекте «Сцена» игра не запускается: движку нечем описать кадр.

export const params = {
  background: { label: 'Фон кадра', default: '#000000', type: 'color' },
  hudStyle: { label: 'Стили HUD', default: 'hud/style.css', type: 'text' },
  loadingFile: { label: 'HTML загрузки', default: 'hud/loading.html', type: 'text' },
  loadingScript: { label: 'Скрипт загрузки', default: 'scripts/loading.js', type: 'text' },
  cursor: { label: 'Курсор', default: '', type: 'reticle' }
};

export default {
  init(ctx) {
    ctx.api.claim('scene');

    // Единственная точка входа: движок строит кадр только по этим параметрам
    ctx.api.scene.build({
      background: ctx.params.background,
      hudStyle: ctx.params.hudStyle,
      loadingFile: ctx.params.loadingFile,
      loadingScript: ctx.params.loadingScript,
      cursor: ctx.params.cursor
    });
  },

  update() {
    // Кадром управляет движок по params; здесь можно добавить свою логику сцены
  }
};
