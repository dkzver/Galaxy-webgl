# План: пулемётная очередь через префабы — пуля с мешем и свип-коллизия

Перевод пулемёта с покадровых трассеров-эффектов (`effects.tracer`) на
префаб пули с настоящим мешем, очередью как отдельной headless-логикой
и пулом экземпляров.

Статус: план, не реализовано. Опирается на `docs/rocket-prefab-plan.md`
(общие модули `prefabs.js`, `prefab-runtime.js`, `projectile-pool.js`).

---

## 1. Цель

1. Каждый выстрел очереди — экземпляр префаба `bullet` с мешем, а не
   отрезок, который рисует `main.js` по `effects.byType('tracer')`.
2. Попадание определяется геометрией сцены, а не точкой прицела.
3. Очередь (25 выстрелов с интервалом 0.2 с) — отдельный модуль без DOM,
   покрытый тестами.
4. Пул на 32 экземпляра: после прогрева выстрелы не создают сущностей.

Вне плана: урон по HP, звук, гильзы, отдача, разброс. Для них оставлены
точки расширения.

---

## 2. Текущее состояние

| Что | Где | Значение |
|---|---|---|
| Режим | `WEAPONS` в `public/scripts/weapons.js` | `machinegun`, `mode: 'burst'` |
| Очередь | `fire()` / `updateBurst()` | 25 выстрелов, интервал 0.2 с, перезарядка 0.8 с |
| Скорость | `mgSpeed` | 650 м/с |
| Жизнь | `mgLife` | 1.2 с (дальность 780 м) |
| Визуал | `spawnTracer` / `updateTracers` | отрезок `effects.tracer` + дым каждые 0.03 с |
| Попадание | `tracer.targetDistance` | расстояние до точки прицела, геометрия не проверяется |
| Точки выстрела | `muzzleLeft` / `muzzleRight` | чередуются |

Проблемы текущего подхода:

- трассер — эффект с `ttl 0.06`, а не объект: его нельзя заморозить, покрасить
  иначе или привязать к пулу;
- попадание не учитывает препятствия: пуля «пролетает» сквозь астероид,
  если прицел дальше;
- на каждый выстрел создаётся дымовой инстанс с уникальным id — при 25
  выстрелах это десятки записей в `Map` эффектов;
- 650 м/с — это 10.8 м за кадр 60 FPS, дискретная проверка неприменима.

---

## 3. Решение по коллизии: свип отрезком за кадр

Первая версия плана предлагала hitscan в момент выстрела: попадание
считается сразу, а визуальный снаряд летит отдельно. У этого ровно тот
дефект, который виден на практике: цель успевает уйти, искры играют
в пустоте, «долёт» происходит уже в другую точку.

Правильный вариант — **снаряд действительно летит**, а каждый кадр
проверяется не точка, а весь пройденный за кадр отрезок `prev → next`
толщиной `radius`.

| Подход | Что происходит | Проблема |
|---|---|---|
| Hitscan в момент выстрела | попадание мгновенно, визуал отдельно | искры и урон расходятся с положением цели |
| Подшаги по точкам | 72 проверки на пулю за кадр | дорого и не нужно |
| **Свип отрезком за кадр** | пуля летит, отрезок покрывает весь путь | **выбрано** |

Почему это дешёво и точно:

- за кадр 60 FPS пуля проходит 10.8 м, но отрезок проверяется **одним**
  тестом, а не 72 точками — туннелирования нет по построению;
- попадание фиксируется в том кадре, когда отрезок реально пересёк цель,
  по её фактическому положению в этот момент;
- упреждение не нужно: стрелок целится сам, игра считает честно;
- стоимость — один тест отрезка на пулю за кадр: 25 пуль × ~10 тел
  после широкой фазы.

Остаётся один пограничный случай: цель, пересекающая трассу между
кадрами (пуля прошла 10.8 м, цель сместилась 0.8 м). Лечится опцией
`relativeSweep`: отрезок расширяется на перемещение цели за кадр
(`velocity * dt`). Включаем, если появятся быстрые цели.

---

## 4. Данные

### 4.1. Ассет пули

