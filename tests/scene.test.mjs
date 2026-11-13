import test from 'node:test';
import assert from 'node:assert/strict';

import { eulerToQuat, quatToEuler, normalizeScene, reassignIds, remapEntityReferences, sanitizePrefabReferences, refreshPrefabRoots } from '../public/js/scene.js';
import { syncAttachedBodies, attachBodies } from '../public/js/scene-runtime.js';
import { PhysicsWorld, sphereShape } from '../public/js/physics.js';
import { M4, quatFromAxisAngle, quatFromMat4, quatNormalize, quatRotate, quatToMat4 } from '../public/js/math.js';

function assertQuatClose(a, b, eps = 1e-3) {
  // Кватернионы q и −q описывают одно вращение
  const same = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
  const flipped = Math.hypot(a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]);
  assert.ok(Math.min(same, flipped) < eps, `кватернионы расходятся: ${same} / ${flipped}`);
}

test('quatToEuler обращает eulerToQuat', () => {
  const angles = [
    [0, 0, 0],
    [15, 0, 0],
    [0, 40, 0],
    [0, 0, 25],
    [10, 20, 30],
    [-35, 120, 45],
    [5, -170, -15]
  ];

  for (const euler of angles) {
    const quaternion = eulerToQuat(euler);
    const back = quatToEuler(quaternion);
    assertQuatClose(eulerToQuat(back), quaternion, 5e-3);
  }
});

test('quatToEuler вращает так же, как исходный кватернион', () => {
  const euler = [22, -63, 14];
  const quaternion = eulerToQuat(euler);
  const restored = eulerToQuat(quatToEuler(quaternion));

  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -0.7, 0.2]]) {
    const a = quatRotate(quaternion, axis);
    const b = quatRotate(restored, axis);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 2e-3, `ось ${axis}: ${a[i]} vs ${b[i]}`);
  }
});

test('у скрипта сохраняются параметры из редактора', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'script-params',
    entities: [
      {
        id: 'ship',
        type: 'empty',
        scripts: [
          { file: 'camera.js', params: { height: 30, distance: 85 } },
          'rotator.js'
        ]
      }
    ]
  });

  const [camera, rotator] = scene.entities[0].scripts;
  assert.equal(camera.file, 'camera.js');
  assert.deepEqual(camera.params, { height: 30, distance: 85 });
  assert.equal(rotator.file, 'rotator.js');
  assert.equal(rotator.params, undefined);
});

test('HUD-слой может стартовать скрытым', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'menu-test',
    entities: [
      { id: 'hud-menu', type: 'hud', hud: { file: 'hud/menu.html', startHidden: true } },
      { id: 'hud-brand', type: 'hud', hud: { file: 'hud/brand.html' } }
    ]
  });

  assert.equal(scene.entities[0].hud.startHidden, true);
  assert.equal(scene.entities[1].hud.startHidden, false);
});

test('HUD-слой берёт html-файл и привязку', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'hud-test',
    entities: [
      { id: 'reticle', type: 'hud', hud: { file: 'hud/reticle.html', follow: 'mouse' } },
      { id: 'bad', type: 'hud', hud: { file: '../../secret.txt', follow: 'nope' } }
    ]
  });

  const [reticle, bad] = scene.entities;
  assert.equal(reticle.hud.file, 'hud/reticle.html');
  assert.equal(reticle.hud.follow, 'mouse');
  assert.equal(bad.hud.file, null);
  assert.equal(bad.hud.follow, 'none');
});

test('камера сцены хранит параметры обзора и режет диапазоны', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'camera-test',
    entities: [
      { id: 'camera-main', type: 'camera', camera: { height: 35, distance: 90, drop: 4, tilt: 180, fov: 70, near: 0.5, far: 900 } },
      { id: 'camera-default', type: 'camera' },
      { id: 'camera-clamped', type: 'camera', camera: { height: -5, distance: 999, drop: 99, tilt: 720, fov: 999, near: 0, far: 0 } }
    ]
  });

  assert.deepEqual(scene.entities[0].camera, {
    height: 35, distance: 90, drop: 4, tilt: 180, background: null, fov: 70, near: 0.5, far: 900
  });
  assert.deepEqual(scene.entities[1].camera, {
    height: 20, distance: 120, drop: 0, tilt: 0, background: null, fov: 50, near: 0.1, far: 5000
  });
  assert.deepEqual(scene.entities[2].camera, {
    height: 0, distance: 120, drop: 15, tilt: 360, background: null, fov: 120, near: 0.01, far: 1.01
  });
});

