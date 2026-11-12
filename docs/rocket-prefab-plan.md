# План: ракеты через префабы — меш и коллизии

Документ описывает перевод ракеты с процедурного эффекта `effects.rocket`
на префаб с настоящим мешем и физической проверкой попадания, а затем —
на пул переиспользуемых экземпляров для стрельбы.

Статус: реализовано (шаги 1–5); шаг 6 — редактирование `projectile` в инспекторе — не сделан,
блок правится в JSON префаба. Тело в префабе оставлено для редактора модели: рантайм
снаряда его не создаёт. Процедурный путь удалён: модель ракеты в `main.js`, примитив
`effects.rocket` и ветка отрисовки больше не существуют.

---

## 1. Цель

1. Ракета — обычная сущность сцены из префаба `public/prefabs/rocket.json`,
   а не примитив, который рисует `main.js` в ветке `effects.byType('rocket')`.
2. Попадание определяется свипом сферы по отрезку кадра, а не «пролетел мимо».
3. После первого рабочего выстрела — пул на 8–16 экземпляров без создания
   сущностей в рантайме.

Что НЕ входит в этот план: урон по HP, звук, самонаведение, взрывы с осколками.
Для них оставлены точки расширения.

---

## 2. Что уже есть

| Компонент | Файл | Что даёт |
|---|---|---|
| Меш ракеты | `public/models/rocket.json`, `rocket.mesh.bin` | 4 группы, 152 треугольника |
| Коллайдер | `public/models/rocket.physics.json` | compound, 7 боксов, заполнение 100% |
| Префаб | `public/prefabs/rocket.json` | корень `empty` + `rocket-mesh` + тело |
| Сборка префаба | `buildScene(gl, scene, { effects })` | сущности из JSON, ассеты из кэша |
| Тела | `attachBodies(flat, physics)` | `physics.addBody` по мировым матрицам |
| Эффекты | `EffectSystem.registerEntity/unregisterEntity` | auto-слоты, привязка к сущности |
| id | `reassignIds(entities, nextId)` в `scene.js` | переименование поддерева |
| Формы | `public/js/physics/shapes.js` | `getWorldSpheres`, `getWorldBoxes`, `boundingRadius` |

Чего нет:

- функции «создать поддерево префаба в рантайме»;
- sweep/raycast в `physics` (есть только `step` и событие `impact`);
- `mount/unmount` эффектов для поддерева (сейчас `registerEntity` сразу играет `auto`);
- пула и статистики.

---

## 3. Решение по физике ракеты

**Кинематическая ракета без `body`.**

Причины:

- скорость 95 м/с при радиусе ~0.4 м за кадр 16 мс проходит 1.5 м — обычное
  дискретное тело проскакивает тонкие стены и обшивку;
- импульс цели всё равно выдаётся точечно в момент попадания;
- пул с динамическими телами требует remove/add и сброса скоростей;
- кинематику можно тестировать headless без `gl`.

Динамический вариант (`body: { kind: 'dynamic' }` в префабе) остаётся
допустимым, но не используется для ракеты по умолчанию.

---

## 4. Формат данных

### 4.1. Префаб ракеты

```json
{
  "version": 1,
  "id": "rocket",
  "title": "Ракета",
  "entities": [
    {
      "id": "rocket",
      "type": "empty",
      "name": "Ракета",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": 1,
      "tags": ["projectile", "rocket"],
      "projectile": {
        "speed": 95,
        "life": 6,
        "radius": 0.42,
        "turnRate": 0,
        "damage": 25,
        "impact": "impact-spark",
        "trail": "smoke-trail"
      },
      "children": [
        {
          "id": "rocket-mesh",
          "type": "model",
          "name": "Корпус",
          "asset": "rocket",
          "position": [0, 0, 0],
          "rotation": [0, 0, 0],
          "scale": 1
        }
      ]
    }
  ]
}
```

Правила:

- `projectile` живёт только на корне префаба; у детей игнорируется;
- `radius` — радиус свип-сферы в локальных единицах модели (масштаб корня
  применяется при спавне);
- `impact`/`trail` — id ассетов из `public/effects/*.effect.json`, могут быть `null`;
- тело у корня отсутствует; если оно есть, рантайм его не создаёт для снаряда.

### 4.2. Нормализация

`prefabProjectile(raw)` в `public/js/prefabs.js`:

