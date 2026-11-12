// Простое поведение бота: облёт по кругу вокруг точки появления.
//
// Параметры берутся из сущности сцены:
//   bot.radius — радиус круга (по умолчанию 14)
//   bot.speed  — угловая скорость, рад/с (по умолчанию 0.35)
//   bot.height — амплитуда покачивания по Y

export default {
  init(ctx) {
    const bot = ctx.entity.raw.bot || {};

    ctx.state.origin = ctx.entity.position.slice();
    ctx.state.angle = (ctx.entity.raw.rotation?.[1] || 0) * Math.PI / 180;
    ctx.state.radius = bot.radius ?? 14;
    ctx.state.speed = bot.speed ?? 0.35;
    ctx.state.height = bot.height ?? 2;
  },

  update(ctx, dt) {
    const state = ctx.state;
    state.angle += state.speed * dt;

    const x = state.origin[0] + Math.cos(state.angle) * state.radius;
    const z = state.origin[2] + Math.sin(state.angle) * state.radius;
    const y = state.origin[1] + Math.sin(state.angle * 2) * state.height;

    ctx.api.setPosition(ctx.entity, [x, y, z]);

    // Нос модели смотрит в −Z: разворачиваем по направлению движения
    ctx.api.faceDirection(ctx.entity, [-Math.sin(state.angle), 0, Math.cos(state.angle)]);
  }
};