test('камера может лежать внутри пустого узла', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'nested-camera',
    entities: [
      {
        id: 'rig',
        type: 'empty',
        rotation: [0, 90, 0],
        children: [{ id: 'camera-on-rig', type: 'camera', position: [0, 2, -4], camera: { fov: 60 } }]
      }
    ]
  });

  const [rig] = scene.entities;
  assert.equal(rig.children[0].type, 'camera');
  assert.equal(rig.children[0].camera.fov, 60);
  assert.deepEqual(rig.children[0].position, [0, 2, -4]);
});

test('тело ребёнка жёстко едет за родителем', () => {
  const world = new PhysicsWorld({ gravity: [0, 0, 0] });
  const body = world.addBody({
    name: 'child',
    type: 'static',
    position: [0, 0, 0],
    shape: sphereShape(1)
  });

  const quaternion = quatFromAxisAngle([0, 1, 0], Math.PI / 2);
  const matrix = M4.mul(M4.translation(10, 2, -3), quatToMat4(quaternion));

  syncAttachedBodies([{ parent: { id: 'group' }, body, matrix }]);

  assert.deepEqual(Array.from(body.position), [10, 2, -3]);
  const dot = Math.abs(body.quaternion.reduce((sum, value, index) => sum + value * quaternion[index], 0));
  assert.ok(dot > 0.9999, `поворот расходится: ${dot}`);
});

test('HUD может быть привязан к родителю или объекту', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'hud-world',
    entities: [
      { id: 'label', type: 'hud', hud: { file: 'hud/station-name.html', follow: 'parent', offset: [0, -70] } },
      { id: 'tag', type: 'hud', hud: { file: 'hud/target.html', follow: 'entity', target: 'station-1' } },
      { id: 'bad', type: 'hud', hud: { file: 'hud/target.html', follow: 'wat', target: 42 } }
    ]
  });

  assert.equal(scene.entities[0].hud.follow, 'parent');
  assert.deepEqual(scene.entities[0].hud.offset, [0, -70]);
  assert.equal(scene.entities[1].hud.follow, 'entity');
  assert.equal(scene.entities[1].hud.target, 'station-1');
  assert.equal(scene.entities[2].hud.follow, 'none');
  assert.equal(scene.entities[2].hud.target, null);
});

test('игрок — обычная сущность сцены, spawn необязателен', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'player-test',
    player: { spawn: 'gone', position: [1, 2, 3] },
    entities: [{ id: 'player-ship', type: 'empty', scripts: ['input.js'] }]
  });

  assert.equal(scene.player.spawn, null);
  assert.deepEqual(scene.player.position, [1, 2, 3]);
  assert.equal(scene.entities[0].scripts[0].file, 'input.js');
});

test('reassignIds обходит всё дерево и выдаёт разные id', () => {
  const entities = [
    { id: 'group-1', children: [{ id: 'part-1', children: [{ id: 'deep-1' }] }] },
    { id: 'group-2' }
  ];
  const used = [];

  reassignIds(entities, (oldId) => {
    const id = `${oldId.split('-')[0]}-copy`;
    used.push(id);
    return id;
  });

  assert.deepEqual(used, ['group-copy', 'part-copy', 'deep-copy', 'group-copy']);
  assert.equal(entities[0].children[0].children[0].id, 'deep-copy');
  assert.equal(entities[1].id, 'group-copy');
});

test('normalizeScene сохраняет пустой узел со скриптом и детьми', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'nested',
    entities: [
      {
        id: 'group',
        type: 'empty',
        name: 'Турель',
        position: [10, 0, -4],
        rotation: [0, 45, 0],
        scripts: ['rotator.js'],
        children: [
          {
            id: 'turret-body',
            type: 'model',
            asset: 'spaceship',
            position: [0, 1.5, 0],
            body: { kind: 'static', collider: { shape: 'sphere', radius: 2 } }
          },
          {
            id: 'inner',
            type: 'empty',
            position: [0, 0, 3],
            scripts: ['rotator.js'],
            children: [{ id: 'crate', type: 'primitive', shape: 'box', size: [2, 2, 2] }]
          }
        ]
      }
    ]
  });

  const [group] = scene.entities;
  assert.equal(group.type, 'empty');
  assert.equal(group.name, 'Турель');
  assert.deepEqual(group.position, [10, 0, -4]);
  assert.deepEqual(group.scripts, [{ file: 'rotator.js' }]);
  assert.equal(group.children.length, 2);
  assert.deepEqual(group.children[0].position, [0, 1.5, 0]);
  assert.equal(group.children[1].children[0].id, 'crate');
});

