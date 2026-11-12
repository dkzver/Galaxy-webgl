import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const START_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_ATTEMPTS = 10;
const OPEN_BROWSER = process.argv.includes('--open') || process.env.OPEN === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.obj': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Galaxy-Demo': '1',
    ...headers
  });
  res.end(body);
}

/* ---------------------------- API редактора ------------------------------- */

const SCENES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'scenes');
const PREFABS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'prefabs');
const EFFECTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'effects');
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'scripts');
const MAX_BODY = 32 * 1024 * 1024;

function isLocal(req) {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Тело запроса слишком большое'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function safeId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/i.test(value);
}

async function apiScenes(res) {
  const files = await fs.promises.readdir(SCENES_DIR).catch(() => []);
  const found = new Map();

  // Сценой считается <id>.scene.json или <id>.json (кроме index.json и .bak).
  // Вариант с .scene.json главнее, если лежат оба файла.
  for (const file of files) {
    if (file === 'index.json' || file.endsWith('.bak')) continue;

    let id = null;
    let priority = 0;

    if (file.endsWith('.scene.json')) {
      id = file.slice(0, -'.scene.json'.length);
      priority = 2;
    } else if (file.endsWith('.json')) {
      id = file.slice(0, -'.json'.length);
      priority = 1;
    }

    if (!id) continue;

    const previous = found.get(id);
    if (previous && previous.priority >= priority) continue;

    let title = id;
    try {
      const raw = JSON.parse(await fs.promises.readFile(path.join(SCENES_DIR, file), 'utf8'));
      title = raw.title || id;
    } catch {
      title = `${id} (ошибка JSON)`;
    }

    found.set(id, { id, title, file, priority });
  }

  // index.json задаёт порядок и подписи; записи без файла показываем явно
  let meta = [];
  try {
    const index = JSON.parse(await fs.promises.readFile(path.join(SCENES_DIR, 'index.json'), 'utf8'));
    meta = Array.isArray(index.scenes) ? index.scenes : [];
  } catch {
    meta = [];
  }

  const scenes = [];
  const seen = new Set();

  for (const entry of meta) {
    if (!entry?.id) continue;
    seen.add(entry.id);

    const file = found.get(entry.id);
    scenes.push({
      id: entry.id,
      title: entry.title || file?.title || entry.id,
      description: entry.description || '',
      file: file?.file || null,
      missing: !file
    });
  }

  for (const [id, file] of found) {
    if (seen.has(id)) continue;
    scenes.push({ id, title: file.title, description: '', file: file.file, missing: false });
  }

  return send(res, 200, JSON.stringify({ scenes }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function apiScripts(res) {
  const list = [];

  async function walk(dir, prefix) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
      else if (entry.name.endsWith('.js')) list.push(rel);
    }
  }

  await walk(SCRIPTS_DIR, '');
  list.sort();
  return send(res, 200, JSON.stringify({ scripts: list }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function apiAssets(res) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'models');
  const files = await fs.promises.readdir(dir).catch(() => []);
  const assets = files
    .filter((file) => file.endsWith('.json') && !file.endsWith('.physics.json'))
    .map((file) => file.slice(0, -'.json'.length));

  return send(res, 200, JSON.stringify({ assets }), { 'Content-Type': 'application/json; charset=utf-8' });
}

/* ---------------------------- Модели и их физика -------------------------- */

const MODELS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'models');

function defaultModelPhysics(manifest) {
  const bounds = manifest && manifest.bounds;
  const size = bounds
    ? Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2])
    : 0;
  const radius = Number(manifest && manifest.radius) || size / 2 || 2;

  return {
    kind: 'static',
    mass: 0,
    restitution: 0.55,
    friction: 0.2,
    collider: { shape: 'sphere', radius: Math.max(0.3, radius) }
  };
}