| Поле | Тип | Дефолт | Ограничение |
|---|---|---|---|
| `speed` | number | 95 | 10…1000 |
| `life` | number | 6 | 0.5…30 |
| `radius` | number | 0.4 | 0.05…5 |
| `turnRate` | number | 0 | 0…20 рад/с |
| `damage` | number | 0 | ≥ 0 |
| `impact` | string \| null | `null` | id эффекта |
| `trail` | string \| null | `null` | id эффекта |

---

## 5. Архитектура

| Модуль | Зависимости | Назначение |
|---|---|---|
| `public/js/prefabs.js` | нет (headless) | клон префаба, `reassignIds`, трансформ, нормализация `projectile` |
| `public/js/prefab-runtime.js` | `buildScene`, `attachBodies`, `EffectSystem` | `spawn(id, transform)` / `despawn(root)` в рантайме |
| `public/js/projectiles.js` | `physics/shapes.js` | полёт, substep, sweep, попадания, срок жизни |
| `public/js/projectile-pool.js` | `projectiles.js`, `prefab-runtime.js` | прогрев, `acquire/release`, статистика |

Правило: `prefabs.js`, `projectiles.js`, `projectile-pool.js` не трогают
`window`, `document` и WebGL — только `node --test`.

---

## 6. Меш ракеты в рантайме

### 6.1. Спавн

```js
const runtime = createPrefabRuntime({ gl, physics, effects, entities: sceneEntities });

const root = await runtime.spawn('rocket', {
  position: muzzle,
  rotation: eulerToQuat(aimRotation),
  scale: 1,
  idPrefix: 'rocket-7'
});
```

Внутри:

1. `loadPrefab('rocket')` → `GET /api/prefab/rocket`, кэш `Map` в рантайме;
2. `preparePrefab(doc, transform)` — глубокий клон, `reassignIds` с префиксом,
   сдвиг корней в точку спавна;
3. `buildScene(gl, { entities: prepared }, { effects: null })` — без авто-эффектов;
4. `attachBodies(newEntities, physics)` — если у детей есть тела (у ракеты нет);
5. `entities.push(...newEntities)`, `updateMatrices(newEntities)`;
6. `effects.mount(root)` — привязка слотов, но без `play`, если экземпляр из пула.

Ассеты кэшируются в `loadAsset`, поэтому повторный спавн не перечитывает
`rocket.mesh.bin`.

### 6.2. Ориентация

Модель ракеты смотрит вдоль **+Z** (нос в `+Z`, сопло в `-Z`), поэтому
кватернион строится из направления:

```js
const rotation = quatFromDirection(direction, [0, 0, 1]);
```

Функция добавляется в `scene.js` (или локально в `projectiles.js`), чтобы
не дублировать `lookAt` в скриптах.

### 6.3. Деспавн

```js
runtime.despawn(root);
```

Порядок: `effects.unmount(root)` → `physics.removeBody` для каждого
`entity.body` → удаление из общего массива `sceneEntities` → очистка
`__effectsRegistered`, `body.ignores`.

### 6.4. Отрисовка

После перехода ветка `rocketModel`/`effects.byType('rocket')` в `main.js`
остаётся только как fallback, если префаб не загрузился. Основной путь —
обычная отрисовка сущностей `sceneEntities` с `entity.model`.

---

## 7. Коллизии: sweep-сфера

### 7.1. Почему свип

За кадр при 60 FPS ракета проходит ~1.6 м. Проверка «точка внутри объёма»
даёт туннелирование. Свип по отрезку `prev → next` ловит пересечение даже
с тонкой стенкой.

### 7.2. Подшаги

```js
const stepLen = Math.hypot(dx, dy, dz) * dt;
const substeps = Math.max(1, Math.ceil(stepLen / (radius * 0.5)));
```

Дробим шаг так, чтобы смещение на подшаг не превышало полрадиуса. Это
заодно ограничивает «прыжок сквозь» два тонких объекта подряд.

### 7.3. Широкая фаза

Для каждого тела сцены:

```js
const reach = radius + body.boundingRadius;
const dist = distancePointToSegment(body.position, prev, next);
if (dist > reach) continue;
```

`distancePointToSegment` — 10 строк, без зависимостей. Отсекает почти все
тела до точной проверки.

### 7.4. Точная проверка

Используем уже готовые функции `getWorldSpheres(body)` и `getWorldBoxes(body)`
из `public/js/physics/shapes.js`.

**Отрезок vs сфера** (`c`, `r`):

