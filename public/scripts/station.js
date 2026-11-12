// Станция: имя базы задаётся в редакторе и выводится в HUD-слой.
//
// HUD-слой — дочерний объект станции с привязкой follow: parent.
// Экранную позицию считает только движок; скрипт лишь передаёт текст.

export const params = {
  name: { label: 'Имя базы', default: 'Орбитальная станция', type: 'text' }
};

export default {
  init(ctx) {
    this.apply(ctx);
  },

  update(ctx) {
    this.apply(ctx);
  },

  apply(ctx) {
    const name = String(ctx.params.name || 'Орбитальная станция');
    if (ctx.state.name === name) return;

    ctx.state.name = name;
    ctx.api.hud?.setText?.('station-name', name);
  }
};