async function apiModel(res, id) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.promises.readFile(path.join(MODELS_DIR, `${id}.json`), 'utf8'));
  } catch {
    return send(res, 404, 'Модель не найдена');
  }

  let physics = null;
  try {
    physics = JSON.parse(await fs.promises.readFile(path.join(MODELS_DIR, `${id}.physics.json`), 'utf8'));
  } catch {
    physics = defaultModelPhysics(manifest);
  }

  const bounds = manifest.bounds || null;
  const size = bounds
    ? [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2]
    ].map((value) => Math.round(value * 100) / 100)
    : null;

  return send(res, 200, JSON.stringify({
    id,
    name: manifest.name || id,
    length: Number(manifest.length) || null,
    radius: Number(manifest.radius) || (size ? Math.max(...size) / 2 : null),
    bounds,
    size,
    groups: Array.isArray(manifest.groups) ? manifest.groups.length : 0,
    physics
  }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function saveModelPhysics(res, id, body) {
  const physics = JSON.parse(body || '{}');
  const collider = physics.collider && typeof physics.collider === 'object' ? physics.collider : {};

  const kind = physics.kind === 'dynamic' ? 'dynamic' : 'static';
  const offsetOf = (value) => (Array.isArray(value) && value.length >= 3
    ? value.slice(0, 3).map((item) => Number(item) || 0)
    : [0, 0, 0]);
  const result = {
    kind,
    mass: kind === 'dynamic' ? Math.max(0.1, Number(physics.mass) || 12) : 0,
    restitution: Math.min(1, Math.max(0, Number(physics.restitution) || 0.55)),
    friction: Math.max(0, Number(physics.friction) || 0.2),
    collider: collider.shape === 'compound'
      ? {
        shape: 'compound',
        spheres: (Array.isArray(collider.spheres) ? collider.spheres : [])
          .map((sphere) => ({
            offset: Array.isArray(sphere?.offset) && sphere.offset.length >= 3
              ? sphere.offset.slice(0, 3).map((value) => Number(value) || 0)
              : [0, 0, 0],
            radius: Math.max(0.01, Number(sphere?.radius) || 1)
          }))
          .slice(0, 32),
        boxes: (Array.isArray(collider.boxes) ? collider.boxes : [])
          .map((box) => ({
            offset: Array.isArray(box?.offset) && box.offset.length >= 3
              ? box.offset.slice(0, 3).map((value) => Number(value) || 0)
              : [0, 0, 0],
            halfExtents: Array.isArray(box?.halfExtents) && box.halfExtents.length >= 3
              ? box.halfExtents.slice(0, 3).map((value) => Math.max(0.01, Math.abs(Number(value) || 1)))
              : [1, 1, 1]
          }))
          .slice(0, 32)
      }
      : collider.shape === 'box'
      ? {
        shape: 'box',
        offset: offsetOf(collider.offset),
        halfExtents: Array.isArray(collider.halfExtents) && collider.halfExtents.length >= 3
          ? collider.halfExtents.slice(0, 3).map((value) => Math.max(0.01, Math.abs(Number(value) || 1)))
          : [1, 1, 1]
      }
      : {
        shape: 'sphere',
        offset: offsetOf(collider.offset),
        radius: Math.max(0.01, Number(collider.radius) || 2)
      }
  };

  await fs.promises.writeFile(
    path.join(MODELS_DIR, `${id}.physics.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
  );

  return send(res, 200, JSON.stringify({ saved: `${id}.physics.json`, physics: result }), {
    'Content-Type': 'application/json; charset=utf-8'
  });
}

async function apiEffects(res) {
  const files = await fs.promises.readdir(EFFECTS_DIR).catch(() => []);
  const effects = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const id = file.endsWith('.effect.json')
      ? file.slice(0, -'.effect.json'.length)
      : file.slice(0, -'.json'.length);
    if (!safeId(id)) continue;

    try {
      const data = JSON.parse(await fs.promises.readFile(path.join(EFFECTS_DIR, file), 'utf8'));
      effects.push({
        id,
        title: data.title || id,
        description: data.description || '',
        duration: Number(data.duration) || 1,
        loop: Boolean(data.loop),
        params: data.params && typeof data.params === 'object' ? data.params : {},
        layers: Array.isArray(data.layers) ? data.layers : []
      });
    } catch {
      effects.push({ id, title: `${id} (ошибка JSON)`, params: {}, layers: [] });
    }
  }

  effects.sort((a, b) => a.id.localeCompare(b.id));
  return send(res, 200, JSON.stringify({ effects }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function findEffectFile(id) {
  for (const file of [`${id}.effect.json`, `${id}.json`]) {
    const full = path.join(EFFECTS_DIR, file);
    try {
      await fs.promises.access(full);
      return full;
    } catch {
      // пробуем следующий вариант
    }
  }
  return null;
}

async function apiEffect(res, id) {
  const file = await findEffectFile(id);
  if (!file) return send(res, 404, 'Эффект не найден');

  try {
    const text = await fs.promises.readFile(file, 'utf8');
    return send(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch {
    return send(res, 404, 'Эффект не найден');
  }
}

async function saveEffect(res, id, body) {
  const parsed = JSON.parse(body || '{}');
  const definition = parsed.effect && typeof parsed.effect === 'object' ? parsed.effect : parsed;

  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    return send(res, 400, 'описание эффекта должно быть объектом');
  }

  const result = {
    ...definition,
    id,
    title: definition.title || id,
    duration: Math.max(0.01, Number(definition.duration) || 1),
    loop: Boolean(definition.loop),
    params: definition.params && typeof definition.params === 'object' ? definition.params : {},
    layers: Array.isArray(definition.layers) ? definition.layers : []
  };

  await fs.promises.mkdir(EFFECTS_DIR, { recursive: true });
  await fs.promises.writeFile(
    path.join(EFFECTS_DIR, `${id}.effect.json`),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
  );

  return send(res, 200, JSON.stringify({ saved: `${id}.effect.json`, effect: result }), {
    'Content-Type': 'application/json; charset=utf-8'
  });
}

async function apiHudFiles(res) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'hud');
  const files = await fs.promises.readdir(dir).catch(() => []);
  const items = files.filter((file) => file.endsWith('.html')).sort().map((file) => `hud/${file}`);

  return send(res, 200, JSON.stringify({ hud: items }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function apiPrefabs(res) {
  const prefabs = [];
  const files = await fs.promises.readdir(PREFABS_DIR).catch(() => []);

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const id = file.slice(0, -'.json'.length);
    let title = id;

    try {
      const data = JSON.parse(await fs.promises.readFile(path.join(PREFABS_DIR, file), 'utf8'));
      title = data.title || id;
    } catch {
      // битый файл показываем по имени — чинить его через редактор
    }

    prefabs.push({ id, title });
  }

  prefabs.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  return send(res, 200, JSON.stringify({ prefabs }), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function sceneFileFor(id) {
  const canonical = path.join(SCENES_DIR, `${id}.scene.json`);

  try {
    await fs.promises.access(canonical);
    return canonical;
  } catch {
    // нет канонического имени — проверим <id>.json
  }

  const plain = path.join(SCENES_DIR, `${id}.json`);
  try {
    await fs.promises.access(plain);
    return plain;
  } catch {
    return null;
  }
}

async function handleApi(req, res, urlPath) {
  if (!isLocal(req)) return send(res, 403, 'Редактор доступен только с этого компьютера');

  if (req.method === 'GET' && urlPath === '/api/scenes') return apiScenes(res);
  if (req.method === 'GET' && urlPath === '/api/scripts') return apiScripts(res);
  if (req.method === 'GET' && urlPath === '/api/assets') return apiAssets(res);
  if (req.method === 'GET' && urlPath === '/api/prefabs') return apiPrefabs(res);
  if (req.method === 'GET' && urlPath === '/api/effects') return apiEffects(res);
  if (req.method === 'GET' && urlPath === '/api/hud') return apiHudFiles(res);

  // Эффекты: JSON-описания в public/effects, доступные редактору
  const effect = urlPath.match(/^\/api\/effect\/([^/]+)$/);
  if (effect && safeId(effect[1])) {
    if (req.method === 'GET') return apiEffect(res, effect[1]);
    if (req.method === 'POST') {
      try {
        return await saveEffect(res, effect[1], await readBody(req));
      } catch (err) {
        return send(res, 400, err.message);
      }
    }
  }

  // Модель: сводка по манифесту и физика ассета (sidecar <id>.physics.json)
  const modelPhysics = urlPath.match(/^\/api\/model\/([^/]+)\/physics$/);
  if (modelPhysics && safeId(modelPhysics[1]) && req.method === 'POST') {
    try {
      return await saveModelPhysics(res, modelPhysics[1], await readBody(req));
    } catch (err) {
      return send(res, 400, err.message);
    }
  }

  const model = urlPath.match(/^\/api\/model\/([^/]+)$/);
  if (model && safeId(model[1]) && req.method === 'GET') return apiModel(res, model[1]);

  // Префабы: сохранённая ветка сцены, которую можно вставить в любую сцену
  const prefab = urlPath.match(/^\/api\/prefab\/([^/]+)$/);
  if (prefab && safeId(prefab[1])) {
    const file = path.join(PREFABS_DIR, `${prefab[1]}.json`);

    if (req.method === 'GET') {
      try {
        const text = await fs.promises.readFile(file, 'utf8');
        return send(res, 200, text, { 'Content-Type': 'application/json; charset=utf-8' });
      } catch {
        return send(res, 404, 'Префаб не найден');
      }
    }

    if (req.method === 'POST') {
      try {
        const parsed = JSON.parse(await readBody(req));
        if (!parsed || !Array.isArray(parsed.entities) || parsed.entities.length === 0) {
          throw new Error('в префабе нет ни одной сущности');
        }

        await fs.promises.mkdir(PREFABS_DIR, { recursive: true });
        await fs.promises.writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

        return send(res, 200, JSON.stringify({ saved: prefab[1] }), {
          'Content-Type': 'application/json; charset=utf-8'
        });
      } catch (err) {
        return send(res, 400, err.message);
      }
    }

    if (req.method === 'DELETE') {
      try {
        await fs.promises.unlink(file);
        return send(res, 200, JSON.stringify({ deleted: prefab[1] }), {
          'Content-Type': 'application/json; charset=utf-8'
        });
      } catch {
        return send(res, 404, 'Префаб не найден');
      }
    }
  }

  const asset = urlPath.match(/^\/api\/asset\/([^/]+)$/);
  if (asset && safeId(asset[1]) && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body?.manifest || typeof body.binBase64 !== 'string') {
        throw new Error('нужны manifest и binBase64');
      }

      const bin = Buffer.from(body.binBase64, 'base64');
      if (!bin.length) throw new Error('пустой бинарник модели');

      const modelsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'models');
      const binFile = path.join(modelsDir, `${asset[1]}.mesh.bin`);
      const manifest = { ...body.manifest, bytes: bin.length };

      // Наборы текстур предыдущей версии этого же ассета — чтобы убрать осиротевшие
      let oldTextures = [];
      try {
        const old = JSON.parse(await fs.promises.readFile(path.join(modelsDir, `${asset[1]}.json`), 'utf8'));
        oldTextures = [...new Set((old.groups || []).map((group) => group.texture).filter(Boolean))];
      } catch {
        oldTextures = [];
      }

      await fs.promises.writeFile(binFile, bin);
      await fs.promises.writeFile(
        path.join(modelsDir, `${asset[1]}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8'
      );

      // Текстуры материала: public/textures/<name>/base.png
      const keptTextures = new Set();

      for (const texture of Array.isArray(body.textures) ? body.textures : []) {
        const name = String(texture?.name || '').replace(/[^a-z0-9_-]/gi, '');
        if (!name || typeof texture.base64 !== 'string') continue;

        const bytes = Buffer.from(texture.base64, 'base64');
        if (!bytes.length) continue;

        keptTextures.add(name);

        const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'textures', name);
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, 'base.png'), bytes);
      }

      // Старые наборы этого ассета, которых нет в новой версии
      const texturesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public', 'textures');
      for (const name of oldTextures) {
        if (keptTextures.has(name)) continue;
        await fs.promises.rm(path.join(texturesRoot, name), { recursive: true, force: true }).catch(() => {});
      }

      return send(res, 200, JSON.stringify({ asset: asset[1], bytes: bin.length }), {
        'Content-Type': 'application/json; charset=utf-8'
      });
    } catch (err) {
      return send(res, 400, err.message);
    }
  }

  const match = urlPath.match(/^\/api\/scene\/([^/]+)$/);
  const restore = urlPath.match(/^\/api\/scene\/([^/]+)\/restore$/);

  if (restore && safeId(restore[1]) && req.method === 'POST') {
    const file = await sceneFileFor(restore[1]);

    try {
      await fs.promises.copyFile(`${file}.bak`, file);
      return send(res, 200, JSON.stringify({ restored: restore[1] }), {
        'Content-Type': 'application/json; charset=utf-8'
      });
    } catch {
      return send(res, 404, 'Резервной копии нет');
    }
  }
  if (match && safeId(match[1])) {
    if (req.method === 'GET') {
      const file = await sceneFileFor(match[1]);
      if (!file) return send(res, 404, 'Сцена не найдена');

      try {
        const [text, stat] = await Promise.all([
          fs.promises.readFile(file, 'utf8'),
          fs.promises.stat(file)
        ]);

        return send(res, 200, text, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Scene-Mtime': String(Math.round(stat.mtimeMs))
        });
      } catch {
        return send(res, 404, 'Сцена не найдена');
      }
    }

    if (req.method === 'POST') {
      const file = (await sceneFileFor(match[1]))
        || path.join(SCENES_DIR, `${match[1]}.scene.json`);
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);

        // Защита от перезаписи: если файл менялся после загрузки — 409
        const clientMtime = Number(req.headers['x-scene-mtime']) || 0;
        if (clientMtime > 0) {
          const stat = await fs.promises.stat(file).catch(() => null);

          if (stat && Math.abs(stat.mtimeMs - clientMtime) > 1) {
            return send(res, 409, JSON.stringify({
              error: 'stale',
              message: 'файл сцены изменён в другой вкладке',
              mtime: Math.round(stat.mtimeMs)
            }), { 'Content-Type': 'application/json; charset=utf-8' });
          }
        }
        if (!parsed || typeof parsed !== 'object') throw new Error('ожидался объект сцены');
        if (!Array.isArray(parsed.entities) || parsed.entities.length === 0) {
          throw new Error('в сцене нет ни одной сущности — сохранение отменено');
        }

        // Резервная копия предыдущей версии: одна на сцену, для кнопки «Откат»
        await fs.promises.copyFile(file, `${file}.bak`).catch(() => {});
        await fs.promises.writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

        const saved = await fs.promises.stat(file).catch(() => null);
        return send(res, 200, JSON.stringify({ saved: match[1], bytes: body.length }), {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Scene-Mtime': saved ? String(Math.round(saved.mtimeMs)) : ''
        });
      } catch (err) {
        return send(res, 400, err.message);
      }
    }
  }

  return send(res, 404, 'Неизвестный метод API');
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    // Битый процентный escape (например GET /%) не должен ронять сервер
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }

  if (urlPath.startsWith('/api/')) return handleApi(req, res, urlPath);

  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(ROOT, relative);

  // Защита от выхода за пределы каталога public
  const inside = path.relative(ROOT, filePath);
  if (inside.startsWith('..') || path.isAbsolute(inside)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, 'Not found');
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
      'X-Galaxy-Demo': '1'
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
});

