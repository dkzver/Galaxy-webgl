// Ввод игрока: клавиши и мышь → entity.controls.
// Скрипт ничего не двигает сам — он только переводит сырой ввод в команды,
// которые читают movement.js, rotation.js и weapon.js.
//
// Esc забирает сцена: если в ней есть HUD-слой меню («hud-menu»), скрипт
// показывает и скрывает его, а встроенная пауза движка молчит.

export default {
  init(ctx) {
    ctx.entity.controls = ctx.entity.controls || {};
    ctx.state.escape = false;
    ctx.state.menu = 'hud-menu';

    // Esc отдаём сцене только когда меню действительно есть
    if (ctx.api.hud?.exists(ctx.state.menu)) {
      ctx.api.claim('pause');
    }
  },

  update(ctx) {
    const keys = ctx.api.input?.keys || {};
    const mouse = ctx.api.input?.mouse || {};
    const cursor = ctx.api.input?.cursor || {};
    const controls = ctx.entity.controls || (ctx.entity.controls = {});

    // Пока открыто меню сцены, корабль не слушает управление,
    // но скорость живёт своей жизнью: тягу просто не даём
    const blocked = Boolean(ctx.api.hud?.isVisible(ctx.state.menu));
    controls.blocked = blocked;

    controls.thrust = blocked ? 0 : (keys.w ? 1 : 0) - (keys.s ? 0.6 : 0);
    // A/D — снос вдоль правого вектора корабля (RightVector), не поворот.
    // Крен вокруг носа — Q (влево) / E (вправо); знак: +1 = правое крыло вниз.
    controls.strafe = blocked ? 0 : (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    controls.roll = blocked ? 0 : (keys.e ? 1 : 0) - (keys.q ? 1 : 0);
    controls.fire = blocked ? false : Boolean(mouse.down);

    // Курсор — джойстик: смещение от центра экрана в −1⋯1 по осям.
    // Направление и удалённость от центра читает rotation.js и сам считает курс.
    const aimX = blocked ? 0 : Math.max(-1, Math.min(1, Number(cursor.x) || 0));
    const aimY = blocked ? 0 : Math.max(-1, Math.min(1, Number(cursor.y) || 0));
    controls.aimX = aimX;
    controls.aimY = aimY;
    controls.aimDistance = Math.min(1, Math.hypot(aimX, aimY));

    // Esc по фронту: показать/скрыть меню сцены
    const escape = Boolean(ctx.api.input?.keysDown?.has('Escape'));

    if (escape && !ctx.state.escape && ctx.api.hud?.exists(ctx.state.menu)) {
      ctx.api.hud.toggle(ctx.state.menu);
    }

    ctx.state.escape = escape;
  }
};