test('normalizeScene не пускает динамическое тело внутрь группы', () => {
  assert.throws(
    () => normalizeScene({
      version: 1,
      id: 'bad',
      entities: [
        {
          id: 'group',
          type: 'empty',
          children: [
            { id: 'rock', type: 'model', asset: 'asteroid1', body: { kind: 'dynamic', mass: 20 } }
          ]
        }
      ]
    }),
    /динамическое тело внутри группы/
  );
});

test('нормализация сцены сохраняет compound из боксов и сфер', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'compound-scene',
    entities: [{
      id: 'ship',
      type: 'model',
      asset: 'corinth',
      body: {
        kind: 'static',
        collider: {
          shape: 'compound',
          spheres: [{ offset: [0, 0, -2], radius: 1.5 }],
          boxes: [{ offset: [0, 1, 0], halfExtents: [1, 2, 3] }]
        }
      }
    }]
  });

  const [ship] = scene.entities;
  assert.equal(ship.body.collider.shape, 'compound');
  assert.deepEqual(ship.body.collider.spheres[0], { offset: [0, 0, -2], radius: 1.5 });
  assert.deepEqual(ship.body.collider.boxes[0], { offset: [0, 1, 0], halfExtents: [1, 2, 3] });
});

test('обратная матрица и кватернион из матрицы совпадают с исходными', () => {
  const quaternion = quatNormalize([0.2, 0.5, -0.3, 0.78]);
  const world = M4.mul(
    M4.translation(3, 4, 5),
    M4.mul(quatToMat4(quaternion), M4.scaling(2, 3, 4))
  );

  const point = [1, 2, 3];
  const back = M4.transformPoint(M4.invert(world), M4.transformPoint(world, point));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(back[i] - point[i]) < 1e-5, `координата ${i}: ${back[i]}`);

  const restored = quatFromMat4(world);
  const same = Math.hypot(...restored.map((value, index) => value - quaternion[index]));
  const flipped = Math.hypot(...restored.map((value, index) => value + quaternion[index]));
  assert.ok(Math.min(same, flipped) < 1e-5, `кватернион расходится: ${same} / ${flipped}`);
});

test('normalizeScene принимает пустую сцену с точкой спавна', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'unit',
    player: { model: 'corinth', spawn: 'spawn-start' },
    entities: [{ id: 'spawn-start', type: 'spawn', position: [1, 2, 3] }]
  });

  assert.equal(scene.id, 'unit');
  assert.equal(scene.entities.length, 1);
  assert.deepEqual(scene.entities[0].position, [1, 2, 3]);
});

test('корневой объект «Сцена» хранит настройки, а объекты — его дети', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'root-test',
    entities: [{
      id: 'scene',
      type: 'scene',
      name: 'Сцена',
      background: '#101828',
      hud: { style: 'hud/style.css' },
      player: { model: 'spaceship' },
      children: [
        { id: 'a', type: 'empty' },
        { id: 'b', type: 'primitive', shape: 'box' }
      ]
    }]
  });

  assert.equal(scene.entities.length, 2);
  assert.equal(scene.entities[0].id, 'a');
  assert.equal(scene.scene.name, 'Сцена');
  assert.equal(scene.scene.hudStyle, 'hud/style.css');
  assert.equal(scene.background, '#101828');
  assert.equal(scene.player.model, 'spaceship');
});

test('стили HUD принимаются только из public/hud', () => {
  const ok = normalizeScene({
    version: 1,
    id: 'style-ok',
    entities: [{ id: 'scene', type: 'scene', hud: { style: 'hud/first-game.css' }, children: [{ id: 'a', type: 'empty' }] }]
  });
  assert.equal(ok.scene.hudStyle, 'hud/first-game.css');

  const bad = normalizeScene({
    version: 1,
    id: 'style-bad',
    entities: [{ id: 'scene', type: 'scene', hud: { style: '../../etc/passwd' }, children: [{ id: 'a', type: 'empty' }] }]
  });
  assert.equal(bad.scene.hudStyle, null);
});