// Проверяем, не работает ли на порту уже этот же сервер
function probeGalaxyDemo(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/', timeout: 700 },
      (res) => {
        const isOurs = res.headers['x-galaxy-demo'] === '1';
        res.resume();
        resolve(isOurs);
      }
    );
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function openBrowser(port) {
  const url = `http://localhost:${port}`;
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { shell: 'cmd.exe' });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function banner(port) {
  console.log('\n  GalaxyDemo — космический полёт на WebGL');
  console.log(`  Сервер запущен: http://localhost:${port}\n`);
  console.log('  Управление: W — тяга, S — назад, A/D — поворот, Esc — пауза');
  console.log('  Модель: Corinth Cargo Transporter (public/models), выбор в public/ship.config.json\n');
}

// Одна попытка занять порт. Слушатели снимаются вручную, иначе колбэки
// прошлых попыток срабатывают при успехе и печатают неверный адрес.
function tryListen(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function listen(port, attempt = 0) {
  try {
    await tryListen(port);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') {
      console.error('\n  [ОШИБКА] Не удалось запустить сервер:', err.message, '\n');
      process.exit(1);
    }

    // Порт занят. Если это уже запущенный GalaxyDemo — второй экземпляр не нужен.
    if (await probeGalaxyDemo(port)) {
      console.log('\n  Сервер уже запущен: http://localhost:' + port);
      console.log('  Открываю игру в браузере. Чтобы поднять заново — сначала закройте старый сервер.\n');
      if (OPEN_BROWSER) openBrowser(port);
      process.exit(0);
    }

    if (attempt >= MAX_PORT_ATTEMPTS) {
      console.error(`\n  [ОШИБКА] Порты ${START_PORT}–${port} заняты другими программами.`);
      console.error('  Освободите порт или задайте свой: set PORT=4000 && npm start\n');
      process.exit(1);
    }

    console.log(`  Порт ${port} занят другой программой — пробую ${port + 1}…`);
    return listen(port + 1, attempt + 1);
  }

  // Ошибки после старта не должны убивать процесс без сообщения
  server.on('error', (err) => console.error('  [ОШИБКА]', err.message));
  banner(port);
  if (OPEN_BROWSER) openBrowser(port);
}

listen(START_PORT);