```js
const m = sub(prev, c);
const d = sub(next, prev);
const a = dot(d, d);
const b = dot(m, d);
const cc = dot(m, m) - (r + radius) ** 2;
const disc = b * b - a * cc;
if (disc < 0 || a === 0) return null;
const t = (-b - Math.sqrt(disc)) / a;
if (t < 0 || t > 1) return null;
return { t, point: add(prev, scale(d, t)) };
```

**Отрезок vs OBB** (`center`, `halfExtents`, `quaternion`):

1. перевести `prev` и `next` в локальные координаты бокса:
   `local = rotateInverse(q, p - center)`;
2. расширить полуразмеры на радиус сферы: `he + radius` (консервативно на
   углах, для снаряда допустимо);
3. slab-тест по трём осям, получить `tmin`, `tmax`;
4. попадание, если `tmin <= tmax` и `tmin ∈ [0, 1]`;
5. точка — в локальных координатах, обратно в мир через `center + rotate(q, p)`.

Из всех кандидатов берётся минимальный `t`.

### 7.5. Кого игнорировать

- сам `owner` (корпус стрелка) и его дети;
- тела, которые уже в `owner.body.ignores`;
- сущности с `raw.trigger` (зоны);
- `visible === false`;
- тела без коллайдера (`shape === null`).

### 7.6. Попадание

```js
onImpact({
  projectile,        // экземпляр
  body,              // тело цели
  entity,            // сущность цели (body.userData.entity)
  point: [x, y, z],
  normal: [x, y, z],
  speed,             // скорость сближения
  distance           // пройдено до попадания
});
```

Действия по умолчанию:

1. `effects.spawn(projectile.impact, { position: point, normal, intensity: speed })`;
2. `body.applyImpulse(scale(direction, impulse))`, если `impulse > 0`;
3. `release()` экземпляра в пул.

Попадание обрабатывается ровно один раз: после `t` экземпляр помечается
`dead` и больше не проверяется.

### 7.7. Истечение

`age >= life` → тихий `release()` без эффекта. Отдельно — выход за
`maxDistance` (по умолчанию 5000), чтобы не считать свип по пустой сцене.

---

## 8. Пул

### 8.1. Состояния экземпляра

```
free → active → dead → free
```

| Поле | free | active |
|---|---|---|
| `root.visible` | `false` | `true` |
| `root.raw.visible` | `false` | `true` |
| `effects` | `unmount` | `mount` + `play(trail)` |
| `body` | нет (кинематика) | нет |
| `age`, `position`, `direction` | сброшены | живые |

### 8.2. Прогрев

```js
const pool = createProjectilePool({ prefab: 'rocket', size: 12, runtime, effects, entities });
await pool.prewarm();
```

`prewarm` создаёт экземпляры с `visible: false` через `spawn({ visible: false })`.
`buildScene` по умолчанию пропускает `visible: false`, поэтому нужен опцион
`includeHidden: true` — он уже есть в `buildScene`.

### 8.3. Эффекты спящих

`EffectSystem.registerEntity` сразу играет `trigger: 'auto'`. Для пула нужно:

- `registerEntity(entity, { autoplay = true })`;
- `mount(root)` / `unmount(root)` — обход поддерева, `unregisterEntity` для каждого узла;
- при `acquire`: `mount(root)` + `play(trail)`;
- при `release`: `unmount(root)` — трейл гаснет вместе с инстансами.

Иначе двенадцать спящих ракет будут дымить в точке прогрева.

### 8.4. Переиспользование

`acquire()` берёт из очереди `free`; если пусто — либо `null` (отказ,
кулдаун не сбрасывается), либо рост до `max` (по умолчанию 16). Политику
задаём опцией `overflow: 'reject' | 'grow'`.

### 8.5. Статистика

```js
pool.stats() // { size, free, active, created, rejected }
```

Выводится в `window.__galaxy.projectiles.stats()` для отладки.

---

## 9. Интеграция

### 9.1. `main.js`

```js
const prefabRuntime = createPrefabRuntime({ gl, physics, effects, entities: sceneEntities });
const projectiles = createProjectileSystem({
  runtime: prefabRuntime,
  physics,
  effects,
  entities: sceneEntities,
  pool: { prefab: 'rocket', size: 12 }
});
await projectiles.prewarm();
```

Порядок в кадре: `physics.step` → `projectiles.update(dt)` → `effects.update(dt)`.

### 9.2. `script-runtime.js`