test('загрузочный экран сцены: html и скрипт с проверкой путей', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'loading-test',
    entities: [{
      id: 'scene', type: 'scene',
      loading: { file: 'hud/loading.html', script: 'scripts/loading.js' },
      children: [{ id: 'a', type: 'empty' }]
    }]
  });

  assert.deepEqual(scene.scene.loading, { file: 'hud/loading.html', script: 'scripts/loading.js' });

  const bad = normalizeScene({
    version: 1,
    id: 'loading-bad',
    entities: [{
      id: 'scene', type: 'scene',
      loading: { file: '../evil.html', script: 'http://evil/x.js' },
      children: [{ id: 'a', type: 'empty' }]
    }]
  });

  assert.equal(bad.scene.loading.file, 'hud/loading.html');
  assert.equal(bad.scene.loading.script, 'scripts/loading.js');
});

test('нормализация сцены сохраняет offset сферы и бокса', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'offset-scene',
    entities: [
      {
        id: 'sphere-body',
        type: 'primitive',
        body: { kind: 'static', collider: { shape: 'sphere', radius: 2, offset: [1, 2, 3] } }
      },
      {
        id: 'box-body',
        type: 'primitive',
        body: { kind: 'static', collider: { shape: 'box', halfExtents: [1, 1, 1], offset: [-1, 0, 2] } }
      }
    ]
  });

  assert.deepEqual(scene.entities[0].body.collider.offset, [1, 2, 3]);
  assert.deepEqual(scene.entities[1].body.collider.offset, [-1, 0, 2]);
});

test('attachBodies переносит offset простого коллайдера в форму', () => {
  const physics = new PhysicsWorld({ gravity: [0, 0, 0] });
  const entity = {
    id: 'offset-sphere',
    raw: {
      id: 'offset-sphere',
      type: 'primitive',
      body: {
        kind: 'static',
        mass: 0,
        restitution: 0.2,
        friction: 0.4,
        collider: { shape: 'sphere', radius: 2, offset: [1, 0, 0] }
      }
    },
    matrix: M4.identity(),
    scaleUniform: 2,
    parent: null
  };

  attachBodies([entity], physics);

  assert.equal(entity.body.shape.type, 'compound');
  assert.deepEqual(entity.body.shape.spheres[0].offset, [2, 0, 0]);
  assert.equal(entity.body.shape.spheres[0].radius, 4);
});

test('attachBodies собирает compound из боксов с учётом масштаба', () => {
  const physics = new PhysicsWorld({ gravity: [0, 0, 0] });
  const entity = {
    id: 'crate',
    raw: {
      id: 'crate',
      type: 'primitive',
      body: {
        kind: 'static',
        mass: 0,
        restitution: 0.2,
        friction: 0.4,
        collider: {
          shape: 'compound',
          spheres: [{ offset: [0, 1, 0], radius: 1 }],
          boxes: [{ offset: [2, 0, 0], halfExtents: [1, 2, 3] }]
        }
      }
    },
    matrix: M4.identity(),
    scaleUniform: 2,
    parent: null
  };

  attachBodies([entity], physics);

  assert.equal(entity.body.shape.type, 'compound');
  assert.deepEqual(entity.body.shape.spheres[0].offset, [0, 2, 0]);
  assert.equal(entity.body.shape.spheres[0].radius, 2);
  assert.deepEqual(entity.body.shape.boxes[0].offset, [4, 0, 0]);
  assert.deepEqual(entity.body.shape.boxes[0].halfExtents, [2, 4, 6]);
});

test('remapEntityReferences переводит ссылки на новые id', () => {
  const entities = [{
    id: 'player-1',
    scripts: [
      'input.js',
      { file: 'weapons.js', params: { body: 'mesh-1', muzzleLeft: 'gun-left', other: 5 } }
    ],
    hud: { target: 'ship-1' },
    bot: { spawn: 'spawn-1' },
    spawnId: 'spawn-1',
    children: [
      { id: 'gun-left', scripts: [{ file: 'rotator.js', params: { target: 'mesh-1' } }] }
    ]
  }];

  remapEntityReferences(entities, new Map([
    ['mesh-1', 'mesh-2'],
    ['gun-left', 'gun-left-2'],
    ['ship-1', 'ship-2'],
    ['spawn-1', 'spawn-2']
  ]));

  assert.equal(entities[0].scripts[1].params.body, 'mesh-2');
  assert.equal(entities[0].scripts[1].params.muzzleLeft, 'gun-left-2');
  assert.equal(entities[0].scripts[1].params.other, 5, 'числа не трогаем');
  assert.equal(entities[0].hud.target, 'ship-2');
  assert.equal(entities[0].bot.spawn, 'spawn-2');
  assert.equal(entities[0].spawnId, 'spawn-2');
  assert.equal(entities[0].children[0].scripts[0].params.target, 'mesh-2');
});