Новый `tools/build-bullet.mjs` по образцу `tools/build-rocket.mjs`:

- корпус — цилиндр радиусом 0.06, длиной 0.5, ось `+Z`;
- нос — конус/клин 0.15;
- материал — emissive `#ffb066`, чтобы пуля была видна без освещения;
- результат: `public/models/bullet.json` + `bullet.mesh.bin`;
- `bullet.physics.json` не нужен: у пули нет тела.

Ориентация: нос в `+Z`, как у ракеты, — одна функция `quatFromDirection`.

### 4.2. Префаб пули

`public/prefabs/bullet.json`:

```json
{
  "version": 1,
  "id": "bullet",
  "title": "Пуля",
  "entities": [
    {
      "id": "bullet",
      "type": "empty",
      "name": "Пуля",
      "position": [0, 0, 0],
      "rotation": [0, 0, 0],
      "scale": 1,
      "tags": ["projectile", "bullet"],
      "projectile": {
        "mode": "sweep",
        "speed": 650,
        "life": 1.2,
        "radius": 0.12,
        "maxDistance": 780,
        "impact": "impact-spark",
        "muzzle": "muzzle-flash",
        "trail": null
      },
      "children": [
        {
          "id": "bullet-mesh",
          "type": "model",
          "name": "Трассер",
          "asset": "bullet",
          "position": [0, 0, 0],
          "rotation": [0, 0, 0],
          "scale": 1
        }
      ]
    }
  ]
}
```

### 4.3. Поля `projectile`

| Поле | Дефолт | Смысл |
|---|---|---|
| `mode` | `sweep` | `sweep` — свип отрезком (по умолчанию); `hitscan` — только для мгновенных лазеров |
| `speed` | 650 | скорость визуального полёта, м/с |
| `life` | 1.2 | предел жизни, с |
| `radius` | 0.12 | толщина свип-отрезка |
| `maxDistance` | `speed * life` | предел полёта, м |
| `impact` | `null` | id эффекта попадания |
| `muzzle` | `null` | id вспышки у дула |
| `trail` | `null` | id шлейфа (для пули обычно `null`) |

Нормализация — та же `prefabProjectile(raw)` из `public/js/prefabs.js`,
дополненная полем `mode`.

---

## 5. Архитектура

| Модуль | Зависимости | Назначение |
|---|---|---|
| `public/js/prefabs.js` | нет | клон префаба, `reassignIds`, `prefabProjectile` (общий с ракетой) |
| `public/js/prefab-runtime.js` | `buildScene`, `attachBodies` | `spawn` / `despawn` (общий с ракетой) |
| `public/js/sweep.js` | `physics/shapes.js` | отрезок vs сфера/OBB, ближайшее `t`, нормаль |
| `public/js/burst-fire.js` | нет | очередь: старт, тик, отмена, перезарядка |
| `public/js/projectile-pool.js` | `prefab-runtime` | пул визуальных экземпляров |

`sweep.js` и `burst-fire.js` не трогают `window`, `document` и WebGL —
проверяются `node --test`.

---

## 6. Очередь выстрелов

### 6.1. API

```js
import { createBurstQueue } from '../js/burst-fire.js';

const burst = createBurstQueue({ count: 25, interval: 0.2, cooldown: 0.8 });

burst.start();                     // true, если очередь началась
const shots = burst.update(dt, { blocked: false }); // сколько выстрелов в этом кадре
burst.cancel();                    // сброс без перезарядки
burst.state;                       // { remaining, total, cooldown, timer, active }
```

### 6.2. Поведение

- первый выстрел — сразу в `start()`, дальше каждые `interval`;
- `update` возвращает число выстрелов; при `dt = 0.5` и интервале 0.05
  вернёт несколько — очередь не «теряет» темп при просадке FPS;
- `blocked` (открыто меню) — очередь отменяется, как сейчас в `updateBurst`;
- после последнего выстрела ставится `cooldown`;
- повторный `start()` при активной очереди или `cooldown > 0` — `false`.

### 6.3. Почему отдельный модуль

