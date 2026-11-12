// Пример скрипта-двери: поднимает объект, когда корабль входит в триггер,
// и опускает обратно, когда выходит.
//
// Скрипт вешается на триггер. Объект-дверь ищется по id (door-1).

export default {
  init(ctx) {
    ctx.state.door = ctx.api.find('door-1');
    ctx.state.base = ctx.state.door ? ctx.state.door.position.slice() : null;
    ctx.state.open = 0;
    ctx.state.target = 0;
  },

  onEvent(ctx, event) {
    if (event.trigger !== ctx.entity.id) return;
    if (event.type === 'trigger.enter') ctx.state.target = 1;
    if (event.type === 'trigger.exit') ctx.state.target = 0;
  },

  update(ctx, dt) {
    const door = ctx.state.door;
    if (!door || !ctx.state.base) return;

    const k = 1 - Math.exp(-4 * dt);
    ctx.state.open += (ctx.state.target - ctx.state.open) * k;
    door.position[1] = ctx.state.base[1] + ctx.state.open * 9;
  }
};