test('sanitizePrefabReferences оставляет внутренние ссылки и чистит внешние', () => {
  const entities = [{
    id: 'player',
    scripts: [
      { file: 'weapons.js', params: { body: 'mesh', muzzleLeft: 'gun-outside', note: 'mesh' } }
    ],
    hud: { target: 'menu-outside' },
    bot: { spawn: 'spawn-outside' },
    spawnId: 'spawn-outside',
    children: [
      { id: 'mesh' },
      { id: 'gun', scripts: [{ file: 'rotator.js', params: { target: 'mesh', broken: 'ghost' } }] }
    ]
  }];

  const cleared = sanitizePrefabReferences(entities, {
    sceneIds: new Set(['player', 'mesh', 'gun', 'gun-outside', 'menu-outside', 'spawn-outside']),
    isEntityParam: (file, key) => [
      'weapons.js.body', 'weapons.js.muzzleLeft', 'rotator.js.target', 'rotator.js.broken'
    ].includes(`${file}.${key}`)
  });

  assert.equal(entities[0].scripts[0].params.body, 'mesh', 'внутренняя ссылка остаётся');
  assert.equal(entities[0].scripts[0].params.muzzleLeft, '', 'внешняя ссылка очищена');
  assert.equal(entities[0].scripts[0].params.note, 'mesh', 'обычная строка не тронута');
  assert.equal(entities[0].hud.target, null);
  assert.equal(entities[0].bot.spawn, null);
  assert.equal('spawnId' in entities[0], false);
  assert.equal(entities[0].children[1].scripts[0].params.target, 'mesh');
  assert.equal(entities[0].children[1].scripts[0].params.broken, '', 'мёртвый id очищен');
  assert.ok(cleared.some((item) => item.reason === 'вне префаба'));
  assert.ok(cleared.some((item) => item.reason === 'не найдено'));
});

test('materialId сохраняется только валидным', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'material-test',
    entities: [
      {
        id: 'scene',
        type: 'scene',
        children: [
          { id: 'a', type: 'model', asset: 'shield-model', materialId: 'shield' },
          { id: 'b', type: 'model', asset: 'shield-model', materialId: 'плохой id' }
        ]
      }
    ]
  });

  assert.equal(scene.entities[0].materialId, 'shield');
  assert.equal(scene.entities[1].materialId, null);
});

test('refreshPrefabRoots берёт содержимое префаба, сохраняя id и место', () => {
  const existing = [{
    id: 'ship-1',
    name: 'Старый корабль',
    position: [10, 0, -5],
    rotation: [0, 90, 0],
    scale: [2, 2, 2],
    prefabId: 'player-ship',
    prefabTitle: 'Игрок',
    children: [
      { id: 'ship-mesh', type: 'model', asset: 'corinth' },
      { id: 'gun-left', type: 'empty' }
    ]
  }];

  const incoming = [{
    id: 'ship',
    name: 'Новый корабль',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    children: [
      { id: 'ship-mesh', type: 'model', asset: 'corinth' },
      { id: 'gun-left', type: 'empty' },
      { id: 'gun-right', type: 'empty' }
    ]
  }];

  const result = refreshPrefabRoots(existing, incoming, {
    taken: new Set(['ship-1', 'ship-mesh', 'gun-left'])
  });

  const root = result.entities[0];
  assert.equal(root.id, 'ship-1', 'id корня переиспользован');
  assert.equal(root.name, 'Новый корабль', 'содержимое из префаба');
  assert.deepEqual(root.position, [10, 0, -5], 'место установки не меняется');
  assert.deepEqual(root.rotation, [0, 90, 0]);
  assert.deepEqual(root.scale, [2, 2, 2]);
  assert.deepEqual(root.children.map((child) => child.id), ['ship-mesh', 'gun-left', 'gun-right-1']);
  assert.equal(result.kept, 3);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 0);
  assert.equal(incoming[0].id, 'ship', 'файл префаба не мутируется');
  assert.equal(incoming[0].children[2].id, 'gun-right');
});