Сейчас логика размазана между `fire()` и `updateBurst()`, а состояние
(`burstRemaining`, `burstTimer`, `burstTotal`) лежит в `ctx.state`.
Модуль делает её тестируемой и переиспользуемой для турелей/ботов.

---

## 7. Коллизия отрезком

### 7.1. Вход

```js
traceSegment(prev, next, { radius, physics, ignore })
```

- `prev` — позиция на прошлом кадре;
- `next` — позиция в этом кадре (`prev + direction * speed * dt`);
- `radius` — толщина;
- `ignore` — `Set` тел: корпус стрелка, его дети, `body.ignores`.

### 7.2. Широкая фаза

```js
const reach = radius + body.boundingRadius;
if (distancePointToSegment(body.position, prev, next) > reach) continue;
```

### 7.3. Точная проверка

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
```

**Отрезок vs OBB** (`center`, `halfExtents`, `quaternion`):

1. перевод в локальные координаты: `local = rotateInverse(q, prev - center)`,
   `localDir = rotateInverse(q, next - prev)`;
2. расширить полуразмеры на `radius`;
3. slab-тест по трём осям → `tmin`, `tmax`;
4. попадание, если `tmin <= tmax` и `tmin ∈ [0, 1]`;
5. нормаль — ось slab с максимальным вкладом, обратно в мир.

Собираем всех кандидатов, берём минимальный `t`.

### 7.4. Игнор

- `owner` и всё его поддерево;
- тела из `owner.body.ignores`;
- сущности с `raw.trigger`;
- `visible === false`;
- тела без `shape`.

### 7.5. Результат

```js
{ body, entity, point: [x, y, z], normal: [x, y, z], distance, t }
```

Если попаданий нет — `null`, и визуал летит на `maxDistance`.

---

## 8. Пул

### 8.1. Размер

```js
size = clamp(ceil(life / interval) + 2, 8, 64)
```

Для дефолтов: `ceil(1.2 / 0.2) + 2 = 8` одновременно в полёте,
пул по умолчанию 32 — с запасом на несколько очередей и смену параметров.

Политика при исчерпании: `overflow: 'reject'` (выстрел не создаётся,
кулдаун не сбрасывается) либо `'grow'` до 64.

### 8.2. Жизненный цикл

```
free → active (снаряд летит) → hit → free
```

- `acquire()`: `visible = true`, сброс `position/quaternion`, `effects.mount`;
- `release()`: `effects.unmount`, `visible = false`, возврат в очередь;
- экземпляры создаются заранее с `visible: false` и `includeHidden: true`.

Требование к `EffectSystem` (из плана ракеты): `mount/unmount` поддерева
и `registerEntity(entity, { autoplay: false })`, иначе спящие пули будут
запускать `muzzle`/`impact` при прогреве.

### 8.3. Статистика

```js
pool.stats() // { size, free, active, created, rejected }
```

---

## 9. Интеграция

### 9.1. `weapons.js`

```js
if (weapon.mode === 'burst') {
  if (!ctx.api.projectiles?.burst.start()) return;
}
```

`updateBurst` заменяется на:

```js
const shots = ctx.state.burst.update(dt, { blocked });
for (let i = 0; i < shots; i++) {
  const origin = this.muzzle(ctx);
  const direction = normalize(sub(this.target(ctx), origin));
  ctx.api.projectiles.fire({
    prefab: ctx.params.bulletPrefab || 'bullet',
    from: origin,
    direction
  });
}
```

`spawnTracer` / `updateTracers` / `ctx.state.tracers` удаляются.
Если `ctx.api.projectiles` нет — остаётся старый путь `effects.tracer`
(одна ветка, без дублирования очереди).

### 9.2. `main.js`

```js
const projectiles = createProjectileSystem({ ... });
await projectiles.prewarm('bullet', 32);
```

Порядок в кадре: `physics.step` → `projectiles.update(dt)` → `effects.update(dt)`.

### 9.3. `script-runtime.js`

```js
ctx.api.projectiles.fire({ prefab, from, direction, mode })
ctx.api.projectiles.burst(count, interval)   // опционально, для ботов
ctx.api.projectiles.stats()
```

### 9.4. HUD

`weapon-status` при активной очереди показывает `ОЧЕРЕДЬ 12/25`,
после — `ПЕРЕЗАРЯДКА`. Значения берутся из `burst.state`.

---

## 10. Тесты

| Файл | Проверки |
|---|---|
| `tests/burst-fire.test.mjs` | 25 выстрелов за 5 с; первый сразу; интервал соблюдён; `dt = 0.5` даёт пачку; `blocked` отменяет; кулдаун после последнего; повторный `start` отклонён; `cancel` |
| `tests/sweep.test.mjs` | отрезок в сферу; в OBB под углом; промах; ближайшее из двух; игнор `owner`; нормаль смотрит наружу; толщина; попадание в движущуюся цель по её фактическому положению |
| `tests/prefabs.test.mjs` | `mode: 'sweep'` нормализуется; `maxDistance` по умолчанию = `speed * life` |
| `tests/projectile-pool.test.mjs` | прогрев 32; после 100 выстрелов `created` не растёт; `release` очищает визуал; `overflow: reject` |
| `tests/vfx-runtime.test.mjs` | `mount/unmount` не играет `muzzle` у спящих |

Headless: `sweep.js` и `burst-fire.js` тестируются без `gl`; пул — с
заглушкой рантайма.

---

## 11. Ручная проверка

1. `editor.html?prefab=bullet` — корень + `bullet-mesh`, блок `projectile`.
2. Очередь 25 выстрелов: ровно 25 пуль, темп 5 в секунду, перезарядка 0.8 с.
3. Стрельба по астероиду: искры на поверхности, пуля не проходит насквозь.
4. Стрельба по движущемуся боту: искры на корпусе в момент попадания,
   а не в точке, где он был на выстреле.
5. Стрельба по пустоте: пули гаснут на 780 м, искр нет.
6. Меню (`hud-menu`) посреди очереди: очередь прекращается.
7. 10 очередей подряд: `stats().created` не растёт, `sceneEntities.length` стабилен.
8. FPS не просел относительно текущего трассера.

---

## 12. Риски

| Риск | Мера |
|---|---|
| 25 экземпляров префаба на очередь | пул, прогрев, `includeHidden` |
| отрезок «толстый» и цепляет соседние детали | радиус 0.12, при необходимости — точный тест сферы |
| цель пересекает трассу между кадрами | опция `relativeSweep`: расширить отрезок на `velocity * dt` |
| пуля за кадр проходит 10.8 м и визуально «мигает» | растягивать меш по отрезку или держать 1–2 кадра |
| очередь теряет темп при просадке FPS | `update` возвращает несколько выстрелов за кадр |
| спящие пули играют `muzzle` | `mount/unmount` + `autoplay: false` |
| старые сцены без префаба | fallback на `effects.tracer` |

---

## 13. Порядок работ

| Шаг | Что | Результат |
|---|---|---|
| 1 | `build-bullet.mjs` + `bullet.json` + префаб | ассет и префаб в редакторе |
| 2 | `burst-fire.js` + тесты | очередь без DOM |
| 3 | `sweep.js` + тесты | отрезок, попадания, нормали |
| 4 | пул + `mount/unmount` | 32 пули без аллокаций |
| 5 | `projectiles.fire`, интеграция в `weapons.js` | выстрел из игры |
| 6 | HUD, docs, инспектор `projectile` | очередь видна и настраивается |

Оценка: 4 рабочих дня. Шаги 2 и 3 независимы; 4 требует 1; 5 требует 2–4.

---

## 14. Чек-лист готовности

- [ ] пуля в игре — сущность из префаба с мешем `bullet`
- [ ] `effects.tracer` остаётся только fallback
- [ ] попадание считается свипом по фактическому положению цели, а не по точке прицела
- [ ] очередь — отдельный модуль с тестами, а не поля в `ctx.state`
- [ ] пул не создаёт сущности после прогрева
- [ ] спящие пули не запускают эффекты
- [ ] `npm test` зелёный, `node --check` чистый
- [ ] `docs/scenes.md`, `docs/architecture.md`, README обновлены