```js
ctx.api.spawnPrefab(id, transform)
ctx.api.despawnPrefab(entityOrId)
ctx.api.projectiles.fire({ prefab, from, direction, speed, life })
ctx.api.projectiles.stats()
```

### 9.3. `weapons.js`

`spawnRocket` заменяется на:

```js
ctx.api.projectiles.fire({
  prefab: ctx.params.rocketPrefab || 'rocket',
  from: origin,
  direction,
  speed: number(ctx.params.rocketSpeed, 95, 10, 1000),
  life: number(ctx.params.rocketLife, 6, 0.5, 30)
});
```

`updateRockets` и `ctx.state.rockets` удаляются. Если `ctx.api.projectiles`
нет — работает старый путь через `effects.rocket`.

---

## 10. Тесты

| Файл | Проверки |
|---|---|
| `tests/prefabs.test.mjs` | клон не мутирует исходник; id уникальны; трансформ применён; дефолты `projectile`; отрицательные значения клампятся |
| `tests/projectiles.test.mjs` | полёт по прямой; попадание в сферу; попадание в бокс под углом; промах; `owner` игнорируется; одно попадание на экземпляр; истечение `life`; substep не перепрыгивает стену |
| `tests/projectile-pool.test.mjs` | `prewarm` создаёт N; `acquire/release` не создаёт новых; повторный `acquire` после `release` чистый; `overflow: reject`; статистика |
| `tests/vfx-runtime.test.mjs` | `mount/unmount` не запускает auto у спящих; трейл останавливается при `release` |

Headless: `buildScene` не вызывается, `prefab-runtime` тестируется с заглушкой
`gl` только в браузерной проверке. Логика свипа и пула — чистые функции.

Обязательно: `node --check` по всем изменённым файлам, полный `npm test`.

---

## 11. Ручная проверка

1. `editor.html?prefab=rocket` — в префабе корень + `rocket-mesh`, тело
   отсутствует, `projectile` виден в инспекторе.
2. Игра, выстрел ракетой: виден меш, дымовой след, искры в точке попадания.
3. Выстрел в `corinth-cargo-ship`: попадание в обшивку, не пролёт насквозь.
4. Выстрел в пустоту: исчезновение через `life`, без искр.
5. 200 выстрелов подряд: `stats().created` не растёт после прогрева,
   `sceneEntities.length` стабилен.
6. Спящие ракеты не дымят в точке прогрева.

---

## 12. Риски

| Риск | Мера |
|---|---|
| `buildScene` на выстрел даёт рывок | прогрев пула; `spawn` только при исчерпании |
| авто-эффекты у спящих | `mount/unmount`, `autoplay: false` |
| id-коллизии | префикс `rocket-<n>` + `uniqueIdFrom` |
| sweep по compound дорогой | широкая фаза по `boundingRadius`, лимит тел |
| ложные попадания в углах OBB | расширение полуразмеров; при необходимости — точный тест «сфера vs OBB» |
| старые сцены без префаба | предупреждение в консоли, выстрела нет — одна дорога без развилки |
| утечка тел при `despawn` | обязательный `physics.removeBody` + тест на `physics.bodies.length` |

---

## 13. Порядок работ

| Шаг | Что | Результат |
|---|---|---|
| 1 | `prefabs.js` + тесты | клон, id, трансформ, `projectile` |
| 2 | `prefab-runtime.js` | `spawn`/`despawn`, видимая ракета в игре |
| 3 | `projectiles.js` + тесты | полёт, свип, попадание, искры |
| 4 | `projectile-pool.js` + `mount/unmount` | 12 ракет без аллокаций |
| 5 | `weapons.js`, `script-runtime.js` | выстрел из игры |
| 6 | инспектор префаба, docs | `projectile` редактируется в редакторе |

Оценка: 5 рабочих дней. Шаги 1 и 3 независимы, шаг 4 требует 2 и 3.

---

## 14. Чек-лист готовности

- [x] ракета в игре — сущность из префаба с мешем `rocket`
- [x] процедурный путь (`effects.rocket`, модель ракеты в `main.js`) удалён
- [x] попадание определяется свипом, а не расстоянием по кадру
- [x] попадание срабатывает один раз и даёт точку и нормаль
- [x] пул не создаёт сущности после прогрева
- [x] спящие ракеты не запускают эффекты
- [x] `npm test` зелёный, `node --check` чистый
- [x] `docs/scenes.md`, `docs/architecture.md`, README обновлены