test('refreshPrefabRoots перенумеровывает ссылки на узлы префаба', () => {
  const existing = [{ id: 'player-1', children: [{ id: 'mesh-1' }] }];
  const incoming = [{
    id: 'player',
    scripts: [{
      file: 'weapons.js',
      params: { body: 'mesh', muzzleLeft: 'gun-left', muzzleRight: 'gun-right' }
    }],
    children: [
      { id: 'mesh' },
      { id: 'gun-left' },
      { id: 'gun-right' }
    ]
  }];

  // gun-left-1 уже занят другим объектом сцены
  const result = refreshPrefabRoots(existing, incoming, { taken: ['player-1', 'mesh-1', 'gun-left-1'] });
  const root = result.entities[0];
  const params = root.scripts[0].params;

  assert.equal(root.id, 'player-1');
  assert.equal(root.children[0].id, 'mesh-1');
  assert.equal(root.children[1].id, 'gun-left-2', 'занятый id обойдён');
  assert.equal(root.children[2].id, 'gun-right-1');
  assert.equal(params.body, 'mesh-1', 'ссылка на существующий узел');
  assert.equal(params.muzzleLeft, 'gun-left-2', 'ссылка на новый узел');
  assert.equal(params.muzzleRight, 'gun-right-1');
  assert.equal(result.added, 2);
});

test('refreshPrefabRoots убирает узлы, которых больше нет в префабе', () => {
  const existing = [{
    id: 'station-1',
    position: [0, 0, 0],
    children: [
      { id: 'hull-1' },
      { id: 'extra-1', children: [{ id: 'legacy-1' }] }
    ]
  }];
  const incoming = [{ id: 'station', children: [{ id: 'hull' }] }];

  const result = refreshPrefabRoots(existing, incoming, {
    taken: ['station-1', 'hull-1', 'extra-1', 'legacy-1']
  });

  assert.deepEqual(result.entities[0].children.map((child) => child.id), ['hull-1']);
  assert.equal(result.kept, 2);
  assert.equal(result.added, 0);
  assert.equal(result.removed, 2, 'лишние узлы посчитаны');
});

test('refreshPrefabRoots берёт трансформ префаба, если корень сменил тип', () => {
  const existing = [{
    id: 'station-1',
    type: 'model',
    position: [0, 0, -306.911],
    rotation: [0, 45, 0],
    scale: [0.2, 0.2, 0.2]
  }];
  const incoming = [{
    id: 'station',
    type: 'empty',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    children: [{ id: 'hull', type: 'model', position: [0, 0, -130], scale: [0.2, 0.2, 0.2] }]
  }];

  const result = refreshPrefabRoots(existing, incoming, { taken: ['station-1'] });
  const root = result.entities[0];

  assert.equal(root.id, 'station-1');
  assert.deepEqual(root.position, [0, 0, -306.911], 'место установки остаётся');
  assert.deepEqual(root.rotation, [0, 0, 0], 'поворот из префаба');
  assert.equal(root.scale, 1, 'масштаб не применяется дважды');
});

test('ссылка сцены на курсор сохраняется в корне', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'cursor-link',
    entities: [{
      id: 'scene',
      type: 'scene',
      cursor: 'reticle-cursor-1',
      children: [{ id: 'reticle-cursor-1', type: 'reticle', reticle: { size: 24 } }]
    }]
  });

  assert.equal(scene.cursor, 'reticle-cursor-1');
  assert.equal(scene.scene.cursor, 'reticle-cursor-1');

  const empty = normalizeScene({
    version: 1,
    id: 'no-cursor',
    entities: [{ id: 'scene', type: 'scene', children: [] }]
  });
  assert.equal(empty.cursor, null, 'без ссылки — системный указатель');
});

test('скрипт сцены задаёт фон, HUD, загрузку и курсор', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'scripted',
    entities: [{
      id: 'scene',
      type: 'scene',
      scripts: [{
        file: 'first-screen.js',
        params: {
          background: '#102030',
          hudStyle: 'hud/style.css',
          loadingFile: 'hud/loading.html',
          loadingScript: 'scripts/loading.js',
          cursor: 'reticle-cursor-1'
        }
      }],
      children: [{ id: 'reticle-cursor-1', type: 'reticle' }]
    }]
  });

  assert.equal(scene.scripts.length, 1);
  assert.equal(scene.scripts[0].file, 'first-screen.js');
  assert.equal(scene.background, '#102030');
  assert.equal(scene.scene.hudStyle, 'hud/style.css');
  assert.equal(scene.scene.loading.file, 'hud/loading.html');
  assert.equal(scene.scene.loading.script, 'scripts/loading.js');
  assert.equal(scene.cursor, 'reticle-cursor-1');
});

test('без скрипта сцены список scripts пуст', () => {
  const scene = normalizeScene({
    version: 1,
    id: 'no-script',
    entities: [{ id: 'scene', type: 'scene', children: [] }]
  });

  assert.deepEqual(scene.scripts, []);
});
