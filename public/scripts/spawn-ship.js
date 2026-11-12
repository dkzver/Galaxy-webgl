// Пример: точка появления, заданная скриптом.
//
// Скрипт вешается на любой узел — его мировая позиция становится точкой
// спавна. player.spawn из файла сцены при этом не нужен: init скриптов
// выполняется уже после сборки сцены, а событие galaxy:scene-ready
// сообщает движку, что можно начинать.
//
// Если в сцене есть сущность игрока (player.entity), скрипт переносит её
// вместе с физическим телом. В старых сценах двигает корабль движка.

export default {
  init(ctx) {
    const entity = ctx.entity;

    // Матрица уже мировая, поэтому вложенность и поворот родителя учтены
    const point = [entity.matrix[12], entity.matrix[13], entity.matrix[14]];

    if (ctx.api.player) {
      ctx.api.setPosition(ctx.api.player, point);
      ctx.api.setVelocity(ctx.api.player, [0, 0, 0]);
      return;
    }

    const ship = ctx.api.ship;
    if (!ship) return;

    ship.pos = point;
    ship.vel = [0, 0, 0];
    ship.turnRate = 0;
  }
};
